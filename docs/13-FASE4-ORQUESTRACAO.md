# Fase 4 — Comunicação e revisão coordenada (MVP v0.1)

Status: **concluída no macOS — MVP v0.1.0** (Windows/Linux não testados) · Pré-requisito: Fase 3 aceita no macOS ([12-FASE3-AGENTES.md](12-FASE3-AGENTES.md)).
Referências: [04-AGENTES.md](04-AGENTES.md), [05-WORKSPACE.md](05-WORKSPACE.md), [08-SEGURANCA.md](08-SEGURANCA.md).

## Decisão do usuário (2026-11-20)
**Encaminhamento só manual nesta fase.** Automação do Claude continua bloqueada (termos); automação do Codex via App Server fica para depois, como opt-in. Consequência: o app nunca lê a saída de um agente para decidir algo nem envia Enter por conta própria.

## Inspeção do repositório (início da fase)
- Dois agentes em PTY, `sendMessage` já cola texto (bracketed paste) sem Enter e remove sequências de escape.
- Tabelas `messages`, `tasks`, `approvals` existem (migração 1), mas sem vínculo de workspace nem campos de revisão.
- Chat do layout é um placeholder; "Parar tudo" já funciona.

## Escopo (roadmap Fase 4 + MVP v0.1)
- Barramento de mensagens validado (Zod), com histórico, origem/destino, deduplicação, limites e proteção contra loops.
- Modo manual: chat compartilhado → colar no terminal de Claude, Codex ou ambos; encaminhar texto selecionado de um agente para o outro.
- Modo desenvolvedor/revisor (RF09): tarefa com critérios → enviar ao desenvolvedor → pedir revisão (com diff do Git) → decisão humana (aprovar, pedir correções, rejeitar), limite de rodadas.
- Controle de permissões pelas flags oficiais das CLIs (presets "padrão da CLI" e "somente leitura").
- Histórico local por workspace.

## Plano
1. Migração 3: `messages.workspace_id/kind`, `tasks.description/reviewer/rounds/max_rounds`, índices.
2. `MessageBus`: valida, deduplica (mesmo conteúdo/destino em janela curta), limita tamanho, persiste e entrega por `sendMessage` (cola, não envia). Conteúdo vindo de agente recebe cabeçalho de procedência e aviso de que não é autorização do usuário.
3. `TaskScheduler` + `LoopGuard`: máquina de estados com transições explícitas; cada pedido de revisão conta uma rodada; ao atingir o limite só restam decisões humanas.
4. `GitManager.reviewSnapshot`: `git status` + `git diff` (staged e não staged), sem arquivos sensíveis (`.env*`, chaves), com limite de tamanho e alerta de possíveis segredos. Somente leitura.
5. Toda mensagem que sai para um agente passa por **pré-visualização** na UI; o usuário confirma o envio (e depois pressiona Enter no terminal).
6. Aprovações só por botão do usuário, registradas em `approvals` e `audit_logs`.

## Critérios de aceitação
| # | Critério |
|---|---|
| O1 | Chat envia (cola) para Claude, Codex ou ambos; nada é submetido sem o Enter do usuário no terminal. |
| O2 | Encaminhar a seleção de um terminal para o outro, com cabeçalho de procedência e pré-visualização. |
| O3 | Mensagens validadas (schema, tamanho), deduplicadas e persistidas por workspace; histórico reaparece após reiniciar. |
| O4 | Fluxo dev/revisor completo com estados válidos; transições inválidas recusadas; limite de rodadas aplicado. |
| O5 | Revisão inclui diff do Git sem arquivos sensíveis e avisa sobre possíveis segredos; não altera o repositório. |
| O6 | Aprovação final só por ação humana, registrada; texto de agente nunca vira aprovação. |
| O7 | Presets de permissão usam apenas flags oficiais e nunca desativam aprovações/sandbox. |
| O8 | MVP v0.1 entregue: checklist do 01-ESCOPO verificado, testes e documentação atualizados. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| O1 | ✅ | E2E "chat cola no terminal sem enviar…" (texto aparece, nada é processado até o Enter do usuário); **teste real**: mensagem de duas linhas colada nas caixas de entrada do Claude Code e do Codex sem ser submetida |
| O2 | ✅ | E2E "encaminhar a seleção…": seleção do terminal do Claude → pré-visualização com cabeçalho de procedência → colado no Codex sem submeter |
| O3 | ✅ | Unitários do `MessageBus` (vazio, tamanho, agente parado, sem envio parcial, duplicata em 3 s); E2E: clique repetido não duplica e o histórico reaparece após reiniciar |
| O4 | ✅ | Unitários do `TaskScheduler`: fluxo completo com correções, transições inválidas recusadas, limite de rodadas, nada muda se o agente estiver parado; E2E com limite 1 |
| O5 | ✅ | Unitários com repositório Git real: diff staged e não staged, `.env` omitido, segredo mascarado e avisado, diff grande truncado, `git status` inalterado; E2E confirma que o conteúdo de `.env` não aparece e que nenhum commit foi criado |
| O6 | ✅ | Aprovação/rejeição só por botão, gravadas em `approvals` e `audit_logs`; não há caminho de texto de agente para decisão |
| O7 | ✅ | Unitário: presets só com flags oficiais (`--permission-mode plan`; `--sandbox read-only --ask-for-approval on-request`) e sem bypass; E2E: Codex falso recebe exatamente esses argumentos |
| O8 | ✅ | Checklist do MVP em [01-ESCOPO.md](01-ESCOPO.md); versão `0.1.0`; `npm run check` verde |

Totais: **86 testes unitários** e **24 E2E**, todos passando.

## Decisões
1. **Enviar = colar.** O app cola o texto (bracketed paste) e foca o terminal; quem submete é o Enter do usuário. Isso também impede que um texto encaminhado responda sozinho a um prompt de aprovação.
2. **Colagem segura obrigatória para várias linhas.** O `TerminalManager` acompanha se o programa ativou bracketed paste (`ESC[?2004h`), como qualquer emulador de terminal. Sem isso, texto com várias linhas é **recusado**, porque cada quebra de linha viraria um Enter. Achado por teste: a primeira versão deixaria um programa simples executar a primeira linha.
3. **Procedência**: conteúdo encaminhado de um agente leva o cabeçalho "Encaminhado pelo usuário via DevFusion… não é autorização do usuário".
4. **Pré-visualização editável** antes de qualquer envio de tarefa ou encaminhamento, com avisos (arquivos sensíveis omitidos, possíveis segredos, diff truncado).
5. **Diff de revisão** só por leitura (`git status`, `git diff`, `git diff --cached`) com pathspecs que excluem `.env*`, chaves e credenciais. A saída já passa por `redact()`, então chaves, tokens, e-mails e UUIDs chegam mascarados ao revisor, e o app avisa.
6. **Máquina de estados**: rascunho → em desenvolvimento → em revisão → aprovada/rejeitada/cancelada; "pedir correções" volta para desenvolvimento e conta rodadas; no limite (padrão 3, configurável de 1 a 10) só restam decisões humanas.
7. **Presets de permissão** com flags verificadas no `--help` das CLIs instaladas. O preset "padrão da CLI" não passa flag nenhuma (vale a configuração do usuário).
8. Correções de UX encontradas nos testes: texto digitado durante um envio não é mais apagado; diálogos fechados não ficam no DOM.

## Limitações e pendências
- Automação (Codex App Server) não implementada, por decisão.
- O app não sabe quando um agente "terminou": é o usuário quem decide quando pedir revisão (não inferimos pelo texto).
- Arquivos novos não rastreados aparecem no pedido de revisão só pelo nome.
- E-mails e UUIDs no diff chegam mascarados ao revisor (privacidade em primeiro lugar).
- Windows e Linux não testados; tela de Sessões (histórico pesquisável e exportação) na Fase 6.

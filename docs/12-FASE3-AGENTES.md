# Fase 3 — Dois agentes na mesma tela

Status: **concluída no macOS** (Windows/Linux não testados) · Pré-requisito: Fase 2 aceita no macOS ([11-FASE2-SYSTEM-DOCTOR.md](11-FASE2-SYSTEM-DOCTOR.md)).
Referências: [04-AGENTES.md](04-AGENTES.md), [05-WORKSPACE.md](05-WORKSPACE.md), [09-FASE0-POC.md](09-FASE0-POC.md).

## Inspeção do repositório (início da fase)
- System Doctor detecta as CLIs (caminho, versão) e o status de login; `ProcessRunner`/`PlatformDetector` já fornecem ambiente por allowlist.
- Painéis dos agentes e o chat são placeholders; não existe seleção de workspace.
- Fase 0 mostrou: PTY funciona para os dois; Claude pede "trust this folder" (só o humano responde); Codex às vezes só encerra com SIGTERM depois de Ctrl‑C.

## Escopo
Roadmap Fase 3: adapters, node-pty, xterm.js, processos independentes, eventos e cancelamento; testar com as contas oficiais.
Incluído por necessidade: seleção mínima de workspace (o terminal precisa de um diretório) e login pelo fluxo oficial **dentro** do terminal integrado (pendência da Fase 2).
Fora: chat compartilhado/encaminhamento (Fase 4), worktrees/diff (Fase 5), editor (Fase 6).

## Plano
1. `TerminalManager` (main): node-pty, um processo por agente, saída em lotes, controle de fluxo (pausa o PTY quando o renderer não confirma o consumo), buffer limitado para reanexar a tela, resize, encerramento escalonado (Ctrl‑C → SIGTERM → SIGKILL / árvore no Windows) e verificação de órfãos ao sair.
2. `AgentAdapter` + `ClaudeCodeAdapter`/`CodexAdapter`: binário oficial não modificado, ambiente por allowlist (sem API keys), capacidades declaradas honestamente (`interactive: true`, `automatable: false`, `structuredEvents: false` no PTY).
3. Estados reais: não iniciado, ativo (processo vivo), encerrado, falhou. Não inferir "aguardando aprovação"/"limitado" a partir de texto do terminal.
4. Sessões no SQLite (`sessions`), com recuperação: sessões "ativas" de uma execução anterior viram "desconectadas" na abertura.
5. Workspace: diálogo nativo de pasta, caminho real (symlinks resolvidos), leitura/escrita, sem inicializar Git; branch atual exibida se for repositório.
6. UI: xterm.js por agente (scrollback limitado, ajuste automático de tamanho), Iniciar/Interromper/Encerrar, "Fazer login" que roda o comando oficial no terminal do painel, "Parar tudo".

## Critérios de aceitação
| # | Critério |
|---|---|
| A1 | Cada agente roda em PTY próprio, independente, no workspace selecionado, com entrada, saída e redimensionamento funcionando. |
| A2 | Processo filho recebe ambiente por allowlist (sem `*_API_KEY`/tokens); binário é o oficial detectado pelo Doctor. |
| A3 | Interromper envia Ctrl‑C; Encerrar escala até SIGKILL; "Parar tudo" encerra os dois; nenhum processo órfão após sair do app. |
| A4 | Estados exibidos refletem só fatos (processo vivo/código de saída); nada é inferido do texto. |
| A5 | Saída intensa não trava a interface (lotes + controle de fluxo + scrollback limitado). |
| A6 | Login pelo fluxo oficial dentro do terminal integrado; ao terminar, o Doctor revalida a conta. |
| A7 | Workspace validado (existe, é pasta, leitura/escrita, caminho real) e persistido; nenhum `git init`. |
| A8 | Sessões persistidas; sessões de execução anterior aparecem como desconectadas, não como vivas. |
| A9 | Teste real com Claude Code e Codex usando as contas oficiais do usuário. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| A1 | ✅ | E2E "dois agentes em terminais independentes…" (entrada no Claude não aparece no Codex); unitário de PTY real com resize; **teste real** abaixo |
| A2 | ✅ | Unitário e E2E: a CLI falsa imprime as variáveis sensíveis visíveis → nenhuma (`keys=`), mesmo com `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` no ambiente do app |
| A3 | ✅ | Unitários: Ctrl+C vira SIGINT; escalada até SIGKILL com processo que ignora SIGINT/SIGTERM; E2E: "Parar tudo" com Codex falso teimoso e fechamento do app com agente rodando, verificando que os PIDs morreram |
| A4 | ✅ | Estados: "sessão ativa", "sessão encerrada (código N)", "processo falhou (código N)", "falha ao iniciar", "login em andamento/encerrado". Nada de "aguardando aprovação"/"limitado" inferido do texto |
| A5 | ✅ | Unitário de controle de fluxo: 20 000 linhas; PTY pausa sem confirmação e retoma com ack; histórico de reanexo limitado; xterm com scrollback de 5 000 linhas |
| A6 | ✅ | E2E: "Fazer login" roda `codex login` no terminal do painel e, ao terminar, o Doctor revalida a conta (passa a OK) |
| A7 | ✅ | Unitários: inexistente, arquivo, raiz, home, symlink resolvido, repositório sem commits, nenhum `git init`; E2E: diálogo cancelado e pasta raiz recusada |
| A8 | ✅ | Unitário `markStaleAsDisconnected`; E2E: após reabrir, workspace restaurado e "Sessões ativas: 0" |
| A9 | ✅ | Ver teste real: Claude validado pelo agente de desenvolvimento; Codex validado pelo usuário no app após a correção do bug de foco |

Totais: **74 testes unitários** e **19 E2E** passando (`npm run check`).

### Teste real com as contas oficiais (A9)
App compilado, ambiente real (PATH mínimo como ao abrir pelo Finder), workspace = esta pasta do DevFusion:
- **Claude Code 2.1.329**: abriu direto no prompt (a pasta já era confiável para você), "Opus 5.5 · Claude Pro". Prompt digitado no terminal integrado → resposta `FUSAO7` em ~38 s (inclui a inicialização da CLI).
- **Codex 0.169.0-alpha.11.1**: abriu e parou em "Trust this folder?" (decisão do usuário). O usuário respondeu no app e o Codex encerrava — bug do DevFusion, descrito abaixo. Após a correção, **o usuário confirmou o Codex funcionando no app** (2026-11-20).
- "Parar tudo" encerrou os dois (código 0) e nenhum PID ficou vivo.
- O Claude mostrou "Removed 1 invisible character from your prompt". Verificado com um `od` no lugar da CLI: os bytes digitados chegam ao PTY sem nada extra. A diferença é a sequência de foco (`ESC [ I`) que o xterm envia quando a própria CLI pede relatos de foco, comportamento padrão de qualquer terminal.

### Bug encontrado no uso real e corrigido
O usuário respondeu "Trust this folder?" do Codex com Enter e o Codex encerrava. Causa: ao clicar em **Iniciar**, o React reaproveitava o mesmo botão (focado) para **Encerrar**; o Enter seguinte acionava "Encerrar" em vez de ir para o terminal. Encontrado com o novo log de diagnóstico (`stoppedByUser: true`, tela com "Shutting down..."). Correção: o terminal recebe o foco ao iniciar uma sessão e os botões têm chaves distintas. Teste E2E de regressão criado e confirmado falhando sem a correção.

**Diagnóstico de encerramento**: quando um agente termina, o main registra no log (sanitizado) código de saída, duração, se foi encerrado pelo usuário e as últimas linhas da tela.

## Decisões
1. **Um PTY por agente**, binário oficial sem flags extras; login = comando oficial (`claude auth login`, `codex login`) no mesmo terminal; a conta é revalidada pelo Doctor ao fim de qualquer sessão.
2. **Estados só por fatos** do processo. `automatable: false` nos dois adapters, com a justificativa da Fase 0 exibida no painel.
3. **Controle de fluxo**: saída em lotes de 16 ms; o PTY pausa com 512 KB sem confirmação e retoma abaixo de 128 KB; o renderer confirma após o xterm processar. Reanexo guarda os últimos 256 KB.
4. **Encerramento**: Ctrl+C ×2 → SIGTERM ao grupo de processos → SIGKILL (Windows: kill do ConPTY + `taskkill /T /F`). Ao sair do app, `before-quit` espera os agentes terminarem.
5. **`sendMessage` cola o texto (bracketed paste) sem pressionar Enter** e remove sequências de escape; ainda não exposto à UI (encaminhamento é Fase 4). Assim nenhum texto encaminhado responde sozinho a um prompt de aprovação.
6. **Workspace**: só pelo seletor nativo do main (o renderer não envia caminhos); caminho real; recusa raiz do disco e a pasta pessoal; Git apenas lido (`rev-parse`, `symbolic-ref`).
7. **CSP**: `style-src` passou a aceitar `'unsafe-inline'` porque o xterm.js injeta estilos dinâmicos. `script-src` continua `'self'` e `img-src`/`connect-src` continuam restritos, então CSS injetado não consegue exfiltrar dados.
8. **node-pty 1.1.0** como dependência do app, com o mesmo `postinstall` da Fase 0 para o `spawn-helper`. Funciona no Electron 45 sem rebuild (prebuild N-API).

## Limitações e pendências
- **Windows e Linux não testados.** `.cmd` via `cmd.exe` no PTY e `taskkill` só têm testes sem execução real.
- Links clicáveis no terminal abrem no navegador do sistema (só `https`).
- Sessões não são retomadas (`--resume`) após reiniciar o app; aparecem como desconectadas.
- Chat compartilhado e encaminhamento entre agentes: Fase 4.

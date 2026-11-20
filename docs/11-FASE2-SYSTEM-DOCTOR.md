# Fase 2 — System Doctor e onboarding

Status: **concluída no macOS** (Windows/Linux não testados) · Pré-requisito: Fase 1 aceita no macOS ([10-FASE1-FUNDACAO.md](10-FASE1-FUNDACAO.md)).
Especificação de referência: [03-SYSTEM-DOCTOR.md](03-SYSTEM-DOCTOR.md).

## Inspeção do repositório (início da fase)
- App Electron com IPC em allowlist + Zod, SQLite com tabela `dependencies` já criada (migração 1), layout inicial sem agentes.
- A POC (`poc/`) já tem allowlist de ambiente, detecção em PATH + locais oficiais e leitura de status de login por comando oficial; esses padrões serão portados para `src/main/system/`.

## Plano
1. `ProcessRunner`: execução sem shell, argumentos separados, timeout que distingue "tempo esgotado" de "não encontrado", saída limitada e sanitizada, cancelamento, tratamento de `.cmd` no Windows.
2. `PlatformDetector`: SO/arquitetura, PATH de busca = PATH do processo + locais oficiais conhecidos (sem varredura de disco), caminhos configurados pelo usuário, releitura do PATH do registro no Windows após instalação.
3. Checks independentes em paralelo limitado, cada um devolvendo `id, estado, versão, caminho, detalhe sanitizado, ação sugerida`:
   SO e arquitetura · Git · Claude Code · Codex · conta Claude · conta Codex · conectividade Anthropic/OpenAI · diretório de dados do app (leitura/escrita) · espaço em disco · Node/npm externos · workspace (nenhum selecionado nesta fase) · Python/Docker sob demanda.
4. `SystemDoctor`: roda a cada inicialização sem travar a UI, reexecução manual/por item/após instalação, resultados no SQLite (`dependencies`) e evento para a UI.
5. Instalação assistida: catálogo só com métodos oficiais documentados; execução automática apenas via gerenciador de pacotes (winget/Homebrew/npm) com comando fixo; scripts remotos nunca são executados — o app abre a página oficial. Antes de instalar: origem, comando exato, permissões e observação de versão; confirmação final em diálogo nativo do processo main; saída ao vivo, cancelamento, auditoria e revalidação.
6. Login: status só por comando oficial; a UI mostra o comando oficial (`claude auth login`, `codex login`) e o botão Revalidar. O login dentro do terminal integrado chega na Fase 3.
7. UI: onboarding na primeira execução; nas seguintes, diagnóstico em segundo plano com resumo no cabeçalho/barra de status e painel "System Doctor" na barra lateral; modo degradado e modo individual.

## Critérios de aceitação
| # | Critério |
|---|---|
| D1 | Doctor roda em toda inicialização, sem bloquear a interface, e pode ser reexecutado (tudo ou um item). |
| D2 | Cada check retorna o contrato completo; "tempo esgotado" ≠ "não instalado"; "desconhecido" nunca vira "logado". |
| D3 | Nenhum token/senha lido; status de conta só via `claude auth status --json` e `codex login status`. |
| D4 | Instalação nunca ocorre sem consentimento explícito confirmado no processo main; cancelamento e falha tratados; revalidação automática depois. |
| D5 | Nenhum script remoto executado automaticamente; nenhum pedido de elevação feito pelo app. |
| D6 | App continua utilizável em modo degradado (sem nenhum agente) e em modo individual (um agente). |
| D7 | Cenários testados: ambiente limpo, só um agente, ambos, deslogado, PATH incorreto/caminho configurado, versão incompatível, sem conexão, disco insuficiente, permissão negada, cancelamento, instalação malsucedida. |
| D8 | Resultados persistidos em `dependencies`; tentativas de instalação registradas em `audit_logs`. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| D1 | ✅ | O Doctor é disparado após a janela abrir (`src/main/index.ts`); E2E "primeira execução…" verifica nova execução após reinício; botões "Revalidar tudo" e "Revalidar" por item |
| D2 | ✅ | Contrato `CheckResult` em `src/shared/doctor.ts`; unitários "ferramenta travada: tempo esgotado ≠ ausente", "saída irreconhecível vira desconhecido, não login" |
| D3 | ✅ | Só `claude auth status --json` e `codex login status`; ambiente das CLIs por allowlist (unitário "não leva API keys") |
| D4 | ✅ | Confirmação final em `dialog.showMessageBox` no main; E2E "recusa no diálogo nativo não executa nada; aceite instala e revalida"; unitários de recusa, falha, cancelamento e instalação simultânea |
| D5 | ✅ | Scripts remotos (`curl … \| bash`, `irm … \| iex`) existem só como instrução; teste do catálogo garante que nenhum é executável e que comandos não têm metacaracteres nem `sudo` |
| D6 | ✅ | E2E de modo degradado (nenhum agente) e individual (um agente) |
| D7 | ✅ | Ver tabela de cenários abaixo |
| D8 | ✅ | Unitário "persiste resultados na tabela dependencies"; auditoria `install.requested/declined/started/finished` |

### Cenários de aceitação (docs/03)
| Cenário | Onde é testado |
|---|---|
| Ambiente limpo | unitário + E2E (onboarding, modo degradado) |
| Só um agente | unitário + E2E (modo individual) |
| Ambos instalados | unitário + E2E (modo completo) e **execução real nesta máquina** (Claude Pro + Codex Plus, 13 checks em ~0,3 s) |
| Sessão deslogada | unitário + E2E (instrução de login oficial) |
| PATH incorreto | unitário (caminho configurado válido/inválido) + E2E (Configurações → caminho → revalidação) |
| Versões antigas | unitário (Git < 2.5 → incompatível) |
| Sem conexão | unitário (erro vs. timeout) + E2E (porta fechada) |
| Disco insuficiente | unitário + E2E (banner bloqueante) |
| Permissões negadas | unitário (diretório de dados somente leitura) |
| Cancelamento | unitário (instalação cancelada) |
| Instalação malsucedida | unitário + E2E (saída e código exibidos, app segue utilizável) |

Totais: **57 testes unitários** e **14 E2E**, todos passando (`npm run check`). Os testes usam CLIs falsas geradas em diretório temporário (`tests/helpers/fakeTools.ts`); nenhum teste instala nada de verdade nem acessa a rede.

## Decisões
1. **Execução automática só via gerenciador de pacotes** (`brew`, `winget`, `npm`) com argumentos fixos do catálogo. Scripts oficiais de instalação remota aparecem como instrução e abrem a página oficial; o app nunca os executa.
2. **Consentimento no main**: o renderer só pede; quem confirma é um diálogo nativo do processo main com comando, origem, permissões e observação de versão. Um renderer comprometido não consegue instalar sem o clique do usuário.
3. **Sem elevação**: nada de `sudo`/UAC solicitado pelo app; se o gerenciador precisar, a instalação falha e a UI orienta.
4. **Login nesta fase = instrução + revalidação**. Rodar `claude auth login`/`codex login` sem um terminal real é arriscado (a CLI pode pedir colar código). O login dentro do terminal integrado entra na Fase 3.
5. **Conectividade por handshake TLS** com `api.anthropic.com` e `chatgpt.com` (porta 443), sem enviar requisições a endpoints.
6. **Espaço mínimo de 1 GiB** é política do DevFusion (não requisito dos provedores) e está assim descrito na UI.
7. **Git ≥ 2.5** por causa de `git worktree` (Fase 5). Para Claude Code, requisitos de SO documentados (macOS 13+, Windows 10 1809+). Para o Codex nenhum mínimo é imposto porque a documentação não define.
8. **Detecção**: caminho configurado → PATH → locais oficiais fixos (`~/.local/bin`, Homebrew, `%APPDATA%\npm`, WinGet Links, Git/Node em Program Files, CLI do Codex embutida no ChatGPT.app no macOS). Sem varredura de disco. No Windows o PATH é relido do registro após instalar.
9. **Variáveis de teste**: `DEVFUSION_TOOL_PATH`, `DEVFUSION_CONNECTIVITY_TARGETS`, `DEVFUSION_MIN_FREE_DISK_BYTES` permitem simular ambientes; não afetam credenciais.

## Limitações e pendências
- **Windows e Linux não testados.** Código de `.cmd` via `cmd.exe`, registro do PATH e diretórios do Windows têm só testes sem execução real; os testes com CLIs falsas são pulados no Windows.
- **Nenhuma instalação real foi executada** (precisaria do seu consentimento e alteraria o sistema). O fluxo foi validado com gerenciadores falsos.
- WinGet/Homebrew podem pedir interação (termos da fonte, senha). Sem terminal, a instalação falha com a saída visível; a orientação é rodar o comando no terminal.
- Login dentro do app só na Fase 3.
- O check de workspace fica "opcional" até existir seleção de projeto.

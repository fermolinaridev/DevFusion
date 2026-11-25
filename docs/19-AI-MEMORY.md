# Integração opcional — ai-memory

Status: **implementada (desligada por padrão)** · Pedido do usuário durante a Fase 8: "adicionar o ai-memory" → decisão: **integrar no DevFusion**.
Projeto: [github.com/akitaonrails/ai-memory](https://github.com/akitaonrails/ai-memory) (MIT, Rust, terceiros). Versão analisada: 3.5.1.

## O que é
Memória de longo prazo compartilhada entre agentes de código. Hooks e MCP capturam o trabalho (sanitizado), um servidor local consolida em páginas markdown versionadas por Git, e `ai-memory run <agente>` deixa o Codex continuar a mesma "workstream" de onde o Claude Code parou, e vice-versa. Isso combina com o propósito do DevFusion (dois agentes lado a lado) sem automatizar nada entre eles: quem decide o que fazer continua sendo o usuário.

## Como o DevFusion integra
| Parte | Comportamento |
|---|---|
| System Doctor | Check **opcional** `ai-memory`: localiza o binário (PATH, `~/.local/bin`, Homebrew, `%LOCALAPPDATA%\Programs\ai-memory`), roda `ai-memory --version` e `ai-memory status --json` (sai com erro quando o servidor não responde, conferido no código-fonte). Ausente nunca é problema. |
| Instalação assistida | Homebrew (`brew install akitaonrails/tap/ai-memory`) executado só com confirmação nativa. Scripts `install.sh`/`install.ps1` (que conferem o SHA-256 da release) aparecem apenas como instrução: o DevFusion não roda scripts remotos. |
| `ai-memory setup` | **Não é executado pelo app.** Ele cria serviço, token e altera configurações dos agentes; o usuário roda no próprio terminal, onde o ai-memory mostra o plano e pergunta antes. |
| Lançamento | Com a opção ligada (Configurações → Memória compartilhada), sessões de agente iniciam como `ai-memory run --no-exit-prompt --executable <binário validado> <claude|codex> <args nativos>`. Login e demais fluxos continuam diretos. |
| Confirmação | Ligar a opção pede confirmação **nativa no main** explicando: hooks/MCP instalados pelo ai-memory na primeira execução, captura de prompts e ferramentas e onde ficam os dados. Recusar não muda nada. Desligar não pede confirmação. |

Flags verificadas em `crates/ai-memory-cli/src/cli.rs` (`RunArgs`): flags do wrapper **antes** do nome do agente; o resto é repassado byte a byte. `--no-exit-prompt` é obrigatório: sem ele o ai-memory oferece um menu ao fechar o agente e o processo não termina, quebrando o ciclo de vida das sessões do DevFusion.

## Segurança e privacidade
- Nenhum token do ai-memory é lido pelo DevFusion (o token fica no diretório de dados do ai-memory, com permissão só do dono).
- Variáveis repassadas a mais: `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` e `AI_MEMORY_SERVER_URL` (localização de config/servidor; não são segredos).
- Presets de permissão (somente leitura etc.) continuam iguais: os argumentos nativos chegam ao agente sem alteração. A statusline de uso do Claude (`--settings`) também.
- O conteúdo capturado pelo ai-memory é responsabilidade dele (ver `DATA_HANDLING.md` e `docs/security.md` do projeto). O DevFusion apenas deixa claro, na confirmação, que a captura passa a acontecer.

## Critérios de aceitação
| # | Critério | Status | Evidência |
|---|---|---|---|
| M1 | Ausência do ai-memory não afeta o app (check opcional) | ✅ | Unitário: estado `optional` com ação de instalar |
| M2 | Doctor distingue instalado/servidor respondendo/servidor parado | ✅ | Unitários com CLI falsa (`status --json` 0 e 1) |
| M3 | Instalação só por gerenciador de pacotes com confirmação; scripts só como instrução | ✅ | Unitário do catálogo |
| M4 | Ligar exige confirmação nativa; recusa não muda nada | ✅ | E2E (recusar → agente inicia direto, sem `ai-memory run`) |
| M5 | Agente inicia via `ai-memory run` com binário validado, args nativos e statusline preservados; entrada/saída e Parar tudo funcionam | ✅ | E2E com ai-memory falso que registra o argv e executa o agente |
| M6 | Ligado mas ausente: erro claro, nada é iniciado | ✅ | E2E |

## Teste real (2026-11-21, macOS arm64, ai-memory 3.5.1)
Com autorização do usuário: `brew install akitaonrails/tap/ai-memory` e `ai-memory setup --agent claude-code --agent codex --language pt-BR --yes`. Antes do setup foi feito backup de `~/.claude/settings.json`, `~/.claude.json` e `~/.codex/config.toml`. O próprio ai-memory também grava backups ao lado dos arquivos.

| Passo | Resultado |
|---|---|
| Setup | ✅ LaunchAgent e servidor em `127.0.0.1:49374` (`healthz` ok). Hooks e MCP gravados em `~/.claude/settings.json` e `~/.codex/config.toml` + `~/.codex/hooks.json`. Skills em `~/.claude/skills` e `~/.agents/skills`. |
| `status --json` | ✅ exit 0, ou seja, o check do Doctor fica "servidor local respondendo" |
| Claude via `ai-memory run --no-exit-prompt` (`-p`, Sonnet, esforço baixo) | ✅ corrigiu o bug do repositório de teste e o ai-memory salvou 11 eventos |
| Codex via `ai-memory run` (`exec`, GPT-6.2-Astra) | ⚠️ executou e o ai-memory salvou 10 eventos, mas o Codex **não recebeu o contexto do Claude**. Aviso: "this harness did not acknowledge its managed context packet" |

Causas do caso do Codex:
1. O Codex exige **confiança explícita nos hooks novos** ("Hooks need review" na TUI). Isso é feito pelo usuário, uma vez, abrindo o `codex`. O DevFusion não usa `--dangerously-bypass-hook-trust`, pela regra de nunca responder prompts de confiança.
2. O MCP do ai-memory no Codex lê o token de `AI_MEMORY_AUTH_TOKEN` (`bearer_token_env_var`). **Resolvido na Fase 9** (decisão do usuário): essa variável passou a ser repassada às CLIs quando o usuário a exporta no próprio ambiente. O DevFusion continua sem ler o arquivo do token.
3. Com `-s read-only` o shell do Codex não alcança o servidor local.

## Limitações
- Teste real feito só no macOS. Alternar Claude → Codex depende de dois passos manuais: confiar nos hooks na TUI do Codex e exportar `AI_MEMORY_AUTH_TOKEN` no ambiente de onde o DevFusion é aberto.
- Com o Dev Orchestrator ([20-FASE9-ORQUESTRADOR.md](20-FASE9-ORQUESTRADOR.md)), os workers do Codex também passam por `ai-memory run` quando a integração está ligada.
- Windows nativo é experimental no próprio ai-memory. O `--executable` recebe o executável oficial, mesmo com as CLIs instaladas via npm.
- Worktrees: o ai-memory identifica a workstream pelo checkout; cada worktree do DevFusion é uma workstream própria.
- O DevFusion não mostra o conteúdo da memória; use o `/web` ou os arquivos markdown do ai-memory.

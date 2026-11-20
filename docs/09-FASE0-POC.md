# Fase 0 — Pesquisa e prova de conceito (resultado)

Data da execução: 2026-11-20 (2ª execução após `claude auth login` do usuário) · Ambiente: macOS 27.2 arm64, Node v26.0.0, node-pty 1.1.0.
Código: [`poc/`](../poc) · Relatório bruto sanitizado: `poc/results/` (não versionado).

> **Windows não foi testado nesta fase.** A POC rodou apenas em macOS. Windows continua
> prioritário e precisa repetir `npm run poc` antes de ser considerado validado (ver Pendências).

## 1. Plano e critérios de aceitação

| # | Critério (roadmap Fase 0) | Status | Evidência |
|---|---|---|---|
| A1 | Conferir termos e documentação oficial atual de ambos | ✅ | Seção 2 |
| A2 | Detectar CLIs e versões sem varredura de disco | ✅ | `tools` no relatório |
| A3 | Status de login pelo comando oficial, sem ler credenciais | ✅ | `auth` no relatório |
| A4 | Sessão interativa em PTY: spawn, saída, resize, encerramento sem órfãos | ✅ ambos | `pty.*` |
| A5 | Entrada/saída real em PTY (encaminhamento manual) | ✅ Codex · ⚠️ Claude: PTY abre e renderiza, mas para no diálogo "trust this folder", que o app não responde por política | `pty.*` |
| A6 | Eventos estruturados e interrupção por protocolo | ✅ Codex · ✅ Claude (`-p stream-json`; interrupção do Claude só via sinal, não testada) | `structured.*` |
| A7 | Nenhuma API key obrigatória / nenhum fallback para API paga | ✅ | `envPolicy.apiKeysPassed = []` + teste unitário |
| A8 | Logs sanitizados | ✅ | `poc/test/env.test.mjs` (3/3) + grep nos relatórios |
| A9 | Registrar resultado, limitações e bloquear automação não suportada | ✅ | Seções 4–6 |
| A10 | Persistência/retomada de sessão (`resume`) | ⏳ não testado | Pendência |
| A11 | Repetir no Windows | ⏳ não testado | Pendência |

## 2. Documentação e termos consultados

### Claude Code (code.claude.com/docs)
- Login com assinatura Pro/Max é suportado pela CLI: `claude auth login`, `claude auth status` (JSON; sai com 0 se logado, 1 se não), `claude auth logout`, `/login` no modo interativo. Fonte: `/docs/en/iam`, `/docs/en/cli-reference`.
- Modo headless: `claude -p`, `--output-format text|json|stream-json`, `--input-format stream-json`, `--resume`. Fonte: `/docs/en/headless`. `--bare` **não** usa login de assinatura.
- **Política relevante** (`/docs/en/legal-and-compliance` e `/docs/en/agent-sdk/overview`):
  - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications."
  - O usuário final pode usar o **binário não modificado do Claude Code** com a própria assinatura.
  - Os limites dos planos assumem "ordinary, individual usage".
- Instalação oficial: instalador nativo (`install.ps1` / `install.cmd` no Windows, `install.sh` em macOS/Linux), WinGet `Anthropic.ClaudeCode`, Homebrew `claude-code`, npm `@anthropic-ai/claude-code` (Node ≥ 22). Windows nativo suportado; sandbox só em WSL2/macOS/Linux.

### Codex (developers.openai.com/codex → learn.chatgpt.com/docs)
- Login com ChatGPT (inclui Plus) suportado: `codex login`, `codex login status`, `codex logout`, `--device-auth`.
- `codex exec --json` (JSONL), `-o`, `--output-schema`, `exec resume`, `--sandbox read-only|workspace-write|danger-full-access`; reutiliza o login salvo da CLI. Para CI a documentação recomenda API key.
- **App Server**: JSON-RPC 2.0 sobre stdio, "the interface Codex uses to power rich clients"; indicado "when you want a deep integration inside your own product". Marcado `[experimental]` no `--help` da CLI.
- **Política relevante** (página App Server, seção de autenticação): "App-server authentication has never been permitted for commercial or hosted services." Apps locais/open-source podem continuar, com recomendação de migrar para *Sign in with ChatGPT* (programa de parceiros em preview).
- Instalação oficial: npm `@openai/codex`, Homebrew `codex`, scripts `install.sh` / `install.ps1`, binários no GitHub Releases.

## 3. Resultados medidos (execução `--with-inference`)

| Verificação | Claude Code 2.1.329 | Codex 0.169.0-alpha.11.1 |
|---|---|---|
| Localização | `~/.local/bin/claude` (PATH) | **fora do PATH** — embutido no ChatGPT.app (assinado OpenAI, Team 2DC432GLL2) |
| Status oficial | `claude auth status`: `loggedIn: true`, `claude.ai`, `pro` (exit 0) | `codex login status`: "Logged in using ChatGPT"; `account/read`: `chatgpt`, `plus` |
| PTY: 1ª saída / resize / encerramento | 163 ms / ok / exit 1, sem órfão | 29 ms / ok / exit 0, sem órfão |
| PTY: tela inicial | Diálogo "trust this folder" (não respondido automaticamente) | Prompt pronto |
| PTY: envio de texto → resposta | não executado: requer o humano aceitar o diálogo de confiança | ✅ marcador recebido em 2,0 s |
| Modo estruturado | `claude -p --output-format stream-json` ✅ 4,6 s: `system:init → assistant → rate_limit_event → result:success`, marcador correto | `exec --json`: `thread.started → turn.started → item.completed → turn.completed` ✅ 4,3 s |
| App Server | n/a | `initialize` ✅, `account/read` ✅, `thread/start` + `turn/start` ✅ (3,2 s), `turn/interrupt` → `status: interrupted` ✅ |
| Requisições de aprovação recebidas | — | nenhuma (sandbox read-only); política da POC: responder `decline`, nunca aprovar |

## 4. Decisões

1. **Ambiente por allowlist** (`poc/lib/env.mjs`): as CLIs recebem só `HOME/USER/PATH/TERM/LANG…`. Nenhuma `*_API_KEY`, `*TOKEN`, `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*` é repassada — impede fallback silencioso para API paga e vazamento entre provedores. Será a base do `TerminalManager`/adapters.
2. **Status de login só por comando oficial** (`claude auth status --json`, `codex login status`, `account/read`). Arquivos como `~/.codex/auth.json` e o item do Keychain do Claude **não são lidos**. Status desconhecido nunca é tratado como logado.
3. **Login sempre pelo fluxo oficial, dentro do terminal integrado**: o DevFusion abre o binário não modificado e o usuário faz `/login` / `codex login` ele mesmo. O DevFusion não oferece tela própria de login.
4. **Prompts de confiança/permissão nunca são respondidos pelo app** (ex.: "trust this folder" do Claude). Ficam com o humano.
5. **Detecção do Codex** inclui o local oficial conhecido do ChatGPT.app no macOS, além do PATH. Instalação standalone só com consentimento.
6. **node-pty 1.1.0**: o prebuild `spawn-helper` (macOS) vem sem bit de execução → `posix_spawnp failed`. Corrigido por `poc/fix-node-pty.mjs` (postinstall, só `chmod 755` no arquivo local). Revalidar com o ABI do Electron na Fase 1.
7. **Interrupção**: Codex por `turn/interrupt` (protocolo); terminais por Ctrl‑C → SIGTERM → SIGKILL com verificação de órfão. Não inferir término por texto ANSI.

## 5. Situação da automação (RF07)

| Agente | Modo manual (PTY, usuário dispara o envio) | Encaminhamento automático agente→agente |
|---|---|---|
| Claude Code | ✅ Permitido: binário oficial não modificado, login do próprio usuário | ⛔ **Bloqueado.** Os termos proíbem apps de terceiros oferecerem login claude.ai e limitam o plano a uso individual comum; uso headless orquestrado por app de terceiro com assinatura não é explicitamente autorizado. Tecnicamente `claude -p --output-format stream-json` existe, mas não será habilitado sem autorização oficial clara. |
| Codex | ✅ Validado | ⚠️ **Tecnicamente validado, desativado por padrão.** App Server é documentado para clientes ricos e funcionou com a conta Plus, mas é `[experimental]` e a política só diz que apps locais *podem continuar*, recomendando o programa *Sign in with ChatGPT*. Exige decisão explícita do usuário antes de qualquer opt‑in (Fase 4). |

Consequência para o produto: o **MVP usa terminais integrados + encaminhamento manual** (o usuário escolhe destino e clica em enviar; o app escreve no PTY como se fosse colado). O botão de modo automático não aparece como disponível para o Claude.

## 6. Limitações e pendências

- **1ª execução**: o login OAuth do Claude havia expirado (`OAuth session expired and could not be refreshed`). O usuário rodou `claude auth login` e a 2ª execução passou. O System Doctor precisa tratar "sessão expirada" como estado próprio, orientando novo login.
- **Claude em PTY**: a ida e volta de texto depende do humano aceitar "trust this folder" no terminal integrado; isso será validado manualmente na Fase 3 com a UI.
- O Claude emite `rate_limit_event` no stream-json, útil para o estado `rate_limited` (RF15) — formato ainda não inspecionado.
- **Codex é versão alpha** (embutida no ChatGPT.app) e não está no PATH. Recomenda-se instalar a CLI standalone oficial (requer autorização) para uma versão estável.
- **Windows não testado** (A11). node-pty traz prebuilds `win32-x64/arm64` (ConPTY), mas nada foi executado.
- **Retomada de sessão** (`codex exec resume`, `thread/resume`, `claude --resume`) não testada (A10).
- PTY não fornece protocolo confiável de fim de resposta; o marcador textual da POC serve só como evidência, não como mecanismo do produto.
- `sandbox` do Claude não está disponível no Windows nativo (apenas WSL2), conforme a documentação oficial — não prometer isolamento lá.

## 7. Como reproduzir

```bash
cd poc && npm install      # postinstall corrige o spawn-helper
npm test                   # testes unitários (sanitização e allowlist)
npm run poc                # só verificações locais, sem consumir cota
npm run poc:inference      # inclui prompts mínimos (consome cota das assinaturas)
```

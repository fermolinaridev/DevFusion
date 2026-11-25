# Changelog

Todas as versões foram validadas no macOS (arm64). Windows e Linux passam a ser verificados pelo CI a partir da 0.2.0-beta.1.

## Não lançado — Fase 9 (Dev Orchestrator)
- Modo **Dev Orchestrator**: três colunas, com workers do Claude, o orquestrador e workers do Codex.
  - O orquestrador é o Claude Code (Opus 5.5, esforço alto) ou o Codex (GPT-6.2-Astra, esforço alto), iniciado com flags oficiais.
  - Recebe instruções de gerente de projeto e um roster de workers por classe de tarefa (trivial, rotina, complexa, crítica) com modelo e esforço configuráveis.
  - Workers do Claude são subagentes oficiais (`--agents`). Workers do Codex usam `codex exec --json` por um script gerado, com limite de simultâneos.
  - O app só observa (hooks oficiais e arquivos de eventos) e mostra os cards. Parar tudo encerra o orquestrador e os workers.
- ai-memory: `AI_MEMORY_AUTH_TOKEN` é repassado às CLIs quando o usuário o exporta (MCP do ai-memory no Codex). Workers do Codex passam por `ai-memory run` quando a integração está ligada.
- **Nível de gasto de tokens** (Ultra baixo, Médio, Alto, Muito alto, Ultra) e botão **Eco** na barra de modo: mudam modelo e esforço por classe de tarefa e o orquestrador é informado do nível. Nos níveis prontos, tarefa complexa ou crítica continua em modelo forte.
- **Limite de gasto semanal**: barra abaixo dos terminais para liberar uma parte da cota semanal por provedor. Ao chegar no limite, ou perto dele pelo ritmo recente, o agente é encerrado e não reinicia até aumentar ou recomeçar.
- **Windows**: Dev Orchestrator disponível pelo Git Bash. Corrigidos o início do Claude instalado via npm ("Argumento com caractere não permitido para cmd.exe") e o uso do plano do Codex, que ficava em "Consultando…" (`spawn EINVAL`).
- Teste real opcional do orquestrador (envia prompts): `DEVFUSION_REAL_TESTS=1 DEVFUSION_REAL_PROMPTS=1`.

## 0.3.0-beta.1 — Fase 8 (distribuição)
- Instaladores: Windows (NSIS por usuário, sem administrador), macOS (`.dmg` arm64 e x64, assinatura ad-hoc) e Linux (AppImage e `.deb`). Sem assinatura de código; `SHA256SUMS.txt` publicado em cada release.
- Endurecimento do binário com Electron Fuses: sem `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` e `--inspect`; asar com validação de integridade e carregamento exclusivo.
- Pacote enxuto: só código compilado, `node-pty` (binário da própria plataforma) e `zod`.
- System Doctor: nova checagem "Terminal integrado (PTY)".
- Aviso de nova versão pelo GitHub Releases (só avisa; nada é baixado sozinho; desligável).
- Integração opcional com o [ai-memory](https://github.com/akitaonrails/ai-memory): detecção e servidor no Doctor, instalação assistida e agentes iniciados via `ai-memory run` (desligada por padrão, liga com confirmação).
- Statusline do Claude no app empacotado exige Node.js externo (o card explica).
- CI empacota e testa o app empacotado no Windows e no Linux; workflow de release cria rascunho com instaladores testados.
- Manual do usuário (`docs/MANUAL.md`).

## 0.2.0-beta.1 — Fase 7 (estabilidade)
- Revisão de segurança: fuzz de todos os canais IPC, confirmação para links ocultos (OSC 8) no terminal, sandbox global do Electron, variáveis de teste ignoradas no app empacotado, `dompurify` corrigido (0 alertas no `npm audit`).
- Recuperação: renderer que cai é recarregado sem matar agentes (terminais reanexados, controle de fluxo zerado); exceções do main registradas; banco ilegível preservado com opção de mover para o lado.
- Logs em arquivo (sanitizados, rotação 3 × 1 MB) e "Exportar diagnóstico" para relatos da beta.
- Testes: cobertura medida (85% instruções / 90% linhas em main+shared), testes reais opcionais (`npm run test:real`), CI no GitHub Actions (Windows + Linux).
- Correções achadas pelo CI: banco no Windows (handle aberto em erro, WAL preservado, caminhos 8.3) e Linux (CLIs e E2E recebem `DISPLAY`/D-Bus para login pelo navegador e chaveiro; recuperação do renderer não depende do motivo da queda e tem limite contra laço; testes não abrem navegador nem gerenciador de arquivos de verdade).

## 0.1.x — Fases 0 a 6
- **Fase 0**: prova de conceito das CLIs oficiais com assinatura (sem API keys).
- **Fase 1**: Electron + React + TypeScript, IPC seguro, SQLite com migrações.
- **Fase 2**: System Doctor, onboarding e instalação assistida com consentimento.
- **Fase 3**: Claude Code e Codex em terminais integrados, login oficial, Parar tudo.
- **Fase 4 (v0.1.0, MVP)**: chat compartilhado com encaminhamento manual, desenvolvedor/revisor com aprovação humana.
- **Painel de uso dos planos** (5 h e semanal) pelas fontes oficiais.
- **Fase 5**: Git Worktrees, Explorer, diff, conflitos previstos, integração e desfazer com confirmação.
- **Fase 6**: editor Monaco, Dashboard, histórico pesquisável, modos Debate/Debug, atalhos, notificações.

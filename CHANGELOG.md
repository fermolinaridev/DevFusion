# Changelog

Todas as versões foram validadas no macOS (arm64). Windows e Linux passam a ser verificados pelo CI a partir da 0.2.0-beta.1.

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

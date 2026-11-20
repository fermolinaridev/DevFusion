# DevFusion — Multi-Agent Development Workspace

Aplicativo desktop local para utilizar Claude Code e Codex em uma única interface, com terminais integrados, colaboração coordenada, projetos locais e histórico. Prioridade: aproveitar Claude Pro e ChatGPT Plus pelas CLIs oficiais, sem API keys obrigatórias, sem backend remoto próprio e sem custo adicional previsto para o aplicativo. Os provedores continuam exigindo internet e aplicando seus limites e termos.

## Documentação
- [Escopo e requisitos](docs/01-ESCOPO.md)
- [Arquitetura e stack](docs/02-ARQUITETURA.md)
- [System Doctor](docs/03-SYSTEM-DOCTOR.md)
- [Agentes e orquestração](docs/04-AGENTES.md)
- [Workspace, banco e Git](docs/05-WORKSPACE.md)
- [Interface](docs/06-INTERFACE.md)
- [Roadmap](docs/07-ROADMAP.md)
- [Segurança, testes e distribuição](docs/08-SEGURANCA.md)
- [Fase 0 — resultado da prova de conceito](docs/09-FASE0-POC.md)
- [Fase 1 — fundação Electron](docs/10-FASE1-FUNDACAO.md)
- [Prompt de implementação](PROMPT.md)
- [Instruções dos agentes](AGENTS.md) e [CLAUDE.md](CLAUDE.md)

Estado atual: Fase 1 concluída no macOS — base Electron com IPC seguro, SQLite e layout inicial. Os agentes ainda não rodam dentro do app (Fase 3). A POC da Fase 0 está em `poc/`.

## Desenvolvimento
Requisitos: Node.js ≥ 22.13 e npm.

```bash
npm install
npm run dev        # abre o app em modo desenvolvimento
npm run check      # typecheck + testes unitários + build + testes E2E
``` Windows é a prioridade inicial; macOS e Linux serão homologados separadamente. A automação via assinaturas deve ser validada antes de investir em funcionalidades avançadas. Não extrair credenciais, contornar limites nem presumir permissão de automação. Se não houver integração suportada, manter os terminais oficiais e transferência manual de mensagens.

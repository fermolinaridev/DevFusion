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
- [Fase 2 — System Doctor e onboarding](docs/11-FASE2-SYSTEM-DOCTOR.md)
- [Fase 3 — dois agentes na mesma tela](docs/12-FASE3-AGENTES.md)
- [Fase 4 — comunicação, revisão e MVP v0.1](docs/13-FASE4-ORQUESTRACAO.md)
- [Painel de uso dos planos](docs/14-USO-DOS-PLANOS.md)
- [Fase 5 — Git Worktrees e integração segura](docs/15-FASE5-GIT.md)
- [Fase 6 — interface avançada](docs/16-FASE6-UI.md)
- [Fase 7 — estabilidade e beta](docs/17-FASE7-ESTABILIDADE.md)
- [Changelog](CHANGELOG.md)
- [Prompt de implementação](PROMPT.md)
- [Instruções dos agentes](AGENTS.md) e [CLAUDE.md](CLAUDE.md)

Estado atual: **beta 0.2.0-beta.1** (Fases 0–7), validada no macOS com Claude Pro e ChatGPT Plus. Windows e Linux passam no CI (GitHub Actions: typecheck, unitários, build e E2E); ainda sem teste manual nessas plataformas.

O que já funciona:
- **System Doctor** em toda abertura, onboarding e instalação assistida com confirmação.
- **Claude Code e Codex lado a lado** em terminais integrados, com login oficial dentro do app, permissões oficiais (padrão ou somente leitura) e Parar tudo.
- **Chat compartilhado com encaminhamento manual**: o texto é colado no terminal e você confirma com Enter; modos Debate e Debug.
- **Desenvolvedor/revisor** com diff do Git, aprovação humana e limite de rodadas.
- **Git Worktrees**: um branch por agente/tarefa, conflitos previstos, integração e desfazer com confirmação.
- **Editor Monaco**, Explorer, Dashboard, histórico pesquisável (exportar/apagar/retenção) e **uso dos planos** (5 horas e semanal) pelas fontes oficiais.
- Logs sanitizados, exportação de diagnóstico e recuperação de falhas.

Próxima fase: distribuição (Fase 8 — instaladores). A POC da Fase 0 está em `poc/`.

## Desenvolvimento
Requisitos: Node.js ≥ 22.13 e npm.

```bash
npm install
npm run dev        # abre o app em modo desenvolvimento
npm run check          # typecheck + testes unitários + build + testes E2E
npm run test:coverage  # cobertura dos testes unitários
npm run test:real      # opcional: usa as CLIs e contas reais (não envia prompts)
``` Windows é a prioridade inicial; macOS e Linux serão homologados separadamente. A automação via assinaturas deve ser validada antes de investir em funcionalidades avançadas. Não extrair credenciais, contornar limites nem presumir permissão de automação. Se não houver integração suportada, manter os terminais oficiais e transferência manual de mensagens.

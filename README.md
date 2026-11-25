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
- [Fase 8 — distribuição](docs/18-FASE8-DISTRIBUICAO.md)
- [Integração opcional com o ai-memory](docs/19-AI-MEMORY.md)
- [Fase 9 — Dev Orchestrator](docs/20-FASE9-ORQUESTRADOR.md)
- **[Manual do usuário](docs/MANUAL.md)** (instalar, primeiro uso, dados, desinstalar)
- [Changelog](CHANGELOG.md)
- [Prompt de implementação](PROMPT.md)
- [Instruções dos agentes](AGENTS.md) e [CLAUDE.md](CLAUDE.md)

Estado atual: **beta 0.3.0-beta.1** (Fases 0–8), validada no macOS com Claude Pro e ChatGPT Plus. Instaladores para Windows (NSIS), macOS (`.dmg`) e Linux (AppImage/`.deb`), sem assinatura de código e com SHA-256 publicado. Windows e Linux passam no CI; ainda sem teste manual nessas plataformas. Em desenvolvimento (Fase 9): **Dev Orchestrator**, um agente oficial no centro que distribui tarefas para workers do Claude e do Codex com modelo e esforço por classe de tarefa (no Windows, com Git for Windows).

O que já funciona:
- **System Doctor** em toda abertura, onboarding e instalação assistida com confirmação.
- **Claude Code e Codex lado a lado** em terminais integrados, com login oficial dentro do app, permissões oficiais (padrão ou somente leitura) e Parar tudo.
- **Chat compartilhado com encaminhamento manual**: o texto é colado no terminal e você confirma com Enter; modos Debate e Debug.
- **Desenvolvedor/revisor** com diff do Git, aprovação humana e limite de rodadas.
- **Git Worktrees**: um branch por agente/tarefa, conflitos previstos, integração e desfazer com confirmação.
- **Editor Monaco**, Explorer, Dashboard, histórico pesquisável (exportar/apagar/retenção) e **uso dos planos** (5 horas e semanal) pelas fontes oficiais.
- Logs sanitizados, exportação de diagnóstico e recuperação de falhas.
- **Instaladores** com Electron endurecido (Fuses), aviso de nova versão (sem download automático) e **memória compartilhada opcional** via [ai-memory](https://github.com/akitaonrails/ai-memory).

A POC da Fase 0 está em `poc/`.

## Desenvolvimento
Requisitos: Node.js ≥ 22.13 e npm.

```bash
npm install
npm run dev        # abre o app em modo desenvolvimento
npm run check          # typecheck + testes unitários + build + testes E2E
npm run test:coverage  # cobertura dos testes unitários
npm run test:real      # opcional: usa as CLIs e contas reais (não envia prompts)
npm run dist:dir       # empacota sem instalador (release/)
npm run dist           # instaladores da plataforma atual
DEVFUSION_PACKAGED_EXE=<executável> npm run test:package   # testa o app empacotado
```

No macOS com a pasta Documents no iCloud, gere o pacote fora dela (o `codesign` recusa atributos do iCloud): `npx electron-builder --mac -c.directories.output=/tmp/devfusion-release`. Releases: uma tag `vX.Y.Z` igual à versão do `package.json` dispara `.github/workflows/release.yml`, que gera e testa os instaladores e cria uma release **rascunho**; quem publica é você. Windows é a prioridade inicial; macOS e Linux serão homologados separadamente. A automação via assinaturas deve ser validada antes de investir em funcionalidades avançadas. Não extrair credenciais, contornar limites nem presumir permissão de automação. Se não houver integração suportada, manter os terminais oficiais e transferência manual de mensagens.

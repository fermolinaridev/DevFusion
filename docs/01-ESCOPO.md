# Escopo e requisitos

## Objetivo
Dois agentes de programação independentes trabalham no mesmo projeto lógico, com comunicação, delegação, revisão, testes e supervisão humana. Aplicação desktop local, sem exigir terminal externo do usuário.

## Requisitos funcionais
| ID | Requisito |
|---|---|
| RF01 | Diagnosticar dependências a cada inicialização. |
| RF02 | Oferecer instalação e atualização assistida, mediante consentimento. |
| RF03 | Autenticar cada agente pelo fluxo oficial da CLI, sem coletar credenciais. |
| RF04 | Exibir dois terminais interativos redimensionáveis. |
| RF05 | Selecionar workspace local e restaurar sessões quando possível. |
| RF06 | Enviar mensagem a um agente ou ambos; permitir encaminhamento manual. |
| RF07 | Encaminhar mensagens automaticamente apenas por mecanismo oficialmente suportado. |
| RF08 | Distribuir tarefas, executar pipelines e registrar estados. |
| RF09 | Implementar modo desenvolvedor/revisor, com aprovação humana. |
| RF10 | Isolar alterações paralelas com Git Worktrees; mostrar diffs e conflitos. |
| RF11 | Persistir histórico, tarefas, aprovações e configurações localmente. |
| RF12 | Permitir pausar, cancelar, interromper e parar todos os agentes. |
| RF13 | Exibir editor, explorador, dashboard e histórico. |
| RF14 | Oferecer modo individual quando apenas um agente estiver disponível. |
| RF15 | Tratar falhas, desconexões e limites de uso sem tentar burlá-los. |

## Requisitos não funcionais
- Windows inicialmente; arquitetura multiplataforma para macOS/Linux.
- Sem servidor próprio ou API key obrigatória para o modo básico.
- Interface responsiva, logs sanitizados, validação de IPC e isolamento de contexto.
- Configurações e banco local; sem credenciais dos provedores no banco.
- Uso de memória controlado: limitar scrollback, virtualizar listas e carregar editor sob demanda.
- Não pressupor que execução local significa IA offline: as CLIs consultam serviços externos.

## MVP v0.1
Situação em 2026-11-20 (v0.1.0, validado no macOS; Windows/Linux pendentes):
- [x] Diagnóstico e instalação assistida (Fase 2)
- [x] Login oficial e dois terminais (Fase 3)
- [x] Seleção de workspace (Fase 3)
- [x] Chat central e encaminhamento manual (Fase 4)
- [ ] Encaminhamento automático se autorizado e tecnicamente suportado — **fora do v0.1 por decisão do usuário**: Claude bloqueado pelos termos; Codex via App Server fica como opt-in futuro ([13-FASE4-ORQUESTRACAO.md](13-FASE4-ORQUESTRACAO.md))
- [x] Desenvolvedor/revisor (Fase 4)
- [x] Histórico local (chat, tarefas, aprovações e sessões no SQLite; tela de Sessões na Fase 6)
- [x] Controle de permissões, interrupção e parada geral (Fases 3 e 4)

## Fora do MVP / v2
GitHub/GitLab, MCP, Gemini, Ollama, agentes customizados, equipes maiores, plugins/skills, workflows visuais, indexação, memória compartilhada avançada, grafo de dependências, SSH, CPU/RAM, métricas, agendamento e voz.

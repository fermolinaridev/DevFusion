# Roadmap
Estimativa inicial de referência: 13 semanas de trabalho individual; não é promessa. Cada fase depende da aceitação da anterior.

| Fase | Duração | Entregável |
|---|---|---|
| 0 | 1 semana | Prova de conceito sem API key |
| 1 | 1 semana | Fundação Electron executável |
| 2 | 1 semana | System Doctor e onboarding |
| 3 | 2 semanas | Dois agentes na mesma tela |
| 4 | 2 semanas | Comunicação e revisão coordenada |
| 5 | 2 semanas | Git Worktrees e integração segura |
| 6 | 2 semanas | Interface avançada |
| 7 | 1 semana | Beta testada |
| 8 | 1 semana | Distribuição v1.0 |

## 0 — Pesquisa e POC
- [x] Conferir termos e documentação oficial atual de ambos.
- [~] Validar login de assinatura, PTY, entrada/saída, eventos, sessões e encaminhamento. Codex e Claude validados com assinatura (Plus/Pro); retomada de sessão e Windows pendentes.
- [x] Registrar resultado e limitações. Bloquear automação não suportada. Ver [09-FASE0-POC.md](09-FASE0-POC.md).

## 1 — Fundação
- [x] Electron/React/TypeScript/Vite/Tailwind, preload e IPC seguro.
- [x] SQLite, migrações, configurações e layout inicial. Ver [10-FASE1-FUNDACAO.md](10-FASE1-FUNDACAO.md) (validado no macOS; Windows pendente).

## 2 — System Doctor
- [x] Detectar SO, PATH, versões, autenticação, internet, disco e permissões.
- [x] Instalação assistida, onboarding, rechecagem e modo degradado. Ver [11-FASE2-SYSTEM-DOCTOR.md](11-FASE2-SYSTEM-DOCTOR.md) (validado no macOS; Windows pendente; login no app na Fase 3).

## 3 — Agentes
- [x] Adapters, node-pty, xterm.js, processos independentes, eventos e cancelamento. Ver [12-FASE3-AGENTES.md](12-FASE3-AGENTES.md).
- [x] Testar ambos os agentes com contas oficiais do usuário (Claude Pro e Codex Plus validados no app; Windows pendente).

## 4 — Orquestração
- [x] Bus, fila, estados, tarefas, limites e proteção contra loops.
- [x] Modo manual e code review (desenvolvedor/revisor). Colaborativo = chat compartilhado + encaminhamento manual.
- [x] Aprovações humanas registradas; encaminhamento automático não habilitado (decisão do usuário; Claude bloqueado por termos).
- [x] Entregar MVP v0.1 (v0.1.0, macOS). Ver [13-FASE4-ORQUESTRACAO.md](13-FASE4-ORQUESTRACAO.md).

## 5 — Git
- [x] Seleção de projeto, árvore, monitoramento, branches, worktrees, diff, conflitos, merge e rollback autorizados. Ver [15-FASE5-GIT.md](15-FASE5-GIT.md) (macOS; Windows pendente).

## 6 — UI avançada
- [x] Monaco, dashboard, histórico, temas, atalhos, notificações, personalização, modos avançados suportados. Ver [16-FASE6-UI.md](16-FASE6-UI.md) (macOS; Windows pendente).

## 7 — Estabilidade
- [x] Unitários, integração e E2E; falhas, limites, recuperação, processos órfãos, logs sanitizados e revisão de segurança. Ver [17-FASE7-ESTABILIDADE.md](17-FASE7-ESTABILIDADE.md) (beta 0.2.0-beta.1; CI Windows + Linux).

## 8 — Distribuição
- [ ] Instalador Windows, depois macOS/Linux após testes específicos.
- [ ] README, manual, documentação, GitHub Releases e atualizações verificadas.

## Critério de lançamento
Em instalação limpa o aplicativo verifica o ambiente, permite instalar/autenticar por fluxos oficiais e abrir um workspace com dois terminais. O usuário consegue encaminhar uma tarefa, revisar o resultado, salvar histórico e interromper processos. Automação só entra no release quando validada. Testes e limitações documentados; nenhum segredo armazenado.

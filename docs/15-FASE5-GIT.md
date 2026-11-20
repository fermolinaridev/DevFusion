# Fase 5 — Git Worktrees e integração segura

Status: **concluída no macOS** (Windows/Linux não testados) · Pré-requisito: MVP v0.1.0 e painel de uso ([13](13-FASE4-ORQUESTRACAO.md), [14](14-USO-DOS-PLANOS.md)).
Referência: [05-WORKSPACE.md](05-WORKSPACE.md) e [08-SEGURANCA.md](08-SEGURANCA.md).

## Inspeção do repositório (início da fase)
- Workspace validado (caminho real), branch exibida; `GitManager.reviewSnapshot` só lê (`status`/`diff`) com exclusão de arquivos sensíveis.
- Agentes sempre rodam na raiz do workspace; não há worktrees, diff navegável, conflitos, merge ou rollback.
- Tabela `git_snapshots` existe (migração 1) mas não é usada. Git local: 2.54 (tem `merge-tree --write-tree` para checar conflitos sem tocar no disco).

## Escopo
Roadmap: seleção de projeto, árvore, monitoramento, branches, worktrees, diff, conflitos, merge e rollback **autorizados**.

## Plano
1. **WorktreeManager** (todos os comandos Git com argumentos separados, nunca shell):
   - Criar branch + worktree **a partir de uma referência explícita** (padrão: branch atual), em pasta do app (`userData/worktrees/…`), para não sujar o projeto. Alterações não commitadas da raiz **não** são copiadas: o app avisa e pede confirmação.
   - Listar (`git worktree list --porcelain`), estado (à frente/atrás, arquivos alterados), diff do branch contra a base + alterações não commitadas.
   - Commit no worktree (mensagem do usuário, só no branch do worktree).
2. **Integração autorizada** (confirmação em diálogo nativo do main):
   - Pré-checagem de conflitos com `git merge-tree --write-tree` (não altera nada).
   - Merge `--no-ff` só se a raiz estiver limpa e no branch alvo; se der conflito, `merge --abort` e relatório. Snapshot do commit anterior em `git_snapshots`.
   - Desfazer integração com `git revert -m 1` (cria commit novo, não reescreve histórico).
   - Remover worktree: confirmação; com alterações ou commits não integrados, aviso explícito do que será perdido.
3. **Agentes por local**: iniciar cada agente na raiz ou num worktree do workspace (cwd validado). Tarefas podem ganhar worktree próprio (modo paralelo); a revisão usa o diff do worktree.
4. **Explorer**: árvore do local selecionado (carregamento sob demanda, sem sair da raiz, symlinks que escapam recusados), status Git por arquivo, atualização por observação de arquivos; diff de arquivo somente leitura.
5. Ajuste pendente: card do Claude indica "sessão ativa, aguardando a primeira resposta".

## Critérios de aceitação
| # | Critério |
|---|---|
| G1 | Worktree criado a partir de referência explícita, em branch próprio, fora da pasta do projeto, com confirmação; aviso quando a raiz tem alterações não commitadas. |
| G2 | Diff do worktree (commits do branch + não commitado) e lista de arquivos alterados, sem arquivos sensíveis no conteúdo enviado a agentes. |
| G3 | Conflitos detectados antes do merge sem alterar o repositório. |
| G4 | Merge só com confirmação, raiz limpa e branch alvo correto; conflito inesperado é abortado sem perder trabalho. |
| G5 | Rollback por `revert` (histórico preservado) com confirmação. |
| G6 | Remoção de worktree só com confirmação; nada é descartado em silêncio. |
| G7 | Agentes rodam no worktree escolhido; tarefas em paralelo revisadas pelo diff do próprio worktree. |
| G8 | Explorer não lê fora da raiz (path traversal e symlinks), mostra status Git e se atualiza. |
| G9 | Nenhum `git init`, `reset --hard`, `push` ou `--force` em histórico; todas as mutações auditadas. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| G1 | ✅ | Unitário: branch `devfusion/<nome>-xxxx` a partir de `main`, pasta em `userData/worktrees`, alteração não commitada da raiz não copiada e avisada; E2E: recusa no diálogo nativo não cria nada |
| G2 | ✅ | Unitário: lista de arquivos desde a base, commit **sem** `.env`; E2E: diff do arquivo e commit pela UI; revisão de tarefa usa o diff do worktree e ignora a raiz |
| G3 | ✅ | `git merge-tree --write-tree` prevê conflito em `a.txt` com HEAD e status da raiz inalterados (unitário e E2E) |
| G4 | ✅ | Bloqueios: raiz suja, worktree com não commitado, nada a integrar, HEAD destacado; merge `--no-ff` com 2 pais; conflito inesperado → `merge --abort` |
| G5 | ✅ | `git revert -m 1`: arquivo volta, histórico com 4 commits (sem reset) |
| G6 | ✅ | Perda (não commitado / commits não integrados) exige confirmação; diálogo lista exatamente o que será descartado |
| G7 | ✅ | E2E: agente iniciado no worktree (cwd confirmado), tarefa em worktree recusa envio com o desenvolvedor na raiz; **teste real**: Claude e Codex abriram dentro do worktree |
| G8 | ✅ | Unitário: `..`, caminho absoluto e symlink para fora bloqueados; `.git` oculto; E2E: status M/U, pastas sob demanda, arquivo novo aparece sozinho (monitoramento) |
| G9 | ✅ | Comandos usados: `worktree add/list/remove/prune`, `status`, `diff`, `add` (sem sensíveis), `commit` (hooks respeitados), `merge-tree`, `merge --no-ff`/`--abort`, `revert`/`--abort`, `branch -d/-D` (só com confirmação). Nada de `init`, `reset --hard`, `push` ou force em histórico |

Totais: **104 testes unitários** e **31 E2E**, todos passando.

### Teste real (CLIs oficiais)
Repositório descartável → worktree criado pelo app → Claude Code e Codex iniciados **no worktree**:
- Claude pede "trust this folder" para a pasta do worktree (cada worktree novo é uma pasta nova).
- Codex avisa que a confiança vale para a **raiz do repositório principal** (worktrees de um projeto já confiável não perguntam de novo).
- Parar tudo encerrou os dois; remoção do worktree pela UI funcionou; `~/.codex/config.toml` intacto (nenhuma confiança foi dada no teste).

## Decisões
1. **Worktrees na pasta do app** (`userData/worktrees/<workspace>/<nome>`), não dentro do projeto: não aparecem como arquivos não rastreados nem confundem os agentes na raiz. Botão "Abrir pasta" para localizar.
2. **Toda mutação de Git com confirmação nativa no main** (criar, integrar, desfazer, remover). Commit no branch do worktree é ação direta do usuário na UI (não afeta a raiz).
3. **Pré-checagem de conflitos sem tocar no disco** (`merge-tree --write-tree`, Git ≥ 2.38).
4. **Rollback por revert**, nunca `reset`: o histórico é preservado e a operação é reversível.
5. **Commit respeita hooks** do repositório e nunca adiciona `.env`, chaves ou credenciais.
6. **Explorer somente leitura** com contenção por caminho real; observação por `fs.watch` recursivo com debounce.
7. **Tarefa em worktree**: o envio ao desenvolvedor exige que ele esteja rodando dentro do worktree da tarefa (evita editar a raiz por engano).
8. Saída do Git lida em modo `raw` (sem sanitização) só para uso interno; o que vai para agentes continua passando por `redact()`.
9. Correção encontrada pelos E2E: seletores do Zustand que devolviam arrays novos causavam laço de renderização (tela em branco); agora filtram fora do seletor.
10. Ajuste do card do Claude: com sessão aberta e sem números, mostra "Sessão do Claude ativa: aguardando a primeira resposta".

## Limitações e pendências
- Windows/Linux não testados (o `fs.watch` recursivo no Linux exige Node ≥ 20, presente no Electron 45).
- Cada worktree novo pode pedir "trust" ao Claude.
- Resolução de conflitos é responsabilidade do usuário/agente dentro do worktree; o app só detecta e bloqueia.
- O Explorer não edita arquivos (editor Monaco na Fase 6).
- Nada é enviado a remotos (sem `push`/PR); integração é local.

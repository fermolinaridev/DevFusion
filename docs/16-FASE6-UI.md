# Fase 6 — Interface avançada

Status: **concluída no macOS** (Windows/Linux não testados) · Pré-requisito: Fase 5 aceita no macOS ([15-FASE5-GIT.md](15-FASE5-GIT.md)).
Referência: [06-INTERFACE.md](06-INTERFACE.md) e roadmap: "Monaco, dashboard, histórico, temas, atalhos, notificações, personalização, modos avançados suportados".

## Inspeção do repositório (início da fase)
- Explorer somente leitura com diff em texto; tema claro/escuro/sistema; sidebar com 7 vistas (Sessões ainda é placeholder).
- Histórico (mensagens, tarefas, aprovações, sessões) já está no SQLite, mas não há busca, exportação, exclusão nem retenção.
- Não há dashboard, atalhos de teclado nem notificações.

## Plano
1. **Editor Monaco carregado sob demanda** (nada é baixado da internet; CSP mantida): abrir arquivos pelo Explorer, editar e salvar no workspace/worktree com contenção de caminho, limite de tamanho, recusa de binários e detecção de alteração externa antes de sobrescrever.
2. **Sessões/histórico**: busca nas mensagens, lista de sessões de agentes e tarefas; exportar (JSON, local escolhido no diálogo nativo) e excluir (confirmação nativa); retenção configurável aplicada na abertura.
3. **Dashboard**: workspaces recentes (reabrir), agentes e diagnóstico, uso dos planos, tarefas por estado, sessões ativas e worktrees.
4. **Modos de conversa suportados** no chat: Manual, Debate e Debug como **modelos de mensagem** para os dois agentes (sempre colados, Enter do usuário); Revisão/Pipeline/Paralelo levam às Tarefas e ao Git; **Autônomo aparece indisponível** com o motivo.
5. **Atalhos de teclado** com lista visível; **notificações** do sistema só para fatos (processo de agente falhou, instalação concluída, janela de uso ≥ 90%) e só com a janela em segundo plano; **personalização**: tamanho da fonte do terminal, retenção, notificações.

## Critérios de aceitação
| # | Critério |
|---|---|
| U1 | Monaco só carrega quando um arquivo é aberto; funciona com a CSP sem rede externa. |
| U2 | Salvar não escreve fora da raiz, recusa binários/arquivos grandes e não sobrescreve alteração externa sem confirmação. |
| U3 | Histórico pesquisável; exportação gera arquivo escolhido pelo usuário; exclusão exige confirmação e preserva a auditoria. |
| U4 | Retenção remove mensagens antigas na abertura conforme configuração (0 = manter). |
| U5 | Dashboard mostra apenas dados reais e permite reabrir workspaces recentes válidos. |
| U6 | Modos indisponíveis aparecem desabilitados com motivo; modelos nunca enviam sozinhos. |
| U7 | Atalhos funcionam sem atrapalhar a digitação nos terminais; lista de atalhos acessível. |
| U8 | Notificações apenas com fatos e respeitando a configuração. |

## Resultado (2026-11-20, macOS 27.2 arm64)

| # | Status | Evidência |
|---|---|---|
| U1 | ✅ | E2E: nenhum recurso do Monaco carregado antes de abrir um arquivo; editor renderiza no app compilado (`file://`) com a CSP atual, sem erros de CSP/worker. O Monaco fica num pedaço separado do build (~5 MB) com um único worker |
| U2 | ✅ | Unitários: fora da raiz, symlink para fora, binário, > 2 MB, pasta e arquivo inexistente recusados; alteração externa vira conflito. E2E: ⌘/Ctrl+S salva, conflito pergunta "recarregar ou sobrescrever" sem escrever antes da escolha |
| U3 | ✅ | Busca com `%`/`_` escapados; exportação JSON (`devfusion-history/1`) no local escolhido; exclusão com confirmação nativa, mantendo tarefas em andamento e a auditoria (unitário + E2E) |
| U4 | ✅ | Retenção por dias aplicada na abertura; 0 = manter (unitário) |
| U5 | ✅ | Dashboard com agentes, uso, tarefas, worktrees e recentes; reabrir recente; pasta apagada aparece como "não encontrada" (E2E) |
| U6 | ✅ | "Autônomo" desabilitado com motivo; Debate/Debug colam o modelo nos dois terminais e nada é submetido (E2E) |
| U7 | ✅ | ⌘/Ctrl+1…8 (vistas), +K (chat), +Shift+1/2 (terminais), +Shift+. (Parar tudo), +Shift+/ (ajuda), +S (salvar). Capturados antes do xterm/Monaco, só com ⌘/Ctrl, que os terminais não usam para texto (E2E) |
| U8 | ✅ | Unitário do `Notifier`: respeita configuração, foco da janela e deduplicação; gatilhos só por fatos (código de saída ≠ 0 sem ser encerrado pelo usuário, fim de instalação, janela de uso ≥ 90% informada pela fonte oficial) |

Totais: **112 testes unitários** e **34 E2E**, todos passando.

## Decisões
1. **Monaco mínimo e local**: `editor.api` + definições de linguagem (só realce de sintaxe) + um worker; nada de CDN. Sem serviços de linguagem (TypeScript/JSON), para manter o pacote e a memória sob controle.
2. **Abas Agentes/arquivos**: os terminais ficam montados e com tamanho real (invisíveis) enquanto o editor está à frente, para as CLIs não receberem um redimensionamento falso.
3. **Salvar só arquivos existentes**, sem criar arquivos novos pelo editor nesta fase; auditoria `file.save`.
4. **Exclusão de histórico** preserva `audit_logs`, tarefas em andamento e worktrees.
5. **Modos de conversa** sem automação: Debate e Debug são modelos de texto; Revisão/Pipeline levam às Tarefas e Paralelo ao Git; Autônomo só aparece desabilitado.
6. **Dashboard como vista inicial**; atalhos ⌘/Ctrl+1…8 seguem a ordem da barra lateral.

## Limitações e pendências
- O `npm audit` aponta 2 alertas de **baixa severidade** no `dompurify` embutido no Monaco 0.57 (usado para renderizar markdown de dicas). O editor só abre arquivos locais do próprio workspace; reavaliar na Fase 7 quando houver versão corrigida.
- O editor não cria, renomeia nem apaga arquivos; não há busca global nem serviços de linguagem.
- Notificações dependem da permissão do sistema operacional para o app.
- Windows/Linux não testados (atalhos usam Ctrl fora do macOS).

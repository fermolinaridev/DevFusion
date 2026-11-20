# Interface

Visual profissional, semelhante a IDE moderna, com tema escuro e claro; painéis redimensionáveis, acessibilidade, navegação por teclado e terminal expansível.

```text
┌───────────────────────────────────────────────────────────┐
│ DevFusion    Workspace: SafeVision       2 agentes online │
├───────────┬──────────────────────┬────────────────────────┤
│ Explorer  │ Claude Code          │ Codex                  │
│ Agents    │ Terminal / conversas │ Terminal / conversas   │
│ Tasks     │ Implementação        │ Revisão                │
│ Git       │ Status e logs        │ Status e logs          │
│ Sessions  ├──────────────────────┴────────────────────────┤
│ Settings  │ Chat compartilhado / eventos / aprovações     │
│           │ [Mensagem...] [Destino] [Enviar] [Parar tudo]│
├───────────┴───────────────────────────────────────────────┤
│ Git branch · Estado das sessões · Diagnóstico · Limites   │
└───────────────────────────────────────────────────────────┘
```

## Páginas
Onboarding/System Doctor: status por dependência, versão, instalação assistida, login oficial, revalidar e continuar individualmente.
Dashboard: projetos recentes, sessões, agentes detectados e tarefas.
Workspace: árvore de arquivos, terminais, editor Monaco, diffs, chat, seletor de modo, destino, permissões, aprovação e parada geral.
Sessions: histórico pesquisável, status, exportação e exclusão.
Settings: caminhos de CLIs, tema, limites, permissões, retenção e diagnósticos.

Mostrar estados reais (desconectado, ocupado, aguardando aprovação, limitado, falha), nunca inventar contagem de tokens ou teste aprovado. Não apresentar botão automático como disponível se a integração não o suporta.

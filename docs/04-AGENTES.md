# Agentes e orquestração

## Prova de conceito obrigatória
Validar na documentação atual dos provedores a execução com login de assinatura e o uso em aplicativo local. Não usar autenticação de consumidor como backend não autorizado. Testar sessões oficiais em PTY (claude e codex). Considerar Codex App Server e modos estruturados documentados de cada CLI apenas se compatíveis com assinatura e termos. Não interceptar credenciais. Se a automação não for suportada, manter terminal incorporado e encaminhamento manual; deixar modo automático desativado.

## Interface proposta
```ts
interface AgentAdapter {
  id: string;
  name: string;
  checkInstallation(): Promise<boolean>;
  checkAuthentication(): Promise<boolean | 'unknown'>;
  capabilities(): Promise<{interactive: boolean; automatable: boolean; structuredEvents: boolean}>;
  startSession(workspace: string): Promise<void>;
  sendMessage(message: string): Promise<void>;
  getStatus(): AgentStatus;
  interrupt(): Promise<void>;
  closeSession(): Promise<void>;
}
type AgentStatus = 'idle' | 'running' | 'awaiting_approval' | 'rate_limited' | 'failed' | 'disconnected' | 'completed';
```
CodexAdapter e ClaudeCodeAdapter implementam essa interface. Eventos estruturados quando disponíveis; não inferir término exclusivamente por texto ANSI ou espera fixa. PTY é apropriado para terminal interativo, não garante protocolo de automação confiável.

## Bus de mensagens
```json
{"id":"msg_001","from":"claude","to":"codex","type":"review_request","taskId":"task_001","content":"Revise a autenticação.","attachments":["src/auth.ts"],"priority":"high"}
```
Validar com Zod; IDs únicos, deduplicação, histórico, origem, destino, dependências de tarefa, limite de mensagens, timeout e cancelamento. Nunca interpretar mensagem de agente como autorização do usuário. Encaminhar conteúdo com contexto mínimo necessário.

## Modos
| Modo | Comportamento |
|---|---|
| Manual | Usuário controla encaminhamento |
| Individual | Um agente |
| Colaborativo | Discussão e implementação |
| Paralelo | Tarefas independentes em worktrees |
| Code Review | Um escreve, outro revisa |
| Debate | Comparação de abordagens |
| Debug | Investigação coordenada |
| Pipeline | Plano, implementação, testes, revisão |
| Autônomo | Limites e aprovações explícitas |

Papéis personalizáveis: arquiteto, desenvolvedor, QA, revisor, segurança e banco de dados.

## Exemplo
Usuário solicita autenticação segura → Claude planeja → Codex valida plano → Claude implementa → Codex recebe diff e revisa/testa → Claude corrige → orquestrador apresenta resultado e pede aprovação. Atribuições reversíveis. Rodadas máximas configuráveis (proposta inicial: 3 de revisão); parar quando critérios atendidos, limite atingido, erro ou necessidade de aprovação. Limite de assinatura implica pausa, não troca automática para API paga.

## Referências oficiais a confirmar durante implementação
- https://developers.openai.com/codex/
- https://code.claude.com/docs/

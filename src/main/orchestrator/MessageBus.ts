import { randomUUID } from 'node:crypto';
import { AGENT_NAMES, type AgentId } from '@shared/agents';
import { MAX_MESSAGE_CHARS, forwardHeader as header, type ChatMessage, type ChatTarget, type MessageKind } from '@shared/orchestration';
import type { MessageRepository } from '../database/repositories/MessageRepository';
import type { LoopGuard } from './LoopGuard';

export class BusError extends Error {}

export interface MessageBusDeps {
  repo: MessageRepository;
  guard: LoopGuard;
  workspaceId: () => string | null;
  isRunning: (agent: AgentId) => boolean;
  /** Cola o texto no terminal do agente (sem Enter). */
  deliver: (agent: AgentId, text: string) => Promise<void>;
  emit: (msg: ChatMessage) => void;
  now?: () => Date;
}

export const forwardHeader = (from: AgentId) => header(AGENT_NAMES[from]);

/**
 * Barramento do modo manual: valida, deduplica, persiste e entrega por colagem no
 * terminal. Não lê a saída dos agentes nem envia Enter: submeter é sempre do usuário.
 */
export class MessageBus {
  constructor(private readonly d: MessageBusDeps) {}

  async send(input: { kind: MessageKind; sender: ChatMessage['sender']; to: ChatTarget; content: string; taskId?: string | null }): Promise<ChatMessage> {
    const workspaceId = this.d.workspaceId();
    if (!workspaceId) throw new BusError('Selecione um workspace antes de enviar mensagens.');
    const body = input.content.trim();
    if (!body) throw new BusError('Mensagem vazia.');
    const targets: AgentId[] = input.to === 'both' ? ['claude', 'codex'] : [input.to];
    if (input.sender === 'claude' || input.sender === 'codex') {
      if (targets.includes(input.sender)) throw new BusError('Um agente não pode encaminhar para si mesmo.');
    }
    const text = input.sender === 'claude' || input.sender === 'codex' ? `${forwardHeader(input.sender)}\n\n${body}` : body;
    if (text.length > MAX_MESSAGE_CHARS) throw new BusError(`Mensagem acima de ${MAX_MESSAGE_CHARS} caracteres.`);
    const stopped = targets.filter((t) => !this.d.isRunning(t));
    if (stopped.length) throw new BusError(`Inicie ${stopped.map((t) => AGENT_NAMES[t]).join(' e ')} antes de enviar.`);
    if (this.d.guard.checkDuplicate(input.to, text)) throw new BusError('Mensagem idêntica enviada há instantes para o mesmo destino; ignorada.');

    for (const t of targets) {
      try { await this.d.deliver(t, text); }
      catch (e) { throw new BusError((e as Error).message); }
    }
    const msg: ChatMessage = {
      id: randomUUID(), workspaceId, taskId: input.taskId ?? null, kind: input.kind,
      sender: input.sender, recipient: input.to, content: text, createdAt: (this.d.now?.() ?? new Date()).toISOString(),
    };
    this.d.repo.insert(msg);
    this.d.emit(msg);
    return msg;
  }

  /** Evento do sistema no histórico (ex.: tarefa criada, decisão humana). Não vai a nenhum agente. */
  event(content: string, taskId: string | null = null): ChatMessage | null {
    const workspaceId = this.d.workspaceId();
    if (!workspaceId) return null;
    const msg: ChatMessage = { id: randomUUID(), workspaceId, taskId, kind: 'event', sender: 'system', recipient: 'user', content, createdAt: (this.d.now?.() ?? new Date()).toISOString() };
    this.d.repo.insert(msg);
    this.d.emit(msg);
    return msg;
  }

  history(limit = 200): ChatMessage[] {
    const ws = this.d.workspaceId();
    return ws ? this.d.repo.recent(ws, limit) : [];
  }
}

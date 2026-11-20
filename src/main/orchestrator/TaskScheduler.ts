import { randomUUID } from 'node:crypto';
import { AGENT_NAMES } from '@shared/agents';
import { FINAL_TASK_STATUSES, type OutboundPreview, type Task, type TaskDecision, type TaskOutbound, type TaskStatus } from '@shared/orchestration';
import type { ApprovalRepository } from '../database/repositories/ApprovalRepository';
import type { TaskRepository } from '../database/repositories/TaskRepository';
import type { ReviewSnapshot } from '../workspace/GitManager';
import type { LoopGuard } from './LoopGuard';
import type { MessageBus } from './MessageBus';

export class TaskError extends Error {}

export interface TaskSchedulerDeps {
  repo: TaskRepository;
  approvals: ApprovalRepository;
  bus: MessageBus;
  guard: LoopGuard;
  workspace: () => { id: string; path: string } | null;
  maxRounds: () => number;
  snapshot: (path: string) => Promise<ReviewSnapshot>;
  audit: (action: string, target: string, metadata: Record<string, unknown>) => void;
  emit: (task: Task) => void;
}

const OUTBOUND_KIND = { send_to_developer: 'task', request_review: 'review_request', send_corrections: 'correction_request' } as const;

/**
 * Fluxo desenvolvedor/revisor com máquina de estados explícita. O app só prepara
 * textos (sempre pré-visualizados) e registra decisões humanas; nunca decide sozinho.
 */
export class TaskScheduler {
  constructor(private readonly d: TaskSchedulerDeps) {}

  list(): Task[] {
    const ws = this.d.workspace();
    return ws ? this.d.repo.list(ws.id) : [];
  }

  create(input: { title: string; description: string; criteria: string[]; developer: Task['developer']; reviewer: Task['reviewer'] }): Task {
    const ws = this.requireWorkspace();
    const now = new Date().toISOString();
    const task: Task = { id: randomUUID(), workspaceId: ws.id, ...input, status: 'draft', rounds: 0, maxRounds: this.d.maxRounds(), createdAt: now, updatedAt: now };
    this.d.repo.insert(task);
    this.d.audit('task.create', task.id, { developer: task.developer, reviewer: task.reviewer });
    this.d.bus.event(`Tarefa criada: "${task.title}" — desenvolvedor ${AGENT_NAMES[task.developer]}, revisor ${AGENT_NAMES[task.reviewer]}.`, task.id);
    this.d.emit(task);
    return task;
  }

  /** Monta o texto que seria enviado; nada sai do app aqui. */
  async preview(taskId: string, action: TaskOutbound, notes?: string): Promise<OutboundPreview> {
    const task = this.get(taskId);
    this.assertOutboundAllowed(task, action);
    if (action === 'send_to_developer') return { target: task.developer, content: developerPrompt(task), warnings: [] };
    if (action === 'send_corrections') {
      if (!notes?.trim()) throw new TaskError('Cole ou selecione os apontamentos do revisor para enviar ao desenvolvedor.');
      return { target: task.developer, content: correctionPrompt(task, notes.trim()), warnings: [] };
    }
    const ws = this.requireWorkspace();
    const snap = await this.d.snapshot(ws.path);
    return { target: task.reviewer, content: reviewPrompt(task, snap), warnings: snap.warnings };
  }

  /** Envia (cola no terminal) o texto aprovado pelo usuário e aplica a transição. */
  async send(taskId: string, action: TaskOutbound, content: string): Promise<Task> {
    const task = this.get(taskId);
    this.assertOutboundAllowed(task, action);
    const target = action === 'request_review' ? task.reviewer : task.developer;
    await this.d.bus.send({ kind: OUTBOUND_KIND[action], sender: 'user', to: target, content, taskId: task.id });
    const next: { status: TaskStatus; rounds: number } =
      action === 'send_to_developer' ? { status: 'in_progress', rounds: task.rounds }
      : action === 'request_review' ? { status: 'in_review', rounds: task.rounds + 1 }
      : { status: 'in_progress', rounds: task.rounds };
    return this.transition(task, next, `task.${action}`);
  }

  /** Decisão humana. Texto de agente nunca chega aqui como aprovação. */
  decide(taskId: string, decision: TaskDecision, note?: string): Task {
    const task = this.get(taskId);
    if (FINAL_TASK_STATUSES.includes(task.status)) throw new TaskError('A tarefa já foi encerrada.');
    let next: TaskStatus;
    switch (decision) {
      case 'approve':
        if (task.status !== 'in_review') throw new TaskError('Só é possível aprovar depois de pedir revisão.');
        next = 'approved';
        this.d.approvals.recordDecision(task.id, 'task.complete', 'approved');
        break;
      case 'request_changes':
        if (task.status !== 'in_review') throw new TaskError('Peça correções depois de uma revisão.');
        if (!this.d.guard.canRequestReview(task)) throw new TaskError(`Limite de ${task.maxRounds} rodada(s) de revisão atingido. Aprove, rejeite ou cancele a tarefa.`);
        next = 'in_progress';
        break;
      case 'reject':
        if (task.status !== 'in_review' && task.status !== 'in_progress') throw new TaskError('Só é possível rejeitar uma tarefa em andamento ou em revisão.');
        next = 'rejected';
        this.d.approvals.recordDecision(task.id, 'task.complete', 'rejected');
        break;
      case 'cancel':
        next = 'cancelled';
        break;
    }
    const updated = this.transition(task, { status: next, rounds: task.rounds }, `task.decide.${decision}`, note);
    const label = { approve: 'aprovou', request_changes: 'pediu correções em', reject: 'rejeitou', cancel: 'cancelou' }[decision];
    this.d.bus.event(`Você ${label} a tarefa "${task.title}"${note ? `: ${note}` : '.'}`, task.id);
    return updated;
  }

  private assertOutboundAllowed(task: Task, action: TaskOutbound): void {
    if (FINAL_TASK_STATUSES.includes(task.status)) throw new TaskError('A tarefa já foi encerrada.');
    if (action === 'send_to_developer' && task.status !== 'draft' && task.status !== 'in_progress') throw new TaskError('A tarefa está em revisão; decida a revisão antes de reenviar ao desenvolvedor.');
    if (action === 'request_review') {
      if (task.status !== 'in_progress') throw new TaskError('Envie a tarefa ao desenvolvedor antes de pedir revisão.');
      if (!this.d.guard.canRequestReview(task)) throw new TaskError(`Limite de ${task.maxRounds} rodada(s) de revisão atingido. Aprove, rejeite ou cancele a tarefa.`);
    }
    if (action === 'send_corrections' && (task.status !== 'in_progress' || task.rounds === 0)) throw new TaskError('Correções só depois de uma revisão com pedido de mudanças.');
  }

  private transition(task: Task, next: { status: TaskStatus; rounds: number }, action: string, note?: string): Task {
    this.d.repo.update(task.id, next);
    this.d.audit(action, task.id, { from: task.status, to: next.status, rounds: next.rounds, ...(note ? { note } : {}) });
    const updated = this.get(task.id);
    this.d.emit(updated);
    return updated;
  }

  private get(id: string): Task {
    const t = this.d.repo.byId(id);
    const ws = this.d.workspace();
    if (!t || !ws || t.workspaceId !== ws.id) throw new TaskError('Tarefa não encontrada neste workspace.');
    return t;
  }

  private requireWorkspace() {
    const ws = this.d.workspace();
    if (!ws) throw new TaskError('Selecione um workspace.');
    return ws;
  }
}

const criteriaList = (t: Task) => (t.criteria.length ? t.criteria.map((c) => `- ${c}`).join('\n') : '- (sem critérios definidos)');

export function developerPrompt(t: Task): string {
  return [`Tarefa: ${t.title}`, t.description && `\n${t.description}`, `\nCritérios de aceitação:\n${criteriaList(t)}`, '\nImplemente no workspace atual. Ao terminar, resuma o que mudou e como verificar.'].filter(Boolean).join('\n');
}

export function reviewPrompt(t: Task, snap: ReviewSnapshot): string {
  return [
    `Revise a implementação da tarefa abaixo, feita por ${AGENT_NAMES[t.developer]} (rodada ${t.rounds + 1} de ${t.maxRounds}).`,
    'Não altere arquivos. Aponte problemas concretos, riscos e testes faltando, e diga para cada critério se foi atendido.',
    `\nTarefa: ${t.title}`, t.description && `\n${t.description}`,
    `\nCritérios de aceitação:\n${criteriaList(t)}`,
    snap.isRepo ? `\n${snap.text}` : '\n(O workspace não tem diff disponível; inspecione os arquivos diretamente.)',
  ].filter(Boolean).join('\n');
}

export function correctionPrompt(t: Task, notes: string): string {
  return [`Correções pedidas na revisão da tarefa "${t.title}" (rodada ${t.rounds} de ${t.maxRounds}):`, `\n${notes}`, '\nCorrija os pontos acima no workspace e resuma o que mudou.'].join('\n');
}

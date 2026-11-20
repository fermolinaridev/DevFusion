import { createHash } from 'node:crypto';
import type { Task } from '@shared/orchestration';

/**
 * Proteções contra repetição: mesma mensagem para o mesmo destino em janela curta
 * (clique duplo, reenvio acidental) e limite de rodadas de revisão por tarefa.
 */
export class LoopGuard {
  private readonly recent = new Map<string, number>();

  constructor(private readonly windowMs = 3000, private readonly now: () => number = Date.now) {}

  /** Registra o envio e diz se é duplicado dentro da janela. */
  checkDuplicate(target: string, content: string): boolean {
    const t = this.now();
    for (const [k, at] of this.recent) if (t - at > this.windowMs) this.recent.delete(k);
    const key = `${target}:${createHash('sha256').update(content).digest('hex')}`;
    if (this.recent.has(key)) return true;
    this.recent.set(key, t);
    return false;
  }

  canRequestReview(task: Pick<Task, 'rounds' | 'maxRounds'>): boolean {
    return task.rounds < task.maxRounds;
  }
}

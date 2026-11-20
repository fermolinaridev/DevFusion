import { randomUUID } from 'node:crypto';
import type { Db } from '../Database';

/** Decisões humanas (tabela `approvals`). Nunca criadas a partir de texto de agente. */
export class ApprovalRepository {
  constructor(private readonly db: Db) {}

  recordDecision(taskId: string, scope: string, status: 'approved' | 'rejected'): void {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO approvals (id, task_id, scope, status, requested_at, decided_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), taskId, scope, status, now, now);
  }

  forTask(taskId: string): Array<{ scope: string; status: string; decided_at: string }> {
    return this.db.prepare('SELECT scope, status, decided_at FROM approvals WHERE task_id = ? ORDER BY decided_at').all(taskId) as Array<{ scope: string; status: string; decided_at: string }>;
  }
}

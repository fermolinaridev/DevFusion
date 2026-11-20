import type { AgentId } from '@shared/agents';
import type { Task, TaskStatus } from '@shared/orchestration';
import type { Db } from '../Database';

interface Row { id: string; workspace_id: string; title: string; description: string; criteria_json: string; assignee: string; reviewer: string; status: string; rounds: number; max_rounds: number; created_at: string; updated_at: string }

const COLS = 'id, workspace_id, title, description, criteria_json, assignee, reviewer, status, rounds, max_rounds, created_at, updated_at';

export class TaskRepository {
  constructor(private readonly db: Db) {}

  insert(t: Task): void {
    this.db.prepare(`INSERT INTO tasks (id, workspace_id, parent_id, title, status, assignee, criteria_json, created_at, updated_at, description, reviewer, rounds, max_rounds)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(t.id, t.workspaceId, t.title, t.status, t.developer, JSON.stringify(t.criteria), t.createdAt, t.updatedAt, t.description, t.reviewer, t.rounds, t.maxRounds);
  }

  update(id: string, patch: { status: TaskStatus; rounds: number }): void {
    this.db.prepare('UPDATE tasks SET status = ?, rounds = ?, updated_at = ? WHERE id = ?').run(patch.status, patch.rounds, new Date().toISOString(), id);
  }

  byId(id: string): Task | null {
    const r = this.db.prepare(`SELECT ${COLS} FROM tasks WHERE id = ?`).get(id) as unknown as Row | undefined;
    return r ? toTask(r) : null;
  }

  list(workspaceId: string): Task[] {
    return (this.db.prepare(`SELECT ${COLS} FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200`).all(workspaceId) as unknown as Row[]).map(toTask);
  }
}

function toTask(r: Row): Task {
  let criteria: string[] = [];
  try { const c: unknown = JSON.parse(r.criteria_json); if (Array.isArray(c)) criteria = c.filter((x): x is string => typeof x === 'string'); } catch { /* critérios corrompidos: lista vazia */ }
  return { id: r.id, workspaceId: r.workspace_id, title: r.title, description: r.description, criteria, developer: r.assignee as AgentId, reviewer: r.reviewer as AgentId, status: r.status as TaskStatus, rounds: r.rounds, maxRounds: r.max_rounds, createdAt: r.created_at, updatedAt: r.updated_at };
}

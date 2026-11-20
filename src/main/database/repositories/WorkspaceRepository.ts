import { randomUUID } from 'node:crypto';
import type { Db } from '../Database';

export interface WorkspaceRow { id: string; path: string; name: string; created_at: string; last_opened_at?: string | null }

export class WorkspaceRepository {
  constructor(private readonly db: Db) {}

  /** Insere ou reaproveita o registro do caminho (caminho real, já validado). */
  upsert(path: string, name: string): WorkspaceRow {
    const existing = this.byPath(path);
    if (existing) return existing;
    const row: WorkspaceRow = { id: randomUUID(), path, name, created_at: new Date().toISOString() };
    this.db.prepare('INSERT INTO workspaces (id, path, name, created_at) VALUES (?, ?, ?, ?)').run(row.id, row.path, row.name, row.created_at);
    return row;
  }

  touch(id: string): void {
    this.db.prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  recent(limit = 10): WorkspaceRow[] {
    return this.db.prepare('SELECT id, path, name, created_at, last_opened_at FROM workspaces WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT ?').all(limit) as unknown as WorkspaceRow[];
  }

  byId(id: string): WorkspaceRow | null {
    return (this.db.prepare('SELECT id, path, name, created_at FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined) ?? null;
  }

  byPath(path: string): WorkspaceRow | null {
    return (this.db.prepare('SELECT id, path, name, created_at FROM workspaces WHERE path = ?').get(path) as WorkspaceRow | undefined) ?? null;
  }
}

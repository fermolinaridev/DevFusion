import type { ChatMessage, MessageKind } from '@shared/orchestration';
import type { HistoryOverview, SessionRecord } from '@shared/history';
import type { Db } from '../database/Database';

/** Busca, exportação, exclusão e retenção do histórico local. A auditoria nunca é apagada. */
export class HistoryService {
  constructor(private readonly db: Db) {}

  overview(workspaceId: string): HistoryOverview {
    const one = <T>(sql: string) => this.db.prepare(sql).get(workspaceId) as T;
    return {
      messages: one<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ?').n,
      sessions: one<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ?').n,
      tasks: one<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?').n,
      oldestMessageAt: one<{ t: string | null }>('SELECT MIN(created_at) AS t FROM messages WHERE workspace_id = ?').t,
    };
  }

  /** Busca simples por trecho (LIKE com escape de % e _), mais recentes primeiro. */
  search(workspaceId: string, query: string, limit: number): ChatMessage[] {
    const q = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db.prepare(`SELECT id, workspace_id, task_id, kind, sender, recipient, content, created_at FROM messages
      WHERE workspace_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(workspaceId, q, limit) as Array<Record<string, string | null>>;
    return rows.map((r) => ({ id: r['id']!, workspaceId: r['workspace_id']!, taskId: r['task_id'] ?? null, kind: r['kind'] as MessageKind, sender: r['sender'] as ChatMessage['sender'], recipient: r['recipient'] as ChatMessage['recipient'], content: r['content']!, createdAt: r['created_at']! }));
  }

  sessions(workspaceId: string, limit = 200): SessionRecord[] {
    return (this.db.prepare('SELECT id, agent_id, state, created_at, updated_at FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?').all(workspaceId, limit) as Array<Record<string, string>>)
      .map((r) => ({ id: r['id']!, agent: r['agent_id']!, state: r['state']!, createdAt: r['created_at']!, updatedAt: r['updated_at']! }));
  }

  /** Tudo do workspace em um objeto (o arquivo é escrito pelo main no local escolhido pelo usuário). */
  export(workspaceId: string): Record<string, unknown> {
    const all = (sql: string) => this.db.prepare(sql).all(workspaceId);
    return {
      format: 'devfusion-history/1',
      exportedAt: new Date().toISOString(),
      workspace: this.db.prepare('SELECT id, name, created_at FROM workspaces WHERE id = ?').get(workspaceId),
      messages: all('SELECT id, task_id, kind, sender, recipient, content, created_at FROM messages WHERE workspace_id = ? ORDER BY created_at'),
      tasks: all('SELECT id, title, description, status, assignee AS developer, reviewer, rounds, max_rounds, criteria_json, worktree_id, created_at, updated_at FROM tasks WHERE workspace_id = ? ORDER BY created_at'),
      approvals: all('SELECT a.id, a.task_id, a.scope, a.status, a.decided_at FROM approvals a JOIN tasks t ON t.id = a.task_id WHERE t.workspace_id = ? ORDER BY a.decided_at'),
      sessions: all('SELECT id, agent_id, state, created_at, updated_at FROM sessions WHERE workspace_id = ? ORDER BY created_at'),
      worktrees: all('SELECT id, name, branch, base_ref, base_sha, status, merged_sha, created_at FROM worktrees WHERE workspace_id = ? ORDER BY created_at'),
    };
  }

  /** Apaga mensagens, sessões e tarefas encerradas do workspace. Tarefas em andamento e auditoria ficam. */
  deleteWorkspaceHistory(workspaceId: string): { messages: number; sessions: number; tasks: number } {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const m = Number(this.db.prepare('DELETE FROM messages WHERE workspace_id = ?').run(workspaceId).changes);
      const s = Number(this.db.prepare("DELETE FROM sessions WHERE workspace_id = ? AND state NOT IN ('running')").run(workspaceId).changes);
      const t = Number(this.db.prepare("DELETE FROM tasks WHERE workspace_id = ? AND status IN ('approved', 'rejected', 'cancelled')").run(workspaceId).changes);
      this.db.exec('COMMIT;');
      return { messages: m, sessions: s, tasks: t };
    } catch (e) {
      this.db.exec('ROLLBACK;');
      throw e;
    }
  }

  /** Retenção: remove mensagens mais antigas que `days` (0 = não remove nada). */
  applyRetention(days: number, now = new Date()): number {
    if (days <= 0) return 0;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    return Number(this.db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff).changes);
  }
}

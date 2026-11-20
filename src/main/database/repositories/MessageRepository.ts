import type { ChatMessage, MessageKind } from '@shared/orchestration';
import type { Db } from '../Database';

interface Row { id: string; workspace_id: string; task_id: string | null; kind: string; sender: string; recipient: string; content: string; created_at: string }

export class MessageRepository {
  constructor(private readonly db: Db) {}

  insert(m: ChatMessage): void {
    this.db.prepare('INSERT INTO messages (id, session_id, task_id, sender, recipient, content, created_at, workspace_id, kind) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.taskId, m.sender, m.recipient, m.content, m.createdAt, m.workspaceId, m.kind);
  }

  /** Últimas `limit` mensagens do workspace, em ordem cronológica. */
  recent(workspaceId: string, limit: number): ChatMessage[] {
    const rows = this.db.prepare('SELECT id, workspace_id, task_id, kind, sender, recipient, content, created_at FROM messages WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(workspaceId, limit) as unknown as Row[];
    return rows.reverse().map((r) => ({ id: r.id, workspaceId: r.workspace_id, taskId: r.task_id, kind: r.kind as MessageKind, sender: r.sender as ChatMessage['sender'], recipient: r.recipient as ChatMessage['recipient'], content: r.content, createdAt: r.created_at }));
  }
}

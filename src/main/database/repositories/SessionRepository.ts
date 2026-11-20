import type { AgentId, AgentStatus } from '@shared/agents';
import type { Db } from '../Database';

export class SessionRepository {
  constructor(private readonly db: Db) {}

  create(id: string, workspaceId: string, agent: AgentId, state: AgentStatus): void {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO sessions (id, workspace_id, agent_id, provider_session_id, state, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)')
      .run(id, workspaceId, agent, state, now, now);
  }

  setState(id: string, state: AgentStatus): void {
    this.db.prepare('UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?').run(state, new Date().toISOString(), id);
  }

  /**
   * Na abertura do app nenhum processo da execução anterior está sob controle:
   * sessões marcadas como ativas passam a "disconnected". Retorna quantas mudaram.
   */
  markStaleAsDisconnected(): number {
    const r = this.db.prepare("UPDATE sessions SET state = 'disconnected', updated_at = ? WHERE state IN ('running', 'awaiting_approval', 'rate_limited')").run(new Date().toISOString());
    return Number(r.changes);
  }

  countByState(state: AgentStatus): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE state = ?').get(state) as { n: number }).n;
  }
}

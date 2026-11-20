import type { AgentId } from '@shared/agents';
import type { WorktreeStatus } from '@shared/git';
import type { Db } from '../Database';

export interface WorktreeRow {
  id: string; workspace_id: string; name: string; path: string; branch: string; base_ref: string; base_sha: string;
  agent: AgentId | null; task_id: string | null; status: WorktreeStatus; merged_sha: string | null; pre_merge_sha: string | null;
  created_at: string; updated_at: string;
}

export class WorktreeRepository {
  constructor(private readonly db: Db) {}

  insert(r: WorktreeRow): void {
    this.db.prepare(`INSERT INTO worktrees (id, workspace_id, name, path, branch, base_ref, base_sha, agent, task_id, status, merged_sha, pre_merge_sha, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.workspace_id, r.name, r.path, r.branch, r.base_ref, r.base_sha, r.agent, r.task_id, r.status, r.merged_sha, r.pre_merge_sha, r.created_at, r.updated_at);
  }

  update(id: string, patch: Partial<Pick<WorktreeRow, 'status' | 'merged_sha' | 'pre_merge_sha' | 'task_id'>>): void {
    const cols = Object.keys(patch) as Array<keyof typeof patch>;
    if (!cols.length) return;
    const sql = `UPDATE worktrees SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    this.db.prepare(sql).run(...cols.map((c) => patch[c] ?? null), new Date().toISOString(), id);
  }

  byId(id: string): WorktreeRow | null {
    return (this.db.prepare('SELECT * FROM worktrees WHERE id = ?').get(id) as unknown as WorktreeRow | undefined) ?? null;
  }

  list(workspaceId: string): WorktreeRow[] {
    return this.db.prepare("SELECT * FROM worktrees WHERE workspace_id = ? AND status != 'removed' ORDER BY created_at DESC").all(workspaceId) as unknown as WorktreeRow[];
  }

  recordSnapshot(id: string, taskId: string | null, branch: string, sha: string, path: string | null): void {
    this.db.prepare('INSERT INTO git_snapshots (id, task_id, branch, commit_sha, worktree_path) VALUES (?, ?, ?, ?, ?)').run(id, taskId, branch, sha, path);
  }
}

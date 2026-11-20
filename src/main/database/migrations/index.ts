export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrações versionadas. Nunca editar uma migração já publicada: criar uma nova.
 * Tabelas conforme docs/05-WORKSPACE.md. Nenhuma coluna guarda credenciais.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE workspaces (
        id          TEXT PRIMARY KEY,
        path        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE agents (
        id          TEXT PRIMARY KEY,
        provider    TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
        config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json))
      );

      CREATE TABLE sessions (
        id                  TEXT PRIMARY KEY,
        workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        provider_session_id TEXT,
        state               TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_workspace ON sessions(workspace_id, updated_at);

      CREATE TABLE tasks (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        status        TEXT NOT NULL,
        assignee      TEXT,
        criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(criteria_json)),
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_workspace_status ON tasks(workspace_id, status);
      CREATE INDEX idx_tasks_parent ON tasks(parent_id);

      CREATE TABLE messages (
        id          TEXT PRIMARY KEY,
        session_id  TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        sender      TEXT NOT NULL,
        recipient   TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_messages_session ON messages(session_id, created_at);
      CREATE INDEX idx_messages_task ON messages(task_id);

      CREATE TABLE executions (
        id          TEXT PRIMARY KEY,
        task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        state       TEXT NOT NULL,
        exit_code   INTEGER,
        started_at  TEXT NOT NULL,
        ended_at    TEXT
      );
      CREATE INDEX idx_executions_task ON executions(task_id);

      CREATE TABLE approvals (
        id            TEXT PRIMARY KEY,
        task_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        scope         TEXT NOT NULL,
        status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
        requested_at  TEXT NOT NULL,
        decided_at    TEXT
      );
      CREATE INDEX idx_approvals_task_status ON approvals(task_id, status);

      CREATE TABLE dependencies (
        id          TEXT PRIMARY KEY,
        version     TEXT,
        status      TEXT NOT NULL,
        checked_at  TEXT NOT NULL
      );

      CREATE TABLE git_snapshots (
        id            TEXT PRIMARY KEY,
        task_id       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        branch        TEXT NOT NULL,
        commit_sha    TEXT NOT NULL,
        worktree_path TEXT
      );

      CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE audit_logs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        action        TEXT NOT NULL,
        target        TEXT,
        timestamp     TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
      );
      CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
    `,
  },
];

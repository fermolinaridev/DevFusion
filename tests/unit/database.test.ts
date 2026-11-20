import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationError, migrate, openDatabase } from '../../src/main/database/Database';
import { MIGRATIONS } from '../../src/main/database/migrations';

const EXPECTED_TABLES = ['agents', 'approvals', 'audit_logs', 'dependencies', 'executions', 'git_snapshots', 'messages', 'schema_migrations', 'sessions', 'settings', 'tasks', 'workspaces'];

describe('migrações', () => {
  it('cria todas as tabelas em banco novo e liga foreign_keys', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(MIGRATIONS.at(-1)!.version);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables).toEqual(EXPECTED_TABLES);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('é idempotente ao reabrir o mesmo arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devfusion-db-'));
    try {
      const file = join(dir, 'x.sqlite');
      const a = openDatabase(file); migrate(a); a.close();
      const b = openDatabase(file);
      expect(migrate(b)).toBe(MIGRATIONS.at(-1)!.version);
      expect((b.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(MIGRATIONS.length);
      expect((b.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
      b.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('cadastra os dois agentes (migração 2)', () => {
    const db = openDatabase(':memory:'); migrate(db);
    expect(db.prepare('SELECT id, provider FROM agents ORDER BY id').all()).toEqual([{ id: 'claude', provider: 'claude' }, { id: 'codex', provider: 'codex' }]);
  });

  it('aplica foreign keys (sessão sem workspace falha)', () => {
    const db = openDatabase(':memory:'); migrate(db);
    db.prepare("INSERT INTO agents (id, provider) VALUES ('a1', 'claude')").run();
    expect(() => db.prepare("INSERT INTO sessions (id, workspace_id, agent_id, state, created_at, updated_at) VALUES ('s1', 'nao-existe', 'a1', 'idle', 'x', 'x')").run()).toThrow(/FOREIGN KEY/);
  });

  it('rejeita provider desconhecido e JSON inválido', () => {
    const db = openDatabase(':memory:'); migrate(db);
    expect(() => db.prepare("INSERT INTO agents (id, provider) VALUES ('a1', 'gemini')").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('k', '{x', 'x')").run()).toThrow(/CHECK/);
  });

  it('faz rollback de migração com erro e não registra versão', () => {
    const db = openDatabase(':memory:');
    const broken = [...MIGRATIONS, { version: 98, name: 'broken', sql: 'CREATE TABLE ok_table (x); CREATE TABLE ???;' }];
    expect(() => migrate(db, broken)).toThrow(MigrationError);
    expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(MIGRATIONS.at(-1)!.version);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_table'").get()).toBeUndefined();
  });

  it('detecta migração divergente e banco mais novo que o app', () => {
    const db = openDatabase(':memory:'); migrate(db);
    expect(() => migrate(db, [{ ...MIGRATIONS[0]!, name: 'outro_nome' }])).toThrow(/divergente/);
    db.prepare("INSERT INTO schema_migrations VALUES (99, 'futura', 'x')").run();
    expect(() => migrate(db)).toThrow(/mais nova/);
  });
});

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations';

export type Db = DatabaseSync;

/**
 * Abre o banco local. Usa o módulo `node:sqlite` embutido no Node do Electron
 * (validado no Electron 45 / Node 24), evitando addon nativo e problemas de ABI.
 */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

export class MigrationError extends Error {}

/** Aplica migrações pendentes, cada uma em transação. Retorna a versão final do schema. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  );`);
  const applied = new Map(
    (db.prepare('SELECT version, name FROM schema_migrations').all() as Array<{ version: number; name: string }>).map((r) => [r.version, r.name]),
  );
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of sorted) {
    const existing = applied.get(m.version);
    if (existing !== undefined) {
      if (existing !== m.name) throw new MigrationError(`Migração ${m.version} divergente: banco tem "${existing}", código tem "${m.name}"`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw new MigrationError(`Falha na migração ${m.version} (${m.name}): ${(e as Error).message}`);
    }
  }
  const knownMax = sorted.at(-1)?.version ?? 0;
  const dbMax = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
  if (dbMax > knownMax) throw new MigrationError(`Banco na versão ${dbMax}, mais nova que este aplicativo (${knownMax}).`);
  return dbMax;
}

/**
 * Move o banco ilegível (e arquivos -wal/-shm) para o lado, sem apagar nada.
 * Retorna o novo caminho do arquivo principal.
 */
export function quarantineDatabase(file: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = `${file}.ilegivel-${stamp}`;
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(file + suffix)) renameSync(file + suffix, target + suffix);
  }
  return target;
}

export function sqliteVersion(db: Db): string {
  return (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v;
}

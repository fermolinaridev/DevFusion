import type { CheckResult } from '@shared/doctor';
import type { Db } from '../Database';

/** Persiste o último resultado de cada check (tabela `dependencies`). */
export class DependencyRepository {
  constructor(private readonly db: Db) {}

  saveAll(results: readonly CheckResult[]): void {
    const stmt = this.db.prepare(`INSERT INTO dependencies (id, version, status, checked_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, status = excluded.status, checked_at = excluded.checked_at`);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const r of results) stmt.run(r.id, r.version, r.state, r.checkedAt);
      this.db.exec('COMMIT;');
    } catch (e) {
      this.db.exec('ROLLBACK;');
      throw e;
    }
  }

  all(): Array<{ id: string; version: string | null; status: string; checked_at: string }> {
    return this.db.prepare('SELECT id, version, status, checked_at FROM dependencies ORDER BY id').all() as Array<{ id: string; version: string | null; status: string; checked_at: string }>;
  }
}

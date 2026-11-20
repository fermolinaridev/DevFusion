import type { Db } from '../Database';

export class AuditLogRepository {
  constructor(private readonly db: Db) {}

  /** metadata não deve conter segredos; quem chama é responsável por passar só dados necessários. */
  record(action: string, target: string | null, metadata: Record<string, unknown> = {}): void {
    this.db
      .prepare('INSERT INTO audit_logs (action, target, timestamp, metadata_json) VALUES (?, ?, ?, ?)')
      .run(action, target, new Date().toISOString(), JSON.stringify(metadata));
  }
}

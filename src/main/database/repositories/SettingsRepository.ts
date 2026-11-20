import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, SETTING_KEYS, isSettingKey, type SettingKey, type Settings } from '@shared/settings';
import type { Db } from '../Database';
import type { AuditLogRepository } from './AuditLogRepository';

export class SettingsRepository {
  constructor(private readonly db: Db, private readonly audit?: AuditLogRepository, private readonly onInvalid?: (key: string) => void) {}

  /** Lê todas as configurações; valores ausentes ou corrompidos voltam ao padrão. */
  getAll(): Settings {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as Array<{ key: string; value_json: string }>;
    const result: Settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (!isSettingKey(row.key)) continue;
      let raw: unknown;
      try { raw = JSON.parse(row.value_json); } catch { this.onInvalid?.(row.key); continue; }
      const parsed = SETTINGS_SCHEMA[row.key].safeParse(raw);
      if (parsed.success) (result as Record<SettingKey, unknown>)[row.key] = parsed.data;
      else this.onInvalid?.(row.key);
    }
    return result;
  }

  set<K extends SettingKey>(key: K, value: Settings[K]): Settings {
    if (!SETTING_KEYS.includes(key)) throw new Error('Chave de configuração desconhecida');
    const parsed = SETTINGS_SCHEMA[key].parse(value);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
                  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
        .run(key, JSON.stringify(parsed), new Date().toISOString());
      this.audit?.record('settings.set', key, { value: parsed });
      this.db.exec('COMMIT;');
    } catch (e) {
      this.db.exec('ROLLBACK;');
      throw e;
    }
    return this.getAll();
  }
}

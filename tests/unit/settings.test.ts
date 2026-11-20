import { describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase } from '../../src/main/database/Database';
import { AuditLogRepository } from '../../src/main/database/repositories/AuditLogRepository';
import { SettingsRepository } from '../../src/main/database/repositories/SettingsRepository';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

function setup(onInvalid?: (k: string) => void) {
  const db = openDatabase(':memory:'); migrate(db);
  return { db, repo: new SettingsRepository(db, new AuditLogRepository(db), onInvalid) };
}

describe('SettingsRepository', () => {
  it('retorna padrões em banco vazio', () => {
    expect(setup().repo.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('persiste valor válido e registra auditoria', () => {
    const { db, repo } = setup();
    expect(repo.set('theme', 'light').theme).toBe('light');
    expect(repo.getAll().theme).toBe('light');
    const audit = db.prepare('SELECT action, target FROM audit_logs').all();
    expect(audit).toEqual([{ action: 'settings.set', target: 'theme' }]);
  });

  it('rejeita valor inválido e chave desconhecida sem gravar', () => {
    const { db, repo } = setup();
    expect(() => repo.set('theme', 'roxo' as never)).toThrow();
    expect(() => repo.set('naoExiste' as never, 1 as never)).toThrow();
    expect((db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }).n).toBe(0);
  });

  it('valor corrompido no banco volta ao padrão e é sinalizado', () => {
    const onInvalid = vi.fn();
    const { db, repo } = setup(onInvalid);
    db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES ('theme', '"roxo"', 'x')`).run();
    expect(repo.getAll().theme).toBe(DEFAULT_SETTINGS.theme);
    expect(onInvalid).toHaveBeenCalledWith('theme');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createIpcRouter } from '../../src/main/ipc/ipcRouter';
import { IPC } from '../../src/shared/ipcChannels';
import type { IpcHandlers } from '../../src/shared/ipcContracts';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const silent = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const trusted = { isTrustedSender: true };

function router(overrides: Partial<IpcHandlers> = {}) {
  const handlers: IpcHandlers = {
    [IPC.appGetInfo]: () => ({ appVersion: '0', platform: 'darwin', arch: 'arm64', versions: { electron: '1', chrome: '1', node: '1' }, database: { schemaVersion: 1, sqliteVersion: '3' } }),
    [IPC.settingsGetAll]: () => DEFAULT_SETTINGS,
    [IPC.settingsSet]: ({ key, value }) => ({ ...DEFAULT_SETTINGS, [key]: value }),
    ...overrides,
  };
  return createIpcRouter(handlers, silent);
}

describe('roteador IPC', () => {
  it('rejeita canal fora da allowlist', async () => {
    expect(await router()('fs:read', trusted, '/etc/passwd')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });

  it('rejeita remetente não confiável mesmo com argumento válido', async () => {
    expect(await router()(IPC.settingsGetAll, { isTrustedSender: false }, undefined)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } });
  });

  it.each([
    ['valor fora do enum', { key: 'theme', value: 'roxo' }],
    ['chave desconhecida', { key: '__proto__', value: 'dark' }],
    ['propriedade extra', { key: 'theme', value: 'dark', extra: 1 }],
    ['tipo errado', 'theme=dark'],
    ['ausente', undefined],
  ])('rejeita argumento inválido: %s', async (_label, arg) => {
    expect(await router()(IPC.settingsSet, trusted, arg)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });

  it('rejeita argumento em canal que não aceita argumentos', async () => {
    expect(await router()(IPC.appGetInfo, trusted, { a: 1 })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });

  it('não vaza detalhes de erro interno', async () => {
    const r = await router({ [IPC.settingsGetAll]: () => { throw new Error('segredo /home/x token=abcdef123456'); } })(IPC.settingsGetAll, trusted, undefined);
    expect(r).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Erro interno' } });
  });

  it('aceita chamada válida', async () => {
    expect(await router()(IPC.settingsSet, trusted, { key: 'theme', value: 'light' })).toEqual({ ok: true, data: { ...DEFAULT_SETTINGS, theme: 'light' } });
  });
});

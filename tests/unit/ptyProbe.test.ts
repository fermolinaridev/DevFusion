import { describe, expect, it } from 'vitest';
import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { probePty } from '../../src/main/terminal/ptyProbe';
import { CHECKS } from '../../src/main/system/checks';

type Handlers = { data: Array<(d: string) => void>; exit: Array<(e: { exitCode: number }) => void> };
function fakePty(script: (h: Handlers) => void): { spawn: () => IPty; calls: Array<{ file: string; args: string[] }>; killed: () => boolean } {
  const calls: Array<{ file: string; args: string[] }> = [];
  let killed = false;
  return {
    calls, killed: () => killed,
    spawn: ((file: string, args: string[]) => {
      calls.push({ file, args });
      const h: Handlers = { data: [], exit: [] };
      setTimeout(() => script(h), 5);
      return { onData: (cb: (d: string) => void) => { h.data.push(cb); }, onExit: (cb: (e: { exitCode: number }) => void) => { h.exit.push(cb); }, kill: () => { killed = true; } } as unknown as IPty;
    }) as unknown as () => IPty,
  };
}

describe('probePty', () => {
  it('ok quando a saída esperada chega; usa o shell padrão com comando fixo', async () => {
    const f = fakePty((h) => h.data.forEach((cb) => cb('devfusion-pty-ok\r\n')));
    const r = await probePty({ spawn: f.spawn, platform: 'linux', env: {}, cwd: '/' });
    expect(r.ok).toBe(true);
    expect(f.calls[0]).toEqual({ file: '/bin/sh', args: ['-c', 'printf devfusion-pty-ok'] });
    expect(f.killed()).toBe(true);
  });

  it('Windows usa o ComSpec do ambiente', async () => {
    const f = fakePty((h) => h.data.forEach((cb) => cb('devfusion-pty-ok')));
    await probePty({ spawn: f.spawn, platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, cwd: 'C:\\' });
    expect(f.calls[0]).toEqual({ file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/c', 'echo devfusion-pty-ok'] });
  });

  it('falha clara: módulo ausente, erro ao abrir, saída errada e tempo esgotado', async () => {
    expect(await probePty({ spawn: null, platform: 'linux', env: {}, cwd: '/' })).toEqual({ ok: false, detail: 'Módulo de terminal (node-pty) não carregou.' });
    const boom = (() => { throw new Error('posix_spawnp failed.'); }) as unknown as () => IPty;
    expect(await probePty({ spawn: boom, platform: 'linux', env: {}, cwd: '/' })).toEqual({ ok: false, detail: 'Falha ao abrir o terminal: posix_spawnp failed.' });
    const wrong = fakePty((h) => { h.data.forEach((cb) => cb('outra coisa')); h.exit.forEach((cb) => cb({ exitCode: 1 })); });
    expect(await probePty({ spawn: wrong.spawn, platform: 'linux', env: {}, cwd: '/' })).toMatchObject({ ok: false, detail: expect.stringContaining('código 1') });
    const silent = fakePty(() => undefined);
    expect(await probePty({ spawn: silent.spawn, platform: 'linux', env: {}, cwd: '/', timeoutMs: 50 })).toEqual({ ok: false, detail: 'O terminal não respondeu a tempo.' });
    expect(silent.killed()).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('node-pty real abre o shell e devolve a saída', async () => {
    const r = await probePty({ spawn: nodePty.spawn, platform: process.platform, env: { PATH: process.env['PATH'] ?? '' }, cwd: process.cwd() });
    expect(r).toMatchObject({ ok: true });
  });

  it('check do Doctor: falha vira erro obrigatório com orientação', async () => {
    const def = CHECKS.find((c) => c.id === 'pty')!;
    expect(def.requirement).toBe('required');
    const out = await def.run({ ptyProbe: async () => ({ ok: false, detail: 'O terminal não respondeu a tempo.' }) } as never, {});
    expect(out).toMatchObject({ state: 'error', detail: expect.stringContaining('reinstale o DevFusion') });
  });
});

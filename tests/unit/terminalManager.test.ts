import * as nodePty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalManager, ptyCommand } from '../../src/main/terminal/TerminalManager';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

let tools: FakeToolDir;
let data: string;
let exits: Array<{ exitCode: number; signal: number | null }>;
let tm: TerminalManager;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function startFake(spec = SPECS.interactiveAgent('claude'), opts = {}) {
  tm = new TerminalManager(nodePty, { onData: (_k, d) => { data += d; }, onExit: (_k, e) => exits.push(e) }, { interruptGraceMs: 400, termGraceMs: 400, ...opts });
  const file = tools.add('claude', spec);
  return tm.start('claude', { file, args: [], cwd: tools.dir, env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' }, cols: 80, rows: 24 });
}

beforeEach(() => { tools = new FakeToolDir(); data = ''; exits = []; });
afterEach(async () => { await tm?.stopAll(); tools.cleanup(); });

describe.skipIf(process.platform === 'win32')('TerminalManager (node-pty real)', () => {
  it('entrada e saída pelo PTY, com resize', async () => {
    startFake();
    await vi.waitFor(() => expect(data).toContain('claude falso'));
    tm.resize('claude', 120, 40);
    tm.write('claude', 'ola mundo\r');
    await vi.waitFor(() => expect(data).toContain('eco: ola mundo'));
    expect(() => tm.start('claude', { file: '/bin/sh', args: [], cwd: tools.dir, env: {}, cols: 80, rows: 24 })).toThrow(/Já existe/);
  });

  it('Ctrl+C chega como SIGINT ao processo', async () => {
    startFake(SPECS.interactiveAgent('claude', { ignoreSigint: true }));
    await vi.waitFor(() => expect(data).toContain('>'));
    tm.interrupt('claude');
    await vi.waitFor(() => expect(data).toContain('[SIGINT]'));
    expect(tm.has('claude')).toBe(true);
  });

  it('encerramento escala até SIGKILL quando o processo ignora Ctrl+C e SIGTERM, sem órfão', async () => {
    const pid = startFake(SPECS.interactiveAgent('claude', { ignoreSigint: true, ignoreSigterm: true }));
    await vi.waitFor(() => expect(data).toContain('>'));
    expect(await tm.stop('claude')).toBe('kill');
    expect(tm.has('claude')).toBe(false);
    expect(alive(pid)).toBe(false);
    expect(exits).toHaveLength(1);
  });

  it('encerramento educado para no Ctrl+C quando basta', async () => {
    startFake();
    await vi.waitFor(() => expect(data).toContain('>'));
    expect(await tm.stop('claude')).toBe('interrupt');
    expect(exits[0]!.exitCode).not.toBe(0);
  });

  it('controle de fluxo: pausa sem confirmação e retoma após ack; histórico de reanexo limitado', async () => {
    startFake(undefined, { highWaterMark: 64 * 1024, lowWaterMark: 16 * 1024, replayBytes: 32 * 1024 });
    await vi.waitFor(() => expect(data).toContain('>'));
    tm.write('claude', 'flood\r');
    await vi.waitFor(() => expect(tm.isPaused('claude')).toBe(true));
    const before = data.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(data.length - before).toBeLessThan(200 * 1024); // não continua despejando sem ack
    // Renderer confirma tudo que recebeu, repetidamente, até o fim do flood.
    await vi.waitFor(() => { tm.ack('claude', data.length); expect(data).toContain('linha 19999'); }, { timeout: 15_000, interval: 20 });
    expect(tm.replay('claude').length).toBeLessThanOrEqual(32 * 1024);
  }, 20_000);
});

describe('ptyCommand', () => {
  it('Windows .cmd via cmd.exe com aspas; rejeita metacaracteres; POSIX direto', () => {
    expect(ptyCommand('C:\\npm\\claude.cmd', ['auth', 'login'], 'win32', { ComSpec: 'C:\\cmd.exe' })).toEqual({ file: 'C:\\cmd.exe', args: '/d /s /c ""C:\\npm\\claude.cmd" "auth" "login""' });
    expect(() => ptyCommand('C:\\a.cmd', ['a&b'], 'win32', {})).toThrow();
    expect(ptyCommand('C:\\x\\claude.exe', [], 'win32', {})).toEqual({ file: 'C:\\x\\claude.exe', args: [] });
    expect(ptyCommand('/usr/local/bin/codex', ['login'], 'darwin', {})).toEqual({ file: '/usr/local/bin/codex', args: ['login'] });
  });
});

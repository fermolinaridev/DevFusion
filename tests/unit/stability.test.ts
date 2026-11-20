import * as nodePty from 'node-pty';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, quarantineDatabase } from '../../src/main/database/Database';
import { configureLogFile, createLogger, tailLog } from '../../src/main/logging/logger';
import { TerminalManager } from '../../src/main/terminal/TerminalManager';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-st-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('log em arquivo', () => {
  it('grava sanitizado e faz rotação por tamanho mantendo N arquivos', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureLogFile(dir, { maxBytes: 400, keep: 2 });
    const log = createLogger('teste');
    log.info('login de fulano@example.com com token=abcdef1234567890 em ' + homedir() + '/projeto');
    const first = readFileSync(join(dir, 'main.log'), 'utf8');
    expect(first).toContain('<email>');
    expect(first).not.toContain('abcdef1234567890');
    expect(first).not.toContain(homedir());
    for (let i = 0; i < 30; i++) log.error(`linha ${i} ` + 'x'.repeat(40));
    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    expect(tailLog(1)[0]).toContain('linha 29');
    vi.restoreAllMocks();
  });
});

describe('banco ilegível', () => {
  it('abrir arquivo corrompido falha; quarentena renomeia (com -wal/-shm) sem apagar', () => {
    const file = join(dir, 'devfusion.sqlite');
    writeFileSync(file, 'isto não é um banco sqlite '.repeat(100));
    writeFileSync(`${file}-wal`, 'wal');
    expect(() => { const db = openDatabase(file); try { migrate(db); } finally { db.close(); } }).toThrow();
    const moved = quarantineDatabase(file, new Date('2026-11-20T12:00:00Z'));
    expect(moved).toBe(`${file}.ilegivel-2026-11-20T12-00-00-000Z`);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(moved, 'utf8')).toContain('isto não é um banco');
    expect(readFileSync(`${moved}-wal`, 'utf8')).toBe('wal');
    const fresh = openDatabase(file); expect(migrate(fresh)).toBeGreaterThan(0); fresh.close();
  });
});

describe.skipIf(process.platform === 'win32')('controle de fluxo após recarga do renderer', () => {
  it('resetFlowControl retoma PTY pausado sem confirmações', async () => {
    const tools = new FakeToolDir();
    try {
      let data = '';
      const tm = new TerminalManager(nodePty, { onData: (_k, d) => { data += d; }, onExit: () => undefined }, { highWaterMark: 32 * 1024, lowWaterMark: 8 * 1024 });
      tm.start('claude', { file: tools.add('claude', SPECS.interactiveAgent('claude')), args: [], cwd: tools.dir, env: { PATH: '/usr/bin:/bin' }, cols: 80, rows: 24 });
      await vi.waitFor(() => expect(data).toContain('>'));
      tm.write('claude', 'flood\r');
      await vi.waitFor(() => expect(tm.isPaused('claude')).toBe(true));
      tm.resetFlowControl(); // renderer recarregou: confirmações antigas perdidas
      expect(tm.isPaused('claude')).toBe(false);
      await tm.stopAll(); // durante a inundação a escalada de encerramento pode levar alguns segundos
    } finally { tools.cleanup(); }
  }, 20_000);
});

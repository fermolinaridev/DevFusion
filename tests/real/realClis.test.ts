/**
 * Testes REAIS opcionais: usam as CLIs instaladas e as contas do usuário.
 * Só rodam com DEVFUSION_REAL_TESTS=1 (npm run test:real). Não enviam prompts: não consomem cota.
 */
import * as nodePty from 'node-pty';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { defaultConnectivityTargets, tlsProbe } from '../../src/main/system/checks';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { runCommand } from '../../src/main/system/ProcessRunner';
import { SystemDoctor } from '../../src/main/system/SystemDoctor';
import { TerminalManager } from '../../src/main/terminal/TerminalManager';
import { readCodexUsage } from '../../src/main/usage/CodexUsageReader';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const detector = new PlatformDetector({ env: { HOME: process.env['HOME'], USER: process.env['USER'], PATH: '/usr/bin:/bin', SystemRoot: process.env['SystemRoot'], USERPROFILE: process.env['USERPROFILE'], APPDATA: process.env['APPDATA'], LOCALAPPDATA: process.env['LOCALAPPDATA'] } });

describe('CLIs reais (opcional)', () => {
  it('System Doctor encontra as CLIs e lê o status das contas pelos comandos oficiais', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devfusion-real-'));
    try {
      const r = await new SystemDoctor({ context: () => ({
        detector, run: runCommand, cliPaths: DEFAULT_SETTINGS.cliPaths, userDataDir: dir, workspacePath: null, minFreeDiskBytes: 1,
        freeDiskBytes: async () => 1e12, connect: tlsProbe, connectivityTargets: defaultConnectivityTargets({}), ptyProbe: async () => ({ ok: true, ms: 0 }),
      }) }).run();
      const line = (id: string) => r.results.find((x) => x.id === id);
      for (const id of ['claude', 'codex', 'claude-auth', 'codex-auth', 'net-anthropic', 'net-openai']) console.log(id, line(id)?.state, line(id)?.version ?? '');
      expect(['ok', 'missing']).toContain(line('claude')?.state);
      expect(['ok', 'missing']).toContain(line('codex')?.state);
      expect(line('claude-auth')?.state).not.toBe('error');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('Codex: limites do plano por leitura no App Server (sem consumir cota)', async () => {
    const codex = detector.locate('codex').found?.path ?? null;
    if (!codex) return;
    const u = await readCodexUsage({ codexPath: () => codex, env: () => detector.childEnv() });
    console.log('codex usage', u.status, u.windows.map((w) => `${w.label} ${w.usedPercent}%`).join(' · '));
    expect(['ok', 'unavailable', 'no-data']).toContain(u.status);
  }, 30_000);

  it('as duas CLIs abrem num PTY e encerram sem deixar processo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devfusion-real-pty-'));
    const out: Record<string, string> = { claude: '', codex: '' };
    const tm = new TerminalManager(nodePty, { onData: (k, d) => { out[k] += d; }, onExit: () => undefined });
    try {
      for (const tool of ['claude', 'codex'] as const) {
        const p = detector.locate(tool).found?.path;
        if (!p) continue;
        tm.start(tool, { file: p, args: [], cwd: dir, env: { ...detector.childEnv(), TERM: 'xterm-256color' }, cols: 100, rows: 30 });
      }
      await vi.waitFor(() => expect(out['claude']!.length + out['codex']!.length).toBeGreaterThan(200), { timeout: 20_000 });
      const pids = (['claude', 'codex'] as const).map((k) => tm.pid(k)).filter((p): p is number => p !== null);
      await tm.stopAll();
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});

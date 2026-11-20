import { describe, expect, it } from 'vitest';
import { buildSpawnSpec, runCommand } from '../../src/main/system/ProcessRunner';

const node = process.execPath;
const env = { PATH: process.env['PATH'] ?? '' };

describe('ProcessRunner', () => {
  it('captura saída e código de saída sem shell', async () => {
    const r = await runCommand(node, ['-e', 'process.stdout.write("oi; echo injetado"); process.exit(3)'], { env, timeoutMs: 10_000 });
    expect(r.stdout).toBe('oi; echo injetado');
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('distingue tempo esgotado de executável ausente', async () => {
    const slow = await runCommand(node, ['-e', 'setTimeout(() => {}, 30000)'], { env, timeoutMs: 300 });
    expect(slow).toMatchObject({ timedOut: true, notFound: false });
    const missing = await runCommand('/caminho/que/nao/existe/devfusion-x', ['--version'], { env, timeoutMs: 1000 });
    expect(missing).toMatchObject({ notFound: true, timedOut: false });
  });

  it('cancela via AbortSignal', async () => {
    const ac = new AbortController();
    const p = runCommand(node, ['-e', 'setTimeout(() => {}, 30000)'], { env, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    expect(await p).toMatchObject({ cancelled: true, timedOut: false });
  });

  it('limita a saída guardada e sanitiza segredos', async () => {
    const chunks: string[] = [];
    const r = await runCommand(node, ['-e', 'console.log("x".repeat(5000)); console.log("token=abcdef1234567890 a@b.co")'], { env, maxOutputBytes: 100, onOutput: (c) => chunks.push(c) });
    expect(r.stdout.length).toBeLessThanOrEqual(100);
    const all = chunks.join('');
    expect(all).not.toContain('abcdef1234567890');
    expect(all).not.toContain('a@b.co');
  });

  it('no Windows, .cmd passa por cmd.exe com aspas e rejeita metacaracteres', () => {
    const spec = buildSpawnSpec('C:\\Users\\x\\AppData\\Roaming\\npm\\npm.cmd', ['install', '-g', '@openai/codex'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
    expect(spec).toEqual({ file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '""C:\\Users\\x\\AppData\\Roaming\\npm\\npm.cmd" "install" "-g" "@openai/codex""'], verbatim: true });
    expect(() => buildSpawnSpec('C:\\a\\npm.cmd', ['x & calc'], 'win32', {})).toThrow();
    expect(() => buildSpawnSpec('C:\\a\\npm.cmd', ['%PATH%'], 'win32', {})).toThrow();
    expect(buildSpawnSpec('/usr/bin/git', ['--version'], 'darwin', {})).toEqual({ file: '/usr/bin/git', args: ['--version'], verbatim: false });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiMemoryRunCommand } from '../../src/main/agents/aiMemory';
import { CHECKS, type CheckContext } from '../../src/main/system/checks';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { runCommand } from '../../src/main/system/ProcessRunner';
import { INSTALL_CATALOG } from '../../src/main/system/InstallCatalog';
import { FakeToolDir } from '../helpers/fakeTools';

describe('ai-memory run', () => {
  it('flags do wrapper antes do agente; argumentos nativos repassados sem alteração', () => {
    const c = aiMemoryRunCommand('/u/.local/bin/ai-memory', 'codex', '/opt/codex', ['--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
    expect(c.file).toBe('/u/.local/bin/ai-memory');
    expect(c.args).toEqual(['run', '--no-exit-prompt', '--executable', '/opt/codex', 'codex', '--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
    expect(c.display).toEqual(['ai-memory', 'run', 'codex']);
    expect(aiMemoryRunCommand('a', 'claude', '/c', []).args).toEqual(['run', '--no-exit-prompt', '--executable', '/c', 'claude']);
  });

  it('catálogo: só Homebrew roda pelo app; scripts remotos são só instrução', () => {
    const entries = INSTALL_CATALOG.filter((e) => e.dependency === 'ai-memory');
    expect(entries.filter((e) => e.command).map((e) => e.command)).toEqual([{ tool: 'brew', args: ['install', 'akitaonrails/tap/ai-memory'] }]);
    expect(entries.filter((e) => !e.command).every((e) => e.manualCommand?.includes('github.com/akitaonrails/ai-memory/releases/latest/download/install.'))).toBe(true);
  });
});

describe('check ai-memory do System Doctor', () => {
  let tools: FakeToolDir; let dir: string;
  beforeEach(() => { tools = new FakeToolDir(); dir = mkdtempSync(join(tmpdir(), 'devfusion-aimem-')); });
  afterEach(() => { tools.cleanup(); rmSync(dir, { recursive: true, force: true }); });
  const ctx = (): CheckContext => ({
    detector: new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: tools.dir, HOME: process.env['HOME'] } }), run: runCommand,
    cliPaths: { git: null, claude: null, codex: null }, userDataDir: dir, workspacePath: null, minFreeDiskBytes: 1,
    freeDiskBytes: async () => 1e12, connect: async () => ({ ok: true, ms: 1 }), connectivityTargets: { anthropic: { host: 'a', port: 1 }, openai: { host: 'o', port: 1 } },
    ptyProbe: async () => ({ ok: true, ms: 1 }),
  });
  const run = () => CHECKS.find((c) => c.id === 'ai-memory')!.run(ctx(), {});

  it('ausente é opcional (não é problema) e oferece instalação', async () => {
    expect(await run()).toMatchObject({ state: 'optional', action: { kind: 'install', dependency: 'ai-memory' } });
    expect(CHECKS.find((c) => c.id === 'ai-memory')!.requirement).toBe('optional');
  });

  it('instalado com servidor respondendo', async () => {
    tools.add('ai-memory', { '--version': { stdout: 'ai-memory 3.5.1\n' }, 'status --json': { stdout: '{"server":"ok"}\n' } });
    expect(await run()).toMatchObject({ state: 'ok', version: 'ai-memory 3.5.1', detail: 'Instalado; servidor local respondendo.' });
  });

  it('instalado sem servidor: orienta rodar `ai-memory setup` no terminal', async () => {
    tools.add('ai-memory', { '--version': { stdout: 'ai-memory 3.5.1\n' }, 'status --json': { stderr: 'server unreachable\n', exitCode: 1 } });
    expect(await run()).toMatchObject({ state: 'unknown', detail: expect.stringContaining('ai-memory setup'), action: { kind: 'open-docs', docId: 'ai-memory' } });
  });
});

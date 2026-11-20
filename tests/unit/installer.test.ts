import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallState } from '../../src/shared/doctor';
import { DependencyInstaller, type InstallerDeps } from '../../src/main/system/DependencyInstaller';
import { INSTALL_CATALOG } from '../../src/main/system/InstallCatalog';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { runCommand } from '../../src/main/system/ProcessRunner';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

let tools: FakeToolDir;
beforeEach(() => { tools = new FakeToolDir(); });
afterEach(() => tools.cleanup());

function setup(over: Partial<InstallerDeps> = {}) {
  const audit = vi.fn();
  const revalidate = vi.fn(async () => undefined);
  const states: InstallState[] = [];
  const run = vi.fn(runCommand);
  const installer = new DependencyInstaller({
    detector: new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: tools.dir } }),
    run, confirm: async () => true, revalidate, audit, onState: (s) => states.push(s), ...over,
  });
  return { installer, audit, revalidate, states, run };
}
const actions = (audit: ReturnType<typeof vi.fn>) => audit.mock.calls.map((c) => c[0]);

describe('catálogo de instalação', () => {
  it('nunca marca script remoto como executável e só usa comandos fixos sem metacaracteres de shell', () => {
    for (const e of INSTALL_CATALOG) {
      if (e.manualCommand?.includes('|')) expect(e.command).toBeNull();
      if (e.command) {
        expect(['brew', 'winget', 'npm']).toContain(e.command.tool);
        for (const a of e.command.args) expect(a).not.toMatch(/[|&;<>$`"'%^\s]/);
        expect(e.command.args).not.toContain('sudo');
      }
      expect(e.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});

describe.skipIf(process.platform === 'win32')('DependencyInstaller', () => {
  it('sem confirmação nada é executado', async () => {
    tools.add('npm', { '*': { stdout: 'não deveria rodar' } }); tools.add('node', SPECS.node('v22.12.0'));
    const { installer, audit, run, revalidate } = setup({ confirm: async () => false });
    const s = await installer.install('claude-npm');
    expect(s.status).toBe('declined');
    expect(run.mock.calls.some((c) => c[1].includes('install'))).toBe(false);
    expect(actions(audit)).toEqual(['install.requested', 'install.declined']);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('com confirmação executa o comando fixo, transmite saída, audita e revalida', async () => {
    tools.add('node', SPECS.node('v22.12.0'));
    tools.add('npm', { 'install -g @anthropic-ai/claude-code': { stdout: 'added 1 package\n', create: { claude: SPECS.claude(false) } } });
    const confirm = vi.fn(async () => true);
    const { installer, audit, revalidate, states } = setup({ confirm });
    const s = await installer.install('claude-npm');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-npm', commandDisplay: 'npm install -g @anthropic-ai/claude-code', automatic: true }));
    expect(s.status).toBe('succeeded');
    expect(s.output).toContain('added 1 package');
    expect(existsSync(join(tools.dir, 'claude'))).toBe(true);
    expect(revalidate).toHaveBeenCalledWith(['claude', 'claude-auth']);
    expect(actions(audit)).toEqual(['install.requested', 'install.started', 'install.finished']);
    expect(states.map((x) => x.status)).toEqual(expect.arrayContaining(['awaiting-consent', 'running', 'succeeded']));
  });

  it('instalação malsucedida informa código, audita e revalida', async () => {
    tools.add('node', SPECS.node());
    tools.add('npm', { 'install -g @openai/codex': { stderr: 'npm ERR! code EACCES\n', exitCode: 243 } });
    const { installer, audit, revalidate } = setup();
    const s = await installer.install('codex-npm');
    expect(s).toMatchObject({ status: 'failed', exitCode: 243 });
    expect(s.output).toContain('EACCES');
    expect(audit).toHaveBeenLastCalledWith('install.finished', 'codex', { method: 'codex-npm', status: 'failed', exitCode: 243 });
    expect(revalidate).toHaveBeenCalled();
  });

  it('cancelamento interrompe o processo', async () => {
    tools.add('node', SPECS.node());
    tools.add('npm', { 'install -g @openai/codex': { stdout: 'baixando…\n', sleepMs: 30_000 } });
    const { installer, audit } = setup();
    const p = installer.install('codex-npm');
    await vi.waitFor(() => expect(installer.getState().status).toBe('running'));
    expect(installer.cancel()).toBe(true);
    const s = await p;
    expect(s.status).toBe('cancelled');
    expect(audit).toHaveBeenLastCalledWith('install.finished', 'codex', expect.objectContaining({ status: 'cancelled' }));
  }, 15_000);

  it('método indisponível falha antes de pedir confirmação', async () => {
    const confirm = vi.fn(async () => true);
    const { installer } = setup({ confirm });
    expect((await installer.install('claude-brew')).message).toMatch(/brew/);
    tools.add('npm', {}); tools.add('node', SPECS.node('v20.11.0'));
    expect((await installer.install('claude-npm')).message).toMatch(/Node\.js 22/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('rejeita métodos só de instrução, inexistentes e instalações simultâneas', async () => {
    const { installer } = setup();
    expect((await installer.install('claude-script-posix')).status).toBe('failed');
    expect((await installer.install('nao-existe')).status).toBe('failed');
    tools.add('node', SPECS.node());
    tools.add('npm', { 'install -g @openai/codex': { sleepMs: 30_000 } });
    const first = installer.install('codex-npm');
    await vi.waitFor(() => expect(installer.getState().status).toBe('running'));
    expect((await installer.install('codex-npm')).message).toMatch(/em andamento/);
    installer.cancel();
    await first;
  }, 15_000);

  it('lista métodos com disponibilidade real', async () => {
    tools.add('npm', {}); tools.add('node', SPECS.node('v22.1.0'));
    const { installer } = setup();
    const methods = await installer.methods('claude');
    const byId = Object.fromEntries(methods.map((m) => [m.id, m]));
    expect(byId['claude-npm']).toMatchObject({ automatic: true, available: true });
    if (process.platform === 'darwin') expect(byId['claude-brew']).toMatchObject({ available: false });
    expect(Object.values(byId).filter((m) => !m.automatic).every((m) => m.commandDisplay === null || m.permissions.includes('Não é executado'))).toBe(true);
  });
});

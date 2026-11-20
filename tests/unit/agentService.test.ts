import * as nodePty from 'node-pty';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionInfo } from '../../src/shared/agents';
import { AgentService } from '../../src/main/agents/AgentService';
import { sanitizePaste } from '../../src/main/agents/CliAgentAdapter';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

let tools: FakeToolDir; let ws: string; let svc: AgentService;
let states: AgentSessionInfo[]; let out: Record<string, string>; let revalidate: ReturnType<typeof vi.fn<(checks: unknown[]) => Promise<undefined>>>;

function make(workspace: string | null = ws) {
  states = []; out = { claude: '', codex: '' }; revalidate = vi.fn(async () => undefined);
  svc = new AgentService({
    detector: new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: tools.dir, HOME: process.env['HOME'], ANTHROPIC_API_KEY: 'sk-ant-nao-pode-vazar', OPENAI_API_KEY: 'sk-nao' } }),
    ptyFactory: nodePty,
    terminalOptions: { interruptGraceMs: 300, termGraceMs: 300 },
    configuredPaths: () => ({ claude: null, codex: null }),
    doctorResult: () => null,
    workspacePath: () => workspace,
    revalidate,
    emitState: (i) => states.push(i),
    emitData: (a, d) => { out[a] += d; },
  });
  return svc;
}
const last = (agent: string) => [...states].reverse().find((s) => s.agent === agent)!;

beforeEach(() => { tools = new FakeToolDir(); ws = mkdtempSync(join(tmpdir(), 'devfusion-ws-')); });
afterEach(async () => { await svc?.stopAll(); tools.cleanup(); rmSync(ws, { recursive: true, force: true }); });

describe.skipIf(process.platform === 'win32')('AgentService', () => {
  it('dois agentes em PTYs independentes, no workspace, sem API keys no ambiente', async () => {
    tools.add('claude', SPECS.interactiveAgent('claude')); tools.add('codex', SPECS.interactiveAgent('codex'));
    make();
    await svc.start('claude', 'agent', 80, 24);
    await svc.start('codex', 'agent', 80, 24);
    expect(last('claude')).toMatchObject({ status: 'running', kind: 'agent', command: 'claude' });
    await vi.waitFor(() => { expect(out['claude']).toContain('claude falso'); expect(out['codex']).toContain('codex falso'); });
    svc.terminals.write('claude', 'env\r');
    await vi.waitFor(() => expect(out['claude']).toMatch(/cwd=.*keys= term=xterm-256color/));
    expect(out['claude']).toContain(`cwd=${(await import('node:fs')).realpathSync(ws)}`);
    expect(out['codex']).not.toContain('env'); // entrada de um agente não vaza para o outro
    await svc.stop('claude');
    expect(last('claude').status).toBe('completed');
    expect(last('codex').status).toBe('running');
    await svc.stopAll();
    expect(svc.list().every((s) => s.status !== 'running')).toBe(true);
  });

  it('saída com erro vira "failed" com código; revalida a conta ao terminar', async () => {
    tools.add('claude', SPECS.interactiveAgent('claude'));
    make();
    await svc.start('claude', 'agent', 80, 24);
    await vi.waitFor(() => expect(out['claude']).toContain('>'));
    svc.terminals.write('claude', 'fail\r');
    await vi.waitFor(() => expect(last('claude')).toMatchObject({ status: 'failed', exitCode: 3 }));
    expect(revalidate).toHaveBeenCalledWith(['claude-auth']);
  });

  it('login roda o comando oficial no PTY e dispara revalidação da conta', async () => {
    tools.add('codex', SPECS.interactiveAgent('codex', { loggedIn: false }));
    make(null);
    await svc.start('codex', 'login', 80, 24);
    expect(last('codex')).toMatchObject({ kind: 'login', command: 'codex login' });
    await vi.waitFor(() => expect(last('codex').status).toBe('completed'));
    expect(out['codex']).toContain('Login successful');
    expect(revalidate).toHaveBeenCalledWith(['codex-auth']);
  });

  it('sem workspace não inicia o agente; CLI ausente falha com mensagem', async () => {
    tools.add('claude', SPECS.interactiveAgent('claude'));
    make(null);
    await expect(svc.start('claude', 'agent', 80, 24)).rejects.toThrow(/workspace/);
    make();
    await expect(svc.start('codex', 'agent', 80, 24)).rejects.toThrow(/não foi encontrado/);
    expect(last('codex')).toMatchObject({ status: 'failed' });
  });

  it('declara capacidades sem prometer automação', async () => {
    make();
    for (const a of ['claude', 'codex'] as const) expect(await svc.adapter(a).capabilities()).toMatchObject({ interactive: true, automatable: false, structuredEvents: false });
  });
});

describe('sanitizePaste', () => {
  it('remove escapes e controles, preserva quebras de linha e tabs', () => {
    expect(sanitizePaste('a\x1b[201~\x1b]0;x\x07b\r\nc\td\x03')).toBe('a[201~]0;xb\nc\td');
  });
});

describe('diagnóstico de encerramento', () => {
  it('screenTail remove ANSI/OSC e mantém as últimas linhas', async () => {
    const { screenTail } = await import('../../src/main/agents/AgentService');
    const raw = '\x1b]0;titulo\x07\x1b[?1049h\x1b[1;1HTrust this folder?\r\n\x1b[32m› 1. Trust and continue\x1b[0m\r\n  2. Back\r\nErro: algo falhou\x1b[?1049l';
    expect(screenTail(raw)).toBe('Trust this folder? | › 1. Trust and continue | 2. Back | Erro: algo falhou');
    expect(screenTail('l1\nl2\nl3\nl4', 2)).toBe('l3 | l4');
  });
});

import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckId, CheckResult } from '../../src/shared/doctor';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { interpretClaudeAuth, interpretCodexAuth, type CheckContext, type ConnectResult } from '../../src/main/system/checks';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { runCommand, type RunResult } from '../../src/main/system/ProcessRunner';
import { SystemDoctor } from '../../src/main/system/SystemDoctor';
import { migrate, openDatabase } from '../../src/main/database/Database';
import { DependencyRepository } from '../../src/main/database/repositories/DependencyRepository';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

const GiB = 1024 ** 3;
let tools: FakeToolDir;
let userData: string;

function ctx(over: Partial<CheckContext> = {}): CheckContext {
  return {
    detector: new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: tools.dir, HOME: process.env['HOME'] } }),
    run: runCommand,
    cliPaths: DEFAULT_SETTINGS.cliPaths,
    userDataDir: userData,
    workspacePath: null,
    minFreeDiskBytes: GiB,
    freeDiskBytes: async () => 50 * GiB,
    connect: async (): Promise<ConnectResult> => ({ ok: true, ms: 12 }),
    connectivityTargets: { anthropic: { host: 'a.test', port: 443 }, openai: { host: 'o.test', port: 443 } },
    ...over,
  };
}
const byId = (rs: CheckResult[], id: CheckId) => rs.find((r) => r.id === id)!;
const doctorWith = (over: Partial<CheckContext> = {}) => new SystemDoctor({ context: () => ctx(over) });

beforeEach(() => { tools = new FakeToolDir(); userData = mkdtempSync(join(tmpdir(), 'devfusion-ud-')); });
afterEach(() => { tools.cleanup(); chmodSync(userData, 0o755); rmSync(userData, { recursive: true, force: true }); });

describe.skipIf(process.platform === 'win32')('SystemDoctor — cenários de aceitação', () => {
  it('ambiente limpo: tudo ausente, contas desconhecidas (nunca "logado"), modo degradado', async () => {
    const r = await doctorWith().run();
    for (const id of ['git', 'claude', 'codex'] as const) expect(byId(r.results, id)).toMatchObject({ state: 'missing', action: { kind: 'install' } });
    expect(byId(r.results, 'claude-auth').state).toBe('unknown');
    expect(byId(r.results, 'codex-auth').state).toBe('unknown');
    expect(byId(r.results, 'node').state).toBe('optional');
    expect(r.summary).toEqual({ readyAgents: [], blockingIssues: 0, mode: 'degraded' });
    expect(r.results.map((x) => x.id)).not.toContain('python');
  });

  it('só um agente instalado e logado: modo individual', async () => {
    tools.add('git', SPECS.git()); tools.add('codex', SPECS.codex(true));
    const r = await doctorWith().run();
    expect(byId(r.results, 'codex-auth')).toMatchObject({ state: 'ok', version: 'ChatGPT' });
    expect(byId(r.results, 'claude').state).toBe('missing');
    expect(r.summary.mode).toBe('individual');
    expect(r.summary.readyAgents).toEqual(['codex']);
  });

  it('ambos instalados e logados: modo completo', async () => {
    tools.add('git', SPECS.git()); tools.add('claude', SPECS.claude(true)); tools.add('codex', SPECS.codex(true));
    const r = await doctorWith().run();
    expect(byId(r.results, 'claude')).toMatchObject({ state: 'ok', version: '2.1.329 (Claude Code)' });
    expect(byId(r.results, 'claude-auth')).toMatchObject({ state: 'ok', version: 'claude.ai · plano pro' });
    expect(r.summary).toEqual({ readyAgents: ['claude', 'codex'], blockingIssues: 0, mode: 'full' });
  });

  it('sessões deslogadas: estado "não autenticado" com ação de login', async () => {
    tools.add('claude', SPECS.claude(false)); tools.add('codex', SPECS.codex(false));
    const r = await doctorWith().run();
    expect(byId(r.results, 'claude-auth')).toMatchObject({ state: 'unauthenticated', action: { kind: 'login', agent: 'claude' } });
    expect(byId(r.results, 'codex-auth')).toMatchObject({ state: 'unauthenticated', action: { kind: 'login', agent: 'codex' } });
    expect(r.summary.mode).toBe('degraded');
  });

  it('saída de status irreconhecível vira "desconhecido", não login', async () => {
    tools.add('claude', SPECS.claude('garbage'));
    const r = await doctorWith().run(['claude']);
    expect(byId(r.results, 'claude-auth').state).toBe('unknown');
  });

  it('PATH incorreto resolvido por caminho configurado', async () => {
    const elsewhere = new FakeToolDir();
    try {
      const claude = elsewhere.add('claude', SPECS.claude(true));
      const r = await doctorWith({ cliPaths: { git: null, codex: null, claude } }).run(['claude']);
      expect(byId(r.results, 'claude')).toMatchObject({ state: 'ok', detail: 'Encontrado via caminho configurado.' });
      expect(byId(r.results, 'claude-auth').state).toBe('ok');
      const bad = await doctorWith({ cliPaths: { git: null, codex: null, claude: '/nao/existe/claude' } }).run(['claude']);
      expect(byId(bad.results, 'claude').state).toBe('missing');
      expect(byId(bad.results, 'claude').detail).toMatch(/caminho configurado não é um executável/);
    } finally { elsewhere.cleanup(); }
  });

  it('versão antiga do Git é incompatível', async () => {
    tools.add('git', SPECS.git('2.4.1'));
    const r = await doctorWith().run(['git']);
    expect(byId(r.results, 'git')).toMatchObject({ state: 'incompatible', action: { kind: 'install', dependency: 'git' } });
  });

  it('ferramenta travada: tempo esgotado ≠ ausente', async () => {
    tools.add('codex', { '--version': { stdout: 'x', sleepMs: 30_000 } });
    const shortRun: CheckContext['run'] = (f, a, o) => runCommand(f, a, { ...o, timeoutMs: 400 });
    const r = await doctorWith({ run: shortRun }).run(['codex']);
    expect(byId(r.results, 'codex')).toMatchObject({ state: 'unknown', action: { kind: 'retry' } });
    expect(byId(r.results, 'codex').detail).toMatch(/Tempo esgotado/);
  });

  it('sem conexão (erro) e conexão lenta (timeout) são estados diferentes', async () => {
    const connect = async (host: string): Promise<ConnectResult> => host === 'a.test' ? { ok: false, timedOut: false, code: 'ENOTFOUND' } : { ok: false, timedOut: true, code: 'TIMEOUT' };
    const r = await doctorWith({ connect }).run(['net-anthropic', 'net-openai']);
    expect(byId(r.results, 'net-anthropic')).toMatchObject({ state: 'error' });
    expect(byId(r.results, 'net-anthropic').detail).toContain('ENOTFOUND');
    expect(byId(r.results, 'net-openai').state).toBe('unknown');
  });

  it('disco insuficiente bloqueia', async () => {
    const r = await doctorWith({ freeDiskBytes: async () => 200 * 1024 ** 2 }).run(['disk']);
    expect(byId(r.results, 'disk')).toMatchObject({ state: 'incompatible', version: '200 MiB livres' });
    expect(r.summary.blockingIssues).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)('permissão negada no diretório de dados', async () => {
    chmodSync(userData, 0o500);
    const r = await doctorWith().run(['app-data']);
    expect(byId(r.results, 'app-data')).toMatchObject({ state: 'error' });
    expect(byId(r.results, 'app-data').detail).toMatch(/Permissão negada/);
  });

  it('reexecução parcial mantém os demais resultados e inclui a conta junto com a CLI', async () => {
    const doctor = doctorWith();
    await doctor.run();
    tools.add('claude', SPECS.claude(true));
    const r = await doctor.run(['claude']);
    expect(byId(r.results, 'claude').state).toBe('ok');
    expect(byId(r.results, 'claude-auth').state).toBe('ok');
    expect(byId(r.results, 'git').state).toBe('missing');
    expect(r.results.length).toBeGreaterThan(10);
  });

  it('respeita o limite de paralelismo e emite progresso', async () => {
    let active = 0; let peak = 0; const reports: number[] = [];
    const run: CheckContext['run'] = async (f, a, o) => { active++; peak = Math.max(peak, active); try { return await runCommand(f, a, o); } finally { active--; } };
    tools.add('git', SPECS.git()); tools.add('claude', SPECS.claude()); tools.add('codex', SPECS.codex()); tools.add('node', SPECS.node()); tools.add('npm', { '--version': { stdout: '10.0.0' } });
    const doctor = new SystemDoctor({ context: () => ctx({ run }), concurrency: 2, onReport: (r) => reports.push(r.results.length) });
    await doctor.run();
    expect(peak).toBeLessThanOrEqual(2);
    expect(reports.length).toBeGreaterThan(3);
  });

  it('persiste resultados na tabela dependencies', async () => {
    const db = openDatabase(':memory:'); migrate(db);
    const repo = new DependencyRepository(db);
    tools.add('git', SPECS.git());
    await new SystemDoctor({ context: () => ctx(), persist: (rs) => repo.saveAll(rs) }).run();
    expect(repo.all().find((d) => d.id === 'git')).toMatchObject({ status: 'ok', version: 'git version 2.54.0' });
    expect(repo.all().find((d) => d.id === 'claude')).toMatchObject({ status: 'missing' });
  });
});

describe('interpretação de status de conta', () => {
  const rr = (stdout: string, exitCode = 0, stderr = ''): RunResult => ({ stdout, stderr, exitCode, signal: null, notFound: false, permissionDenied: false, timedOut: false, cancelled: false, durationMs: 1, spawnError: null });
  it('Claude', () => {
    expect(interpretClaudeAuth(rr('{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}')).state).toBe('ok');
    expect(interpretClaudeAuth(rr('{"loggedIn":true,"authMethod":"api_key"}')).detail).toMatch(/API/);
    expect(interpretClaudeAuth(rr('{"loggedIn":false}', 1)).state).toBe('unauthenticated');
    for (const out of ['', 'null', '[]', '{"loggedIn":"yes"}', 'Logged in!']) expect(interpretClaudeAuth(rr(out)).state).toBe('unknown');
  });
  it('Codex', () => {
    expect(interpretCodexAuth(rr('Logged in using ChatGPT\n')).state).toBe('ok');
    expect(interpretCodexAuth(rr('Logged in using an API key - sk-***\n')).detail).toMatch(/API/);
    expect(interpretCodexAuth(rr('', 1, 'Not logged in\n')).state).toBe('unauthenticated');
    expect(interpretCodexAuth(rr('algo novo', 0)).state).toBe('unknown');
    expect(interpretCodexAuth(rr('', 1, 'panic')).state).toBe('unknown');
  });
});

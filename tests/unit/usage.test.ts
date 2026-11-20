import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeStatuslineBridge, STATUSLINE_SCRIPT, shellQuote } from '../../src/main/usage/ClaudeStatuslineBridge';
import { readCodexUsage } from '../../src/main/usage/CodexUsageReader';
import { UsageService } from '../../src/main/usage/UsageService';
import { windowLabel, type ProviderUsage } from '../../src/shared/usage';
import { FakeToolDir } from '../helpers/fakeTools';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-usage-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runScript = (input: string, out: string) => {
  const script = join(dir, 's.cjs'); writeFileSync(script, STATUSLINE_SCRIPT);
  return execFileSync(process.execPath, [script, out], { input }).toString();
};

describe('script da statusline do Claude', () => {
  it('grava só rate_limits (sem cwd/transcrição) e imprime a linha curta', () => {
    const out = join(dir, 'u.json');
    const line = runScript(JSON.stringify({
      cwd: '/projeto/secreto', transcript_path: '/x/t.jsonl', session_id: 'abc', model: { id: 'm' },
      rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } },
    }), out);
    expect(line).toBe('DevFusion · uso do plano: 5h 24% · semana 41%');
    const saved = JSON.parse(readFileSync(out, 'utf8'));
    expect(Object.keys(saved).sort()).toEqual(['rate_limits', 'receivedAt']);
    expect(saved.rate_limits).toEqual({ five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } });
    expect(readFileSync(out, 'utf8')).not.toContain('secreto');
  });

  it('sem rate_limits (antes da 1ª resposta) ou com entrada inválida não grava nada e não falha', () => {
    const out = join(dir, 'u.json');
    expect(runScript(JSON.stringify({ cwd: '/x' }), out)).toBe('DevFusion · uso do plano: aguardando a primeira resposta');
    expect(runScript('isto não é json', out)).toBe('DevFusion · uso do plano: aguardando a primeira resposta');
    expect(existsSync(out)).toBe(false);
  });

  it('janela ausente é independente da outra', () => {
    const out = join(dir, 'u.json');
    expect(runScript(JSON.stringify({ rate_limits: { seven_day: { used_percentage: 5 } } }), out)).toBe('DevFusion · uso do plano: semana 5%');
  });
});

describe('ClaudeStatuslineBridge', () => {
  it('monta --settings com statusLine e caminhos protegidos por aspas', () => {
    const b = new ClaudeStatuslineBridge(join(dir, "com espaço e 'aspas'"), () => ({ executable: '/opt/node bin/node', runAsNodeEnv: false }));
    const [flag, json] = b.settingsArgs();
    expect(flag).toBe('--settings');
    const cfg = JSON.parse(json!);
    expect(cfg.statusLine.type).toBe('command');
    expect(cfg.statusLine.command).toBe(`'/opt/node bin/node' ${shellQuote(b.scriptPath)} ${shellQuote(b.dataPath)}`);
    expect(existsSync(b.scriptPath)).toBe(true);
    expect(new ClaudeStatuslineBridge(dir, () => ({ executable: '/e', runAsNodeEnv: true })).settingsArgs()[1]).toContain('ELECTRON_RUN_AS_NODE=1 ');
    expect(new ClaudeStatuslineBridge(dir, () => null).settingsArgs()).toEqual([]);
    expect(() => shellQuote('a\nb')).toThrow();
  });

  it.skipIf(process.platform === 'win32')('o comando gerado roda de verdade no shell e alimenta read()', () => {
    const b = new ClaudeStatuslineBridge(join(dir, "pasta 'x'"), () => ({ executable: process.execPath, runAsNodeEnv: false }));
    expect(b.read()).toMatchObject({ status: 'no-data' });
    const cmd = JSON.parse(b.settingsArgs()[1]!).statusLine.command as string;
    execFileSync('/bin/sh', ['-c', cmd], { input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 2000000000 } } }) });
    const u = b.read();
    expect(u.status).toBe('ok');
    expect(u.windows).toEqual([{ label: '5 horas', usedPercent: 12, resetsAt: new Date(2e12).toISOString(), windowMinutes: 300 }]);
  });

  it('arquivo corrompido vira erro explicado', () => {
    const b = new ClaudeStatuslineBridge(dir, () => null);
    writeFileSync(b.dataPath, '{quebrado');
    expect(b.read()).toMatchObject({ status: 'error' });
    writeFileSync(b.dataPath, JSON.stringify({ receivedAt: 'x', rate_limits: { five_hour: { used_percentage: 'muito' } } }));
    expect(b.read()).toMatchObject({ status: 'error' });
  });
});

describe.skipIf(process.platform === 'win32')('readCodexUsage (App Server falso)', () => {
  let tools: FakeToolDir;
  beforeEach(() => { tools = new FakeToolDir(); });
  afterEach(() => tools.cleanup());
  const RESULT = {
    rateLimits: { primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 2000600000 }, planType: 'plus', rateLimitReachedType: null },
    ordinaryUsageAllowed: true, rateLimitResetCredits: { availableCount: 1 }, accountId: 'nao-exibir',
  };
  const read = (opts = {}) => readCodexUsage({ codexPath: () => join(tools.dir, 'codex'), env: () => ({ PATH: '/usr/bin:/bin' }), timeoutMs: 3000, ...opts });

  it('mapeia 5 h e semanal, plano e extras; só envia métodos de leitura', async () => {
    const log = join(tools.dir, 'methods.log');
    tools.add('codex', { 'app-server': { jsonrpc: { results: { 'account/rateLimits/read': RESULT }, logFile: log } } });
    const u = await read();
    expect(u).toMatchObject({ status: 'ok', plan: 'plus', extras: { resetCreditsAvailable: 1, ordinaryUsageAllowed: true, limitReached: null } });
    expect(u.windows.map((w) => [w.label, w.usedPercent, w.windowMinutes])).toEqual([['5 horas', 8, 300], ['Semanal (7 dias)', 1, 10080]]);
    expect(u.windows[0]!.resetsAt).toBe(new Date(2e12).toISOString());
    expect(JSON.stringify(u)).not.toContain('nao-exibir');
    await new Promise((r) => setTimeout(r, 200));
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['initialize', 'initialized', 'account/rateLimits/read']);
  });

  it('erros: sem login, formato inesperado, sem resposta, CLI ausente', async () => {
    tools.add('codex', { 'app-server': { jsonrpc: { results: {}, errors: { 'account/rateLimits/read': 'not signed in to ChatGPT (auth required)' } } } });
    expect(await read()).toMatchObject({ status: 'unavailable', note: expect.stringMatching(/login/) });
    tools.add('codex', { 'app-server': { jsonrpc: { results: { 'account/rateLimits/read': { algo: 1 } } } } });
    expect(await read()).toMatchObject({ status: 'error', note: expect.stringMatching(/formato inesperado/) });
    tools.add('codex', { 'app-server': { jsonrpc: { results: {}, silent: true } } });
    expect(await read({ timeoutMs: 500 })).toMatchObject({ status: 'error', note: expect.stringMatching(/Tempo esgotado/) });
    expect(await readCodexUsage({ codexPath: () => null, env: () => ({}) })).toMatchObject({ status: 'unavailable' });
  });
});

describe('UsageService', () => {
  it('falha temporária do Codex mantém o último valor bom e explica', async () => {
    const good: ProviderUsage = { provider: 'codex', status: 'ok', windows: [{ label: '5 horas', usedPercent: 8, resetsAt: null, windowMinutes: 300 }], plan: 'plus', updatedAt: 'x', source: 's', note: null, extras: {} };
    const responses = [good, { ...good, status: 'error' as const, windows: [], note: 'Tempo esgotado ao consultar o Codex.' }];
    const svc = new UsageService({ readCodex: async () => responses.shift()!, claude: new ClaudeStatuslineBridge(dir, () => null), emit: () => undefined });
    expect((await svc.refresh()).codex.status).toBe('ok');
    const r = await svc.refresh();
    expect(r.codex).toMatchObject({ status: 'ok', windows: good.windows });
    expect(r.codex.note).toMatch(/Última atualização falhou: Tempo esgotado/);
  });

  it('rótulos das janelas vêm da duração informada', () => {
    expect([300, 10080, 1440, 120, 45, null].map((m) => windowLabel(m))).toEqual(['5 horas', 'Semanal (7 dias)', '1 dia(s)', '2 hora(s)', '45 min', 'janela']);
  });
});

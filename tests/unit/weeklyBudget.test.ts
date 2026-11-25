import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../../src/shared/agentIds';
import { WeeklyBudgetSettingsSchema, type BudgetState, type WeeklyBudgetSettings } from '../../src/shared/budget';
import type { ProviderUsage, UsageReport } from '../../src/shared/usage';
import { WeeklyBudget } from '../../src/main/usage/WeeklyBudget';
import { codexWorkerScript, orchestratorInstructions, orchestratorPaths, type OrchestratorContext } from '../../src/main/orchestrator/DevOrchestrator';
import { DEFAULT_ORCHESTRATOR } from '../../src/shared/orchestrator';

let dir: string; let clock: number; let settings: WeeklyBudgetSettings; let stops: Array<[AgentId, string]>; let emitted: BudgetState[];
const MIN = 60_000;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-budget-')); clock = Date.parse('2026-11-25T12:00:00Z'); settings = { enabled: true, percent: 15 }; stops = []; emitted = []; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = () => new WeeklyBudget({ file: join(dir, 'b.json'), settings: () => settings, emit: (s) => emitted.push(s), onStop: (a, r) => stops.push([a, r]), now: () => clock });
const WEEK_END = '2026-11-30T00:00:00.000Z';
const usage = (provider: AgentId, weekly: number | null, over: { resetsAt?: string; at?: number; status?: ProviderUsage['status'] } = {}): ProviderUsage => ({
  provider, status: over.status ?? (weekly === null ? 'no-data' : 'ok'), plan: null, source: 's', note: null, extras: {},
  updatedAt: weekly === null ? null : new Date(over.at ?? clock).toISOString(),
  windows: weekly === null ? [] : [
    { label: '5 horas', usedPercent: 99, resetsAt: null, windowMinutes: 300 },
    { label: 'Semanal (7 dias)', usedPercent: weekly, resetsAt: over.resetsAt ?? WEEK_END, windowMinutes: 10080 },
  ],
});
const report = (claude: number | null, codex: number | null = null): UsageReport => ({ claude: usage('claude', claude), codex: usage('codex', codex) });
/** Nova leitura do Claude `min` minutos depois. */
const tick = (b: WeeklyBudget, claude: number, min = 1) => { clock += min * MIN; b.observe(report(claude)); };

describe('limite semanal', () => {
  it('semana em 8% + limite de 15%: para ao chegar em 23%, nunca antes nem depois', () => {
    const b = make();
    b.observe(report(8));
    expect(b.state().providers.claude).toMatchObject({ baseline: 8, current: 8, spent: 0, stop: null });
    for (let v = 9; v <= 22; v++) tick(b, v);
    expect(b.state().providers.claude).toMatchObject({ spent: 14, stop: null });
    expect(b.blocked('claude')).toBeNull();
    tick(b, 23);
    expect(b.state().providers.claude).toMatchObject({ spent: 15, stop: 'reached' });
    expect(stops).toEqual([['claude', 'reached']]);
    expect(b.blocked('claude')).toContain('Limite semanal de 15% atingido');
    tick(b, 24);
    expect(stops).toHaveLength(1);
  });

  it('para antes quando o próximo passo, pelo ritmo recente, passaria do limite', () => {
    const b = make();
    b.observe(report(8));
    for (const v of [12, 16, 19]) tick(b, v);
    expect(stops).toEqual([]);
    tick(b, 20); // gastou 12; o maior passo recente foi 4: 16 > 15
    expect(stops).toEqual([['claude', 'margin']]);
    expect(b.state().providers.claude).toMatchObject({ spent: 12, stop: 'margin' });
  });

  it('a reserva tem teto e ignora saltos entre leituras distantes (uso fora do app)', () => {
    const b = make();
    b.observe(report(8));
    tick(b, 12, 600);
    expect(b.state().providers.claude).toMatchObject({ spent: 4, stop: null });
    tick(b, 13);
    expect(stops).toEqual([]);
    settings = { enabled: true, percent: 30 };
    const c = make(); c.restart(); c.observe(report(13));
    tick(c, 33); // salto de 20: reserva só 5 (20 + 5 <= 30)
    expect(stops).toEqual([]);
  });

  it('cada provedor tem a própria conta', () => {
    const b = make();
    b.observe(report(8, 50));
    clock += MIN; b.observe(report(9, 65));
    expect(stops).toEqual([['codex', 'reached']]);
    expect(b.blocked('claude')).toBeNull();
    expect(b.blocked('codex')).not.toBeNull();
  });

  it('limite de 1% funciona e casas decimais não acumulam erro', () => {
    settings = { enabled: true, percent: 1 };
    const b = make();
    b.observe(report(8.1));
    expect(stops).toEqual([]);
    for (const v of [8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9]) tick(b, v);
    expect(stops).toEqual([]);
    tick(b, 9.1);
    expect(stops).toEqual([['claude', 'reached']]);
  });

  it('a semana virar no meio não zera nem estoura a conta; correção para baixo é ignorada', () => {
    const b = make();
    b.observe(report(90));
    for (const v of [92, 94, 96]) tick(b, v);
    clock += MIN;
    b.observe({ claude: usage('claude', 2, { resetsAt: '2026-12-07T00:00:00.000Z' }), codex: usage('codex', null) });
    expect(b.state().providers.claude).toMatchObject({ spent: 8, current: 2, stop: null });
    clock += MIN;
    b.observe({ claude: usage('claude', 1, { resetsAt: '2026-12-07T00:00:00.000Z' }), codex: usage('codex', null) });
    expect(b.state().providers.claude.spent).toBe(8);
  });

  it('leitura velha não vira ponto de partida; repetida, com erro ou sem janela semanal não conta', () => {
    const b = make();
    b.observe({ claude: usage('claude', 8, { at: clock - 60 * MIN }), codex: usage('codex', null) });
    expect(b.state().providers.claude.baseline).toBeNull();
    b.observe(report(10)); b.observe(report(10));
    b.observe({ claude: usage('claude', 90, { status: 'error', at: clock + MIN }), codex: usage('codex', null) });
    const noWeek = usage('claude', 90, { at: clock + MIN }); noWeek.windows = noWeek.windows.slice(0, 1);
    b.observe({ claude: noWeek, codex: usage('codex', null) });
    expect(b.state().providers.claude).toMatchObject({ baseline: 10, spent: 0 });
  });

  it('desligado não conta, não bloqueia e não para nada', () => {
    settings = { enabled: false, percent: 1 };
    const b = make();
    b.observe(report(8)); tick(b, 80);
    expect(stops).toEqual([]);
    expect(b.blocked('claude')).toBeNull();
    expect(b.state().providers.claude.baseline).toBeNull();
  });

  it('ligar começa do uso atual; aumentar libera; diminuir pode parar; Recomeçar zera', () => {
    settings = { enabled: false, percent: 2 };
    const b = make();
    const off = settings;
    settings = { enabled: true, percent: 2 };
    b.settingsChanged(off, report(8));
    expect(b.state().providers.claude.baseline).toBe(8);
    tick(b, 10);
    expect(b.blocked('claude')).not.toBeNull();
    const two = settings; settings = { enabled: true, percent: 20 };
    b.settingsChanged(two, report(10));
    expect(b.blocked('claude')).toBeNull();
    const twenty = settings; settings = { enabled: true, percent: 2 };
    b.settingsChanged(twenty, report(10));
    expect(stops).toEqual([['claude', 'reached'], ['claude', 'reached']]);
    b.restart(report(10));
    expect(b.state().providers.claude).toMatchObject({ baseline: 10, spent: 0, stop: null });
  });

  it('a contagem sobrevive a reiniciar o app; arquivo corrompido recomeça', () => {
    const b = make();
    b.observe(report(8)); tick(b, 12);
    const again = make();
    expect(again.state().providers.claude).toMatchObject({ baseline: 8, current: 12, spent: 4 });
    tick(again, 23);
    expect(stops).toEqual([['claude', 'reached']]);
    expect(make().blocked('claude')).not.toBeNull();
    writeFileSync(join(dir, 'b.json'), '{lixo');
    expect(make().state().providers.claude.baseline).toBeNull();
  });

  it('valores fora de 1 a 100 são recusados', () => {
    for (const percent of [0, 101, 1.5, -1]) expect(WeeklyBudgetSettingsSchema.safeParse({ enabled: true, percent }).success).toBe(false);
  });
});

describe('limite semanal no Dev Orchestrator', () => {
  const ctx = (over: Partial<OrchestratorContext>): OrchestratorContext => ({ settings: DEFAULT_ORCHESTRATOR, ...orchestratorPaths(join('x', 'u')), workspacePath: 'p', codexPath: '/bin/codex', aiMemoryPath: null, ...over });
  it('o script recusa novos workers do Codex enquanto o bloqueio existir', () => {
    const s = codexWorkerScript(ctx({}));
    expect(s).toContain('codex.blocked');
    expect(s).toContain('exit 4');
    expect(codexWorkerScript(ctx({ codexBlockPath: undefined }))).not.toContain('exit 4');
  });
  it('o orquestrador é avisado do limite só quando está ligado', () => {
    expect(orchestratorInstructions(ctx({ weeklyBudgetPercent: 15 }), 'claude')).toContain('até 15% da cota semanal');
    expect(orchestratorInstructions(ctx({ weeklyBudgetPercent: null }), 'claude')).not.toContain('Limite semanal');
  });
});

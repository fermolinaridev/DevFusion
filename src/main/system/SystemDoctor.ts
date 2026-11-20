import { CHECK_IDS, ON_DEMAND_CHECKS, type CheckId, type CheckResult, type DoctorReport, type DoctorSummary } from '@shared/doctor';
import { CHECKS, type CheckContext } from './checks';

export interface SystemDoctorOptions {
  /** Monta o contexto a cada execução (configurações podem ter mudado). */
  context: () => CheckContext;
  persist?: (results: CheckResult[]) => void;
  onReport?: (report: DoctorReport) => void;
  concurrency?: number;
  now?: () => Date;
}

/**
 * Executa os checks em paralelo limitado, respeitando dependências (conta depende da CLI).
 * Uma execução por vez: pedidos durante uma execução entram na fila e rodam em seguida.
 */
export class SystemDoctor {
  private report: DoctorReport;
  private runCounter = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly concurrency: number;
  private readonly now: () => Date;

  constructor(private readonly opts: SystemDoctorOptions) {
    this.concurrency = Math.max(1, opts.concurrency ?? 4);
    this.now = opts.now ?? (() => new Date());
    this.report = { runId: 0, startedAt: this.now().toISOString(), finishedAt: null, running: false, results: [], summary: summarize([]) };
  }

  getReport(): DoctorReport { return this.report; }

  /** Roda os checks pedidos (padrão: todos, exceto os sob demanda). */
  run(ids?: readonly CheckId[]): Promise<DoctorReport> {
    const next = this.chain.then(() => this.execute(ids));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async execute(requested?: readonly CheckId[]): Promise<DoctorReport> {
    const ctx = this.opts.context();
    const wanted = new Set<CheckId>(requested ?? CHECK_IDS.filter((id) => !ON_DEMAND_CHECKS.includes(id)));
    // Reexecutar uma CLI implica reexecutar a conta correspondente.
    if (wanted.has('claude')) wanted.add('claude-auth');
    if (wanted.has('codex')) wanted.add('codex-auth');
    const defs = CHECKS.filter((c) => wanted.has(c.id));

    const runId = ++this.runCounter;
    const previous = new Map(this.report.results.map((r) => [r.id, r]));
    this.report = { ...this.report, runId, startedAt: this.now().toISOString(), finishedAt: null, running: true };
    this.emit();

    const promises = new Map<CheckId, Promise<CheckResult>>();
    const fresh = new Map<CheckId, CheckResult>();
    let active = 0;
    const queue: Array<() => void> = [];
    const slot = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= this.concurrency) await new Promise<void>((r) => queue.push(r));
      active++;
      try { return await fn(); } finally { active--; queue.shift()?.(); }
    };

    for (const def of defs) {
      promises.set(def.id, (async () => {
        let dep: CheckResult | undefined;
        if (def.dependsOn) dep = promises.has(def.dependsOn) ? await promises.get(def.dependsOn) : previous.get(def.dependsOn);
        const started = Date.now();
        const result: CheckResult = await slot(async () => {
          try {
            const o = await def.run(ctx, dep ? { [def.dependsOn!]: dep } : {});
            return { id: def.id, label: def.label, group: def.group, requirement: def.requirement, version: null, path: null, action: { kind: 'none' }, ...o, durationMs: Date.now() - started, checkedAt: this.now().toISOString() };
          } catch (e) {
            return { id: def.id, label: def.label, group: def.group, requirement: def.requirement, state: 'error', version: null, path: null, detail: `Falha inesperada no diagnóstico: ${(e as Error).message.slice(0, 160)}`, action: { kind: 'retry' }, durationMs: Date.now() - started, checkedAt: this.now().toISOString() };
          }
        });
        fresh.set(def.id, result);
        this.report = { ...this.report, results: merge(this.report.results, [result]) };
        this.emit();
        return result;
      })());
    }
    await Promise.all(promises.values());

    const results = merge([...previous.values()], [...fresh.values()]);
    this.report = { runId, startedAt: this.report.startedAt, finishedAt: this.now().toISOString(), running: false, results, summary: summarize(results) };
    try { this.opts.persist?.([...fresh.values()]); } catch { /* persistência não deve derrubar o diagnóstico */ }
    this.emit();
    return this.report;
  }

  private emit(): void { this.opts.onReport?.(this.report); }
}

function merge(base: readonly CheckResult[], updates: readonly CheckResult[]): CheckResult[] {
  const map = new Map(base.map((r) => [r.id, r]));
  for (const u of updates) map.set(u.id, u);
  return CHECK_IDS.filter((id) => map.has(id)).map((id) => map.get(id)!);
}

export function summarize(results: readonly CheckResult[]): DoctorSummary {
  const ok = (id: CheckId) => results.find((r) => r.id === id)?.state === 'ok';
  const readyAgents = (['claude', 'codex'] as const).filter((a) => ok(a) && ok(`${a}-auth`));
  const blockingIssues = results.filter((r) => r.requirement === 'required' && r.state !== 'ok').length;
  const mode = readyAgents.length === 2 ? 'full' : readyAgents.length === 1 ? 'individual' : 'degraded';
  return { readyAgents, blockingIssues, mode };
}

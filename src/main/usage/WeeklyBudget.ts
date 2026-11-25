import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { AGENT_IDS, type AgentId } from '@shared/agentIds';
import { EMPTY_PROVIDER_BUDGET, type BudgetState, type BudgetStop, type WeeklyBudgetSettings } from '@shared/budget';
import type { ProviderUsage, UsageReport } from '@shared/usage';

export const WEEK_MINUTES = 10080;
/** Leitura mais velha que isso não serve de ponto de partida (o uso pode ter mudado fora do app). */
const FRESH_MS = 10 * 60_000;
/** Saltos só contam como ritmo entre leituras próximas, e o ritmo nunca reserva mais que isto. */
const MAX_MARGIN = 5;
const RECENT_STEPS = 5;

const MeterSchema = z.object({
  baseline: z.number().nullable(),
  current: z.number().nullable(),
  spent: z.number().min(0),
  stop: z.enum(['reached', 'margin']).nullable(),
  resetsAt: z.string().nullable(),
  readAt: z.string().nullable(),
  steps: z.array(z.number()),
});
type Meter = z.infer<typeof MeterSchema>;
const FileSchema = z.object({ startedAt: z.string(), claude: MeterSchema, codex: MeterSchema });
type Saved = z.infer<typeof FileSchema>;

const newMeter = (): Meter => ({ ...EMPTY_PROVIDER_BUDGET, resetsAt: null, readAt: null, steps: [] });
const round = (n: number) => Math.round(n * 10) / 10;

export interface WeeklyBudgetDeps {
  /** Arquivo com a contagem: sobrevive a reinícios do app. */
  file: string;
  settings: () => WeeklyBudgetSettings;
  emit: (s: BudgetState) => void;
  /** O limite de um provedor acabou (ou vai acabar): encerrar o que estiver rodando nele. */
  onStop: (agent: AgentId, reason: BudgetStop, state: BudgetState) => void;
  now?: () => number;
}

/**
 * Limite de gasto semanal (pedido do usuário). Usa só os números oficiais de uso do plano; nunca lê a
 * saída dos agentes. O uso informado é da conta inteira: gastos fora do DevFusion também contam.
 */
export class WeeklyBudget {
  private data: Saved;
  private readonly now: () => number;

  constructor(private readonly d: WeeklyBudgetDeps) {
    this.now = d.now ?? Date.now;
    this.data = this.load() ?? this.fresh();
  }

  state(): BudgetState {
    const s = this.d.settings();
    const view = (m: Meter) => ({ baseline: m.baseline, current: m.current, spent: round(m.spent), stop: s.enabled ? m.stop : null });
    return { enabled: s.enabled, percent: s.percent, startedAt: s.enabled ? this.data.startedAt : null, providers: { claude: view(this.data.claude), codex: view(this.data.codex) } };
  }

  /** Zera a contagem: o uso atual vira o novo ponto de partida. */
  restart(report?: UsageReport): BudgetState {
    this.data = this.fresh();
    if (report && this.d.settings().enabled) for (const a of AGENT_IDS) this.read(a, report[a]);
    return this.commit();
  }

  /** A configuração mudou: ligar recomeça a contagem; mudar o valor só reavalia. */
  settingsChanged(before: WeeklyBudgetSettings, report: UsageReport): void {
    const s = this.d.settings();
    if (s.enabled && !before.enabled) { this.restart(report); return; }
    if (s.enabled && s.percent !== before.percent) for (const a of AGENT_IDS) { this.data[a].stop = null; this.evaluate(a); }
    this.commit();
  }

  /** Nova leitura oficial de uso. */
  observe(report: UsageReport): void {
    if (!this.d.settings().enabled) return;
    let changed = false;
    for (const a of AGENT_IDS) changed = this.read(a, report[a]) || changed;
    if (changed) this.commit();
  }

  /** Mensagem quando o agente não pode iniciar; null quando pode. */
  blocked(agent: AgentId): string | null {
    const s = this.d.settings();
    if (!s.enabled || !this.data[agent].stop) return null;
    return `Limite semanal de ${s.percent}% atingido (usou ${round(this.data[agent].spent)}%). Aumente o limite ou clique em Recomeçar para continuar.`;
  }

  private read(agent: AgentId, u: ProviderUsage): boolean {
    const w = u.windows.find((x) => x.windowMinutes === WEEK_MINUTES);
    if (u.status !== 'ok' || !w || !u.updatedAt) return false;
    const m = this.data[agent];
    if (m.readAt !== null && Date.parse(u.updatedAt) <= Date.parse(m.readAt)) return false;
    if (m.current === null) {
      // Ponto de partida: precisa ser recente em relação a quando a contagem começou.
      if (Date.parse(u.updatedAt) < Date.parse(this.data.startedAt) - FRESH_MS) return false;
      Object.assign(m, { baseline: w.usedPercent, current: w.usedPercent, resetsAt: w.resetsAt, readAt: u.updatedAt });
      return true;
    }
    let delta = w.usedPercent - m.current;
    if (delta < 0) {
      // Queda com novo horário de reinício = a semana virou: o que já foi usado na nova conta. Senão, correção da fonte.
      const reset = w.resetsAt !== null && m.resetsAt !== null && Date.parse(w.resetsAt) - Date.parse(m.resetsAt) > 3_600_000;
      delta = reset ? w.usedPercent : 0;
    }
    const gap = Date.parse(u.updatedAt) - Date.parse(m.readAt!);
    if (delta > 0 && gap <= FRESH_MS) m.steps = [...m.steps, delta].slice(-RECENT_STEPS);
    Object.assign(m, { spent: m.spent + delta, current: w.usedPercent, resetsAt: w.resetsAt, readAt: u.updatedAt });
    this.evaluate(agent);
    return true;
  }

  private evaluate(agent: AgentId): void {
    const m = this.data[agent];
    if (m.stop) return;
    const limit = this.d.settings().percent;
    const spent = round(m.spent);
    const margin = Math.min(MAX_MARGIN, Math.max(0, ...m.steps));
    // Sem gasto ainda não há o que frear (e um limite pequeno nunca trava antes de começar).
    if (spent >= limit) m.stop = 'reached';
    else if (spent > 0 && margin > 0 && round(spent + margin) > limit) m.stop = 'margin';
    if (m.stop) this.pendingStops.push({ agent, reason: m.stop });
  }
  private pendingStops: Array<{ agent: AgentId; reason: BudgetStop }> = [];

  /** Grava, avisa a interface e só então encerra o que passou do limite. */
  private commit(): BudgetState {
    this.save();
    const s = this.state();
    this.d.emit(s);
    const stops = this.pendingStops;
    this.pendingStops = [];
    for (const x of stops) this.d.onStop(x.agent, x.reason, s);
    return s;
  }

  private fresh(): Saved { return { startedAt: new Date(this.now()).toISOString(), claude: newMeter(), codex: newMeter() }; }

  private load(): Saved | null {
    try { return FileSchema.parse(JSON.parse(readFileSync(this.d.file, 'utf8'))); } catch { return null; }
  }

  private save(): void {
    mkdirSync(dirname(this.d.file), { recursive: true });
    const tmp = `${this.d.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.d.file);
  }
}

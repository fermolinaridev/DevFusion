import { useEffect, useState } from 'react';
import { AGENT_IDS, AGENT_NAMES, type AgentId } from '@shared/agents';
import type { BudgetState } from '@shared/budget';
import { useAppStore } from '../../stores/appStore';
import { useBudgetStore } from '../../stores/budgetStore';

const COLOR: Record<AgentId, string> = { claude: 'text-claude', codex: 'text-codex' };
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function Meter({ agent, state }: { agent: AgentId; state: BudgetState }) {
  const p = state.providers[agent];
  const fill = Math.min(100, (p.spent / state.percent) * 100);
  const tone = p.stop ? 'bg-claude' : fill >= 70 ? 'bg-warn' : 'bg-accent';
  // Semana virou no meio da contagem: "de X até Y" deixaria de fazer sentido.
  const sameWeek = p.baseline !== null && p.current !== null && Math.abs(p.current - p.baseline - p.spent) < 0.2;
  const target = sameWeek ? Math.min(100, p.baseline! + state.percent) : null;
  return (
    <div className="flex min-w-fit flex-1 items-center gap-2" data-testid={`budget-${agent}`}>
      <span className={`shrink-0 font-medium ${COLOR[agent]}`}>{AGENT_NAMES[agent]}</span>
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded bg-surface-2" role="progressbar" aria-label={`Limite semanal do ${AGENT_NAMES[agent]}`} aria-valuemin={0} aria-valuemax={state.percent} aria-valuenow={Math.min(p.spent, state.percent)}>
        <div className={`h-full ${tone}`} style={{ width: `${fill}%` }} />
      </div>
      <span className="shrink-0 tabular-nums text-muted" data-testid={`budget-${agent}-text`} title={target === null ? undefined : `A semana estava em ${pct(p.baseline!)} e está em ${pct(p.current!)}. Para em ${pct(target)}.`}>
        {p.baseline === null ? 'aguardando leitura' : `${pct(p.spent)} de ${pct(state.percent)}${target === null ? '' : ` · semana ${pct(p.current!)} → ${pct(target)}`}`}
      </span>
      {p.stop && <span role="alert" className="shrink-0 text-warn" data-testid={`budget-${agent}-stop`}>{p.stop === 'reached' ? 'parado: atingiu o limite' : 'parado: ia passar do limite'}</span>}
    </div>
  );
}

/** Limite de gasto semanal, abaixo dos terminais. */
export function BudgetBar() {
  const b = useAppStore((s) => s.settings.weeklyBudget);
  const setSetting = useAppStore((s) => s.setSetting);
  const state = useBudgetStore((s) => s.state);
  const restart = useBudgetStore((s) => s.restart);
  const [draft, setDraft] = useState(b.percent);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(b.percent), [b.percent]);
  const save = async (patch: Partial<typeof b>) => setError(await setSetting('weeklyBudget', { ...b, ...patch }));
  const commit = () => {
    const v = Math.min(100, Math.max(1, Math.round(draft) || 1));
    setDraft(v);
    if (v !== b.percent) void save({ percent: v });
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-surface px-3 py-1 text-xs" data-testid="budget-bar">
      <label className="flex items-center gap-1.5" title="Encerra o agente quando ele gastar este tanto da cota semanal. Usa os números oficiais da conta: gastos fora do DevFusion também contam.">
        <input type="checkbox" checked={b.enabled} onChange={(e) => void save({ enabled: e.target.checked })} data-testid="budget-enabled" />
        Limite semanal
      </label>
      <input type="range" min={1} max={100} value={draft} aria-label="Quanto da cota semanal pode gastar" className="w-28" data-testid="budget-range"
        onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span className="flex items-center gap-1">
        <input type="number" min={1} max={100} value={draft} aria-label="Porcentagem da cota semanal" className="w-14 rounded border border-border bg-bg px-1 py-0.5" data-testid="budget-percent"
          onChange={(e) => setDraft(Number(e.target.value))} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
        % da semana
      </span>
      {b.enabled && state?.enabled && (
        <>
          {AGENT_IDS.map((a) => <Meter key={a} agent={a} state={state} />)}
          <button className="rounded border border-border px-2 py-0.5 hover:bg-surface-2" onClick={() => void restart()} title="Começa a contar de novo a partir do uso atual" data-testid="budget-restart">Recomeçar</button>
        </>
      )}
      {error && <span role="alert" className="text-warn">{error}</span>}
    </div>
  );
}

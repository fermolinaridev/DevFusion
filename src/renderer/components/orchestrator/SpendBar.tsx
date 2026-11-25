import { AGENT_IDS, AGENT_NAMES } from '@shared/agents';
import { EFFORT_LABEL, ORCH_TIERS, SPEND_HINT, SPEND_LABEL, SPEND_LEVELS, TIER_LABEL, modelLabel, type OrchestratorSettings } from '@shared/orchestrator';
import { resolveSpend } from '@shared/spend';

interface Props {
  settings: OrchestratorSettings;
  disabled: boolean;
  disabledTitle?: string;
  onChange: (patch: Partial<OrchestratorSettings>) => void;
}

/** Nível de gasto de tokens e modo Eco, com os modelos que cada classe de tarefa vai usar. */
export function SpendBar({ settings, disabled, disabledTitle, onChange }: Props) {
  const r = resolveSpend(settings);
  const slot = (s: { model: string; effort: keyof typeof EFFORT_LABEL }) => `${modelLabel(s.model)} (${EFFORT_LABEL[s.effort]})`;
  const btn = (active: boolean) => `rounded px-2 py-0.5 ${active ? 'bg-accent text-accent-contrast' : 'hover:bg-surface-2'} disabled:opacity-50`;
  return (
    <div className="flex basis-full flex-col gap-1" data-testid="spend-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Gasto de tokens</span>
        <div role="radiogroup" aria-label="Nível de gasto de tokens" className="flex flex-wrap gap-1">
          {SPEND_LEVELS.map((l) => (
            <button key={l} role="radio" aria-checked={settings.spend === l} className={btn(settings.spend === l)} disabled={disabled}
              title={disabledTitle ?? SPEND_HINT[l]} onClick={() => onChange({ spend: l })} data-testid={`spend-${l}`}>{SPEND_LABEL[l]}</button>
          ))}
        </div>
        <button aria-pressed={settings.eco} className={`border border-border ${btn(settings.eco)}`} disabled={disabled}
          title={disabledTitle ?? 'Reduz o gasto em qualquer nível. Tarefas críticas não mudam.'} onClick={() => onChange({ eco: !settings.eco })} data-testid="spend-eco">Eco{settings.eco ? ' ligado' : ''}</button>
        <span className="text-muted">{SPEND_HINT[settings.spend]}</span>
      </div>
      <details data-testid="spend-details">
        <summary className="cursor-pointer text-muted" data-testid="spend-summary">Modelos neste nível · orquestrador {slot(settings.lead === 'claude' ? r.leadClaude : r.leadCodex)} · até {r.maxParallel} workers</summary>
        <table className="mt-1 text-left" data-testid="spend-table">
          <thead className="text-muted"><tr><th className="pr-4 font-normal">Tarefa</th>{AGENT_IDS.map((a) => <th key={a} className="pr-4 font-normal">{AGENT_NAMES[a]}</th>)}</tr></thead>
          <tbody>
            {ORCH_TIERS.map((t) => (
              <tr key={t} data-testid={`spend-row-${t}`}><td className="pr-4">{TIER_LABEL[t]}</td>{AGENT_IDS.map((a) => <td key={a} className="pr-4">{slot(r.roster[t][a])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

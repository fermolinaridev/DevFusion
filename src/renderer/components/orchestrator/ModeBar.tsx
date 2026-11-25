import { useState } from 'react';
import { AGENT_IDS, AGENT_NAMES, type AgentId } from '@shared/agents';
import { EFFORT_LABEL, modelLabel } from '@shared/orchestrator';
import { useAgentStore } from '../../stores/agentStore';
import { resolveSpend } from '@shared/spend';
import { useAppStore } from '../../stores/appStore';
import { SpendBar } from './SpendBar';

/** Alterna entre agentes lado a lado e o Dev Orchestrator (Fase 9). */
export function ModeBar() {
  const o = useAppStore((s) => s.settings.orchestrator);
  const setSetting = useAppStore((s) => s.setSetting);
  const sessions = useAgentStore((s) => s.sessions);
  const [error, setError] = useState<string | null>(null);
  const busy = AGENT_IDS.some((a) => sessions[a]?.status === 'running');
  const save = async (patch: Partial<typeof o>) => setError(await setSetting('orchestrator', { ...o, ...patch }));
  const resolved = resolveSpend(o);
  const lead = (a: AgentId) => (a === 'claude' ? resolved.leadClaude : resolved.leadCodex);
  const btn = (active: boolean) => `rounded px-2 py-0.5 ${active ? 'bg-accent text-accent-contrast' : 'hover:bg-surface-2'} disabled:opacity-50`;
  const lockTitle = busy ? 'Encerre as sessões abertas para trocar o modo.' : undefined;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1 text-xs" data-testid="mode-bar">
      <span className="text-muted">Modo</span>
      <div role="radiogroup" aria-label="Modo dos agentes" className="flex gap-1">
        <button role="radio" aria-checked={!o.enabled} className={btn(!o.enabled)} disabled={busy} title={lockTitle} onClick={() => void save({ enabled: false })} data-testid="mode-direct">Lado a lado</button>
        <button role="radio" aria-checked={o.enabled} className={btn(o.enabled)} disabled={busy} title={lockTitle} onClick={() => void save({ enabled: true })} data-testid="mode-orchestrator">Dev Orchestrator</button>
      </div>
      {o.enabled && (
        <>
          <label htmlFor="orch-lead" className="ml-2 text-muted">Orquestrador</label>
          <select id="orch-lead" value={o.lead} disabled={busy} title={lockTitle} onChange={(e) => void save({ lead: e.target.value as AgentId })}
            className="rounded border border-border bg-bg px-1 py-0.5" data-testid="orchestrator-lead">
            {AGENT_IDS.map((a) => <option key={a} value={a}>{AGENT_NAMES[a]} · {modelLabel(lead(a).model)} · esforço {EFFORT_LABEL[lead(a).effort]}</option>)}
          </select>
          <span className="text-muted">Roster e limites em Configurações → Dev Orchestrator.</span>
        </>
      )}
      <SpendBar settings={o} disabled={busy} disabledTitle={busy ? 'Encerre as sessões abertas para trocar o nível.' : undefined} onChange={(p) => void save(p)} />
      {error && <span role="alert" className="text-warn">{error}</span>}
    </div>
  );
}

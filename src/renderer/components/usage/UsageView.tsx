import { useEffect, useState } from 'react';
import { AGENT_NAMES } from '@shared/agents';
import type { ProviderUsage, UsageWindow } from '@shared/usage';
import { useUsageStore } from '../../stores/usageStore';
import { useAgentStore } from '../../stores/agentStore';
import { Button } from '../ui/Modal';

/** "em 2 h 30 min", "em 3 dias" — relativo ao relógio atual. */
export function untilText(iso: string | null, now: number): string {
  if (!iso) return 'reinício não informado';
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'janela já reiniciou (aguardando nova leitura)';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `reinicia em ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `reinicia em ${h} h ${min % 60} min`;
  return `reinicia em ${Math.round(h / 24)} dias`;
}

function ago(iso: string | null, now: number): string {
  if (!iso) return 'nunca';
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

function Bar({ w, now, testId }: { w: UsageWindow; now: number; testId: string }) {
  const tone = w.usedPercent >= 90 ? 'bg-claude' : w.usedPercent >= 70 ? 'bg-warn' : 'bg-accent';
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{w.label}</span>
        <span className="tabular-nums" data-testid={`${testId}-percent`}>{w.usedPercent}% usado</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-surface-2" role="progressbar" aria-label={`${w.label}: ${w.usedPercent}% usado`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.usedPercent}>
        <div className={`h-full ${tone}`} style={{ width: `${w.usedPercent}%` }} />
      </div>
      <span className="text-xs text-muted" title={w.resetsAt ? new Date(w.resetsAt).toLocaleString() : undefined}>
        {untilText(w.resetsAt, now)}{w.resetsAt ? ` · ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
      </span>
    </div>
  );
}

function ProviderCard({ u, now }: { u: ProviderUsage; now: number }) {
  const claudeRunning = useAgentStore((s) => s.sessions.claude?.status === 'running' && s.sessions.claude.kind === 'agent');
  const note = u.provider === 'claude' && u.status === 'no-data' && claudeRunning ? 'Sessão do Claude ativa: aguardando a primeira resposta. Envie uma mensagem no terminal do Claude para os números aparecerem.' : u.note;
  const color = u.provider === 'claude' ? 'text-claude' : 'text-codex';
  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-3" data-testid={`usage-${u.provider}`} data-status={u.status} aria-labelledby={`usage-title-${u.provider}`}>
      <div className="flex items-baseline gap-2">
        <h3 id={`usage-title-${u.provider}`} className={`font-semibold ${color}`}>{AGENT_NAMES[u.provider]}</h3>
        {u.plan && <span className="rounded bg-surface-2 px-1.5 text-xs whitespace-nowrap text-muted">plano {u.plan}</span>}
        <span className="ml-auto text-xs text-muted" data-testid={`usage-${u.provider}-updated`}>{u.updatedAt ? `atualizado ${ago(u.updatedAt, now)}` : ''}</span>
      </div>
      {u.windows.map((w) => <Bar key={w.label} w={w} now={now} testId={`usage-${u.provider}-${w.windowMinutes ?? w.label}`} />)}
      {u.extras.limitReached && <p role="alert" className="text-xs text-warn">Limite atingido ({u.extras.limitReached}). O DevFusion não contorna limites: aguarde o reinício.</p>}
      {u.extras.ordinaryUsageAllowed === false && <p role="alert" className="text-xs text-warn">O provedor informa que o uso incluído no plano não está liberado agora.</p>}
      {(u.extras.resetCreditsAvailable ?? 0) > 0 && (
        <p className="text-xs text-muted" data-testid={`usage-${u.provider}-reset-credits`}>
          {u.extras.resetCreditsAvailable} reset(s) gratuito(s) disponível(is) na sua conta. Use pelo próprio Codex, se quiser: o DevFusion só exibe.
        </p>
      )}
      {note && <p className="text-xs text-muted" data-testid={`usage-${u.provider}-note`}>{note}</p>}
      <p className="text-[11px] text-muted">Fonte: {u.source || '—'}</p>
    </section>
  );
}

export function UsageView() {
  const report = useUsageStore((s) => s.report);
  const refreshing = useUsageStore((s) => s.refreshing);
  const refresh = useUsageStore((s) => s.refresh);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="usage-view">
      <div className="flex items-center">
        <h2 className="text-sm font-semibold">Uso dos planos</h2>
        <Button className="ml-auto" disabled={refreshing} onClick={() => void refresh()} data-testid="usage-refresh">{refreshing ? 'Atualizando…' : 'Atualizar'}</Button>
      </div>
      <p className="text-xs text-muted">Números informados pelas próprias CLIs oficiais, sem estimativas. Nada aqui consome a cota.</p>
      {!report && <p className="text-muted">Carregando…</p>}
      {report && <><ProviderCard u={report.claude} now={now} /><ProviderCard u={report.codex} now={now} /></>}
    </div>
  );
}

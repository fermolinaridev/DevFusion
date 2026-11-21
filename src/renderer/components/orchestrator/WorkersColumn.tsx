import { useEffect, useState } from 'react';
import type { AgentId } from '@shared/agents';
import { AGENT_NAMES } from '@shared/agents';
import { EFFORT_LABEL, TIER_LABEL, modelLabel, type WorkerInfo, type WorkerStatus } from '@shared/orchestrator';
import { useWorkersStore } from '../../stores/workersStore';
import { Button } from '../ui/Modal';

const COLOR: Record<AgentId, string> = { claude: 'text-claude', codex: 'text-codex' };
const STATUS_LABEL: Record<WorkerStatus, string> = { running: 'trabalhando', completed: 'concluído', failed: 'falhou', stopped: 'interrompido' };
const STATUS_CLASS: Record<WorkerStatus, string> = { running: 'text-accent', completed: 'text-fg', failed: 'text-warn', stopped: 'text-muted' };

function elapsed(w: WorkerInfo, now: number): string {
  const ms = (w.endedAt ? Date.parse(w.endedAt) : now) - Date.parse(w.startedAt);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
}

/** Coluna de workers de um provedor (Fase 9). Só exibe o que os eventos oficiais informam. */
export function WorkersColumn({ provider }: { provider: AgentId }) {
  const snapshot = useWorkersStore((s) => s.snapshot);
  const stop = useWorkersStore((s) => s.stop);
  const [now, setNow] = useState(Date.now());
  const workers = snapshot.workers.filter((w) => w.provider === provider);
  const running = workers.filter((w) => w.status === 'running').length;
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const empty = snapshot.lead === 'codex' && provider === 'claude'
    ? 'Com o Codex como orquestrador, workers do Claude ficam desligados (decisão de termos). Troque o orquestrador para o Claude Code para usá-los.'
    : snapshot.lead ? 'Nenhum worker ainda. O orquestrador dispara conforme a tarefa.' : 'Inicie o orquestrador no centro. Os workers aparecem aqui quando ele os disparar.';
  return (
    <section aria-label={`Agentes ${AGENT_NAMES[provider]}`} data-testid={`workers-${provider}`} className="flex h-full flex-col bg-bg">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1">
        <span className={`font-medium ${COLOR[provider]}`}>Agentes {AGENT_NAMES[provider]}</span>
        <span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`workers-count-${provider}`}>{running} trabalhando · {workers.length} no total</span>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {workers.length === 0 && <li className="p-4 text-center text-xs text-muted">{empty}</li>}
        {[...workers].reverse().map((w) => (
          <li key={w.id} className="rounded border border-border bg-surface p-2 text-xs" data-testid={`worker-${w.id}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`font-medium ${STATUS_CLASS[w.status]}`} data-testid="worker-status">{STATUS_LABEL[w.status]}</span>
              {w.tier && <span className="rounded bg-surface-2 px-1.5 py-0.5">{TIER_LABEL[w.tier]}</span>}
              <span className="rounded bg-surface-2 px-1.5 py-0.5" data-testid="worker-model">{modelLabel(w.model)}{w.effort ? ` · esforço ${EFFORT_LABEL[w.effort]}` : ''}</span>
              <span className="ml-auto text-muted">{elapsed(w, now)}</span>
              {w.provider === 'codex' && w.status === 'running' && <Button variant="ghost" className="!px-1.5 !py-0 text-xs" onClick={() => void stop(w.id)} data-testid="worker-stop">Parar</Button>}
            </div>
            {w.task && <p className="mt-1 line-clamp-3 whitespace-pre-wrap" title={w.task} data-testid="worker-task">{w.task}</p>}
            {w.activity && w.status === 'running' && <p className="mt-1 truncate font-mono text-muted" title={w.activity}>{w.activity}</p>}
            {w.cwd && <p className="mt-1 truncate font-mono text-muted" title={w.cwd}>{w.cwd}</p>}
            {w.output && (
              <details className="mt-1">
                <summary className="cursor-pointer text-muted">{w.status === 'failed' ? 'erro' : 'resultado'}{w.tokens ? ` · ${w.tokens.input + w.tokens.output} tokens` : ''}</summary>
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono" data-testid="worker-output">{w.output}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

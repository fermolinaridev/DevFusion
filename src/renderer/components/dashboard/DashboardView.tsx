import { useEffect, useState } from 'react';
import { AGENT_NAMES } from '@shared/agents';
import type { DashboardData } from '@shared/history';
import { unwrap } from '../../lib/ipc';
import { useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { resultOf, useDoctorStore } from '../../stores/doctorStore';
import { useGitStore } from '../../stores/gitStore';
import { useUsageStore } from '../../stores/usageStore';
import { Button } from '../ui/Modal';

const TASK_LABEL: Record<string, string> = { draft: 'rascunho', in_progress: 'em desenvolvimento', in_review: 'em revisão', approved: 'aprovadas', rejected: 'rejeitadas', cancelled: 'canceladas' };

export function DashboardView() {
  const workspace = useAgentStore((s) => s.workspace);
  const sessions = useAgentStore((s) => s.sessions);
  const report = useDoctorStore((s) => s.report);
  const usage = useUsageStore((s) => s.report);
  const tasksLen = useChatStore((s) => s.tasks.length);
  const worktreesLen = useGitStore((s) => s.worktrees.length);
  const setView = useAppStore((s) => s.setView);
  const [data, setData] = useState<DashboardData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void unwrap(window.devfusion.dashboard.get()).then(setData); }, [workspace?.id, tasksLen, worktreesLen]);

  const openRecent = async (id: string) => {
    const r = await unwrap(window.devfusion.workspace.openRecent(id));
    setMsg(r.ok ? null : r.reason);
  };
  const active = Object.values(sessions).filter((s) => s?.status === 'running').length;
  const card = 'rounded border border-border bg-surface p-2';
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="dashboard-view">
      <h2 className="text-sm font-semibold">Dashboard</h2>
      <section className={card} aria-labelledby="d-agents">
        <h3 id="d-agents" className="mb-1 text-xs font-semibold text-muted uppercase">Agentes</h3>
        {(['claude', 'codex'] as const).map((a) => {
          const tool = resultOf(report, a); const auth = resultOf(report, `${a}-auth`);
          const s = sessions[a];
          return <p key={a} className="text-xs" data-testid={`dash-agent-${a}`}><strong>{AGENT_NAMES[a]}</strong> · {tool?.state === 'ok' ? tool.version : 'não instalado'} · conta {auth?.state === 'ok' ? 'ok' : auth?.state === 'unauthenticated' ? 'sem login' : '—'} · {s?.status === 'running' ? 'sessão ativa' : 'sem sessão'}</p>;
        })}
        <p className="text-xs text-muted">{active} sessão(ões) ativa(s) · diagnóstico: {report?.summary.mode === 'full' ? 'completo' : report?.summary.mode === 'individual' ? 'modo individual' : 'modo degradado'}</p>
      </section>
      <section className={card} aria-labelledby="d-usage">
        <h3 id="d-usage" className="mb-1 text-xs font-semibold text-muted uppercase">Uso dos planos</h3>
        {(['claude', 'codex'] as const).map((a) => {
          const u = usage?.[a];
          return <p key={a} className="text-xs" data-testid={`dash-usage-${a}`}><strong>{AGENT_NAMES[a]}</strong>: {u?.status === 'ok' ? u.windows.map((w) => `${w.label} ${w.usedPercent}%`).join(' · ') : 'sem dados'}</p>;
        })}
        <Button variant="ghost" className="!px-0 text-xs" onClick={() => setView('usage')}>Ver detalhes</Button>
      </section>
      {data && workspace && (
        <section className={card} aria-labelledby="d-ws">
          <h3 id="d-ws" className="mb-1 text-xs font-semibold text-muted uppercase">Workspace {workspace.name}</h3>
          <p className="text-xs" data-testid="dash-tasks">Tarefas: {Object.keys(data.tasksByStatus).length ? Object.entries(data.tasksByStatus).map(([k, n]) => `${n} ${TASK_LABEL[k] ?? k}`).join(' · ') : 'nenhuma'}</p>
          <p className="text-xs">Worktrees ativos: {data.worktreesActive} · Git: {workspace.git.isRepo ? workspace.git.branch : 'não é repositório'}</p>
          {data.history && <p className="text-xs text-muted">Histórico: {data.history.messages} mensagem(ns), {data.history.sessions} sessão(ões)</p>}
        </section>
      )}
      <section className={card} aria-labelledby="d-recent">
        <h3 id="d-recent" className="mb-1 text-xs font-semibold text-muted uppercase">Projetos recentes</h3>
        <ul className="flex flex-col gap-1" data-testid="dash-recent">
          {(!data || data.recent.length === 0) && <li className="text-xs text-muted">Nenhum projeto aberto ainda.</li>}
          {data?.recent.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <div className="min-w-0 flex-1"><p className="font-medium">{r.name}{workspace?.id === r.id ? ' (atual)' : ''}</p><p className="truncate font-mono text-[11px] text-muted" title={r.displayPath}>{r.displayPath}</p></div>
              {r.available ? <Button className="!px-2 !py-0.5 text-xs" disabled={workspace?.id === r.id} onClick={() => void openRecent(r.id)} data-testid={`dash-open-${r.name}`}>Abrir</Button>
                : <span className="text-warn">pasta não encontrada</span>}
            </li>
          ))}
        </ul>
        {msg && <p role="alert" className="mt-1 text-xs text-warn">{msg}</p>}
      </section>
    </div>
  );
}

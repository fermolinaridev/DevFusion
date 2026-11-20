import { useEffect, useState } from 'react';
import { AGENT_NAMES, type AgentId } from '@shared/agents';
import type { HistoryOverview, SessionRecord } from '@shared/history';
import type { ChatMessage } from '@shared/orchestration';
import { unwrap } from '../../lib/ipc';
import { useAgentStore } from '../../stores/agentStore';
import { useChatStore } from '../../stores/chatStore';
import { Button } from '../ui/Modal';

const STATE: Record<string, string> = { running: 'ativa', completed: 'encerrada', failed: 'falhou', disconnected: 'desconectada', idle: 'não iniciada' };

export function SessionsView() {
  const workspace = useAgentStore((s) => s.workspace);
  const messagesCount = useChatStore((s) => s.messages.length);
  const [overview, setOverview] = useState<HistoryOverview | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const load = async () => {
    setOverview(await unwrap(window.devfusion.history.overview()));
    setSessions(await unwrap(window.devfusion.history.sessions()));
  };
  useEffect(() => { void load(); }, [workspace?.id, messagesCount]);
  if (!workspace) return <div className="p-4 text-muted">Escolha um workspace.</div>;

  const search = async () => setResults(await unwrap(window.devfusion.history.search(query.trim(), 200)));
  const doExport = async () => {
    const r = await unwrap(window.devfusion.history.exportToFile());
    setMsg(!r.ok ? { kind: 'error', text: r.reason } : r.value ? { kind: 'ok', text: `Exportado para ${r.value}` } : null);
  };
  const doDelete = async () => {
    const r = await unwrap(window.devfusion.history.deleteAll());
    if (!r.ok) { setMsg({ kind: 'error', text: r.reason }); return; }
    if (r.value) { setMsg({ kind: 'ok', text: `Apagados: ${r.value.messages} mensagem(ns), ${r.value.sessions} sessão(ões), ${r.value.tasks} tarefa(s) concluída(s).` }); setResults(null); void load(); }
  };

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="sessions-view">
      <h2 className="text-sm font-semibold">Sessões e histórico</h2>
      {overview && <p className="text-xs text-muted" data-testid="history-overview">{overview.messages} mensagem(ns) · {overview.sessions} sessão(ões) · {overview.tasks} tarefa(s){overview.oldestMessageAt ? ` · desde ${new Date(overview.oldestMessageAt).toLocaleDateString()}` : ''}</p>}
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs" placeholder="Buscar no chat deste workspace" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="history-query" aria-label="Buscar no histórico" />
        <Button type="submit" className="!px-2 !py-0.5 text-xs" data-testid="history-search">Buscar</Button>
      </form>
      {results && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-auto" data-testid="history-results">
          {results.length === 0 && <li className="text-xs text-muted">Nada encontrado.</li>}
          {results.map((m) => (
            <li key={m.id} className="rounded border border-border px-2 py-1 text-xs">
              <span className="text-muted">{new Date(m.createdAt).toLocaleString()} · {m.sender} → {m.recipient}</span>
              <p className="line-clamp-3 whitespace-pre-wrap">{m.content}</p>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="sessions-title">
        <h3 id="sessions-title" className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Sessões de agentes</h3>
        <ul className="flex flex-col gap-0.5 text-xs" data-testid="session-list">
          {sessions.length === 0 && <li className="text-muted">Nenhuma sessão registrada.</li>}
          {sessions.slice(0, 50).map((s) => (
            <li key={s.id} className="flex gap-2"><span className="w-24 shrink-0">{AGENT_NAMES[s.agent as AgentId] ?? s.agent}</span><span className="w-24 shrink-0 text-muted">{STATE[s.state] ?? s.state}</span><span className="text-muted">{new Date(s.createdAt).toLocaleString()}</span></li>
          ))}
        </ul>
      </section>
      <div className="flex gap-1.5">
        <Button onClick={() => void doExport()} data-testid="history-export">Exportar (JSON)…</Button>
        <Button variant="ghost" onClick={() => void doDelete()} data-testid="history-delete">Apagar histórico…</Button>
      </div>
      <p className="text-[11px] text-muted">A retenção automática fica em Configurações. O registro de auditoria nunca é apagado.</p>
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${msg.kind === 'error' ? 'text-warn' : 'text-muted'}`} data-testid="history-msg">{msg.text}</p>}
    </div>
  );
}

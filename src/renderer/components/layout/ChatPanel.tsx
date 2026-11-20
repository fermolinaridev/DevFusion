import { useEffect, useRef, useState } from 'react';
import { AGENT_NAMES, type AgentId } from '@shared/agents';
import type { ChatMessage, ChatTarget } from '@shared/orchestration';
import { useAgentStore } from '../../stores/agentStore';
import { useChatStore } from '../../stores/chatStore';
import { focusTerminal } from '../agents/TerminalView';

const PARTY: Record<string, string> = { user: 'Você', system: 'DevFusion', claude: 'Claude Code', codex: 'Codex', both: 'Claude Code e Codex' };
const KIND_LABEL: Partial<Record<ChatMessage['kind'], string>> = { forward: 'encaminhado', task: 'tarefa', review_request: 'pedido de revisão', correction_request: 'correções' };

function MessageItem({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  if (m.kind === 'event') return <li className="px-3 py-1 text-xs text-muted italic" data-testid="chat-event">{m.content}</li>;
  const long = m.content.length > 400;
  return (
    <li className="border-b border-border px-3 py-2 last:border-b-0" data-testid="chat-message" data-kind={m.kind}>
      <div className="mb-0.5 flex items-center gap-2 text-xs text-muted">
        <span className="font-medium text-fg">{PARTY[m.sender]}</span>
        <span aria-hidden="true">→</span>
        <span>{PARTY[m.recipient]}</span>
        {KIND_LABEL[m.kind] && <span className="rounded bg-surface-2 px-1">{KIND_LABEL[m.kind]}</span>}
        <span className="ml-auto">{new Date(m.createdAt).toLocaleTimeString()}</span>
      </div>
      <pre className="font-sans whitespace-pre-wrap break-words">{long && !open ? `${m.content.slice(0, 400)}…` : m.content}</pre>
      {long && <button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpen(!open)}>{open ? 'Mostrar menos' : 'Mostrar tudo'}</button>}
    </li>
  );
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const send = useChatStore((s) => s.send);
  const workspace = useAgentStore((s) => s.workspace);
  const sessions = useAgentStore((s) => s.sessions);
  const anyRunning = Object.values(sessions).some((x) => x?.status === 'running');
  const stoppingAll = useAgentStore((s) => s.stoppingAll);
  const stopAll = useAgentStore((s) => s.stopAll);
  const [text, setText] = useState('');
  const [to, setTo] = useState<ChatTarget>('claude');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length]);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const sent = text;
    const r = await send(to, sent);
    setBusy(false);
    if (!r.ok) { setFeedback({ kind: 'error', text: r.reason }); return; }
    // Só limpa se o usuário não digitou outra coisa enquanto enviava.
    setText((current) => (current === sent ? '' : current));
    const targets: AgentId[] = to === 'both' ? ['claude', 'codex'] : [to];
    setFeedback({ kind: 'ok', text: `Colado no terminal de ${targets.map((t) => AGENT_NAMES[t]).join(' e ')}. Revise e pressione Enter no terminal para enviar.` });
    focusTerminal(targets[0]!);
  };

  return (
    <section aria-label="Chat compartilhado" className="flex h-full flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-center border-b border-border px-3 font-medium">
        Chat compartilhado
        <span className="ml-2 text-xs font-normal text-muted">modo manual: o texto é colado no terminal e você confirma com Enter</span>
      </div>
      <ul ref={listRef} className="min-h-0 flex-1 overflow-auto" data-testid="chat-list">
        {messages.length === 0 && <li className="p-3 text-muted" data-testid="chat-empty">Nenhuma mensagem.</li>}
        {messages.map((m) => <MessageItem key={m.id} m={m} />)}
      </ul>
      {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`border-t border-border px-3 py-1 text-xs ${feedback.kind === 'error' ? 'text-warn' : 'text-muted'}`} data-testid="chat-feedback">{feedback.text}</p>}
      <form className="flex shrink-0 gap-2 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="sr-only" htmlFor="chat-input">Mensagem</label>
        <textarea id="chat-input" rows={2} value={text} disabled={!workspace}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          placeholder={workspace ? 'Mensagem para os agentes (Ctrl/⌘+Enter para colar no terminal)' : 'Escolha um workspace para usar o chat.'}
          className="min-h-0 flex-1 resize-none rounded border border-border bg-bg px-2 py-1 disabled:opacity-60" data-testid="chat-input" />
        <label className="sr-only" htmlFor="chat-target">Destino</label>
        <select id="chat-target" value={to} onChange={(e) => setTo(e.target.value as ChatTarget)} disabled={!workspace}
          className="rounded border border-border bg-bg px-2 disabled:opacity-60" data-testid="chat-target">
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="both">Ambos</option>
        </select>
        <button type="submit" disabled={!workspace || !text.trim() || busy} className="rounded bg-accent px-3 text-accent-contrast disabled:opacity-50" data-testid="chat-send"
          title="Cola a mensagem no terminal do destino; nada é enviado sem o seu Enter no terminal">Colar no terminal</button>
        <button type="button" disabled={!anyRunning || stoppingAll} onClick={() => void stopAll()} data-testid="stop-all"
          className="rounded border border-border px-3 hover:bg-surface-2 disabled:opacity-50" title={anyRunning ? 'Encerra todos os processos de agentes' : 'Nenhum processo de agente em execução'}>
          {stoppingAll ? 'Parando…' : 'Parar tudo'}
        </button>
      </form>
    </section>
  );
}

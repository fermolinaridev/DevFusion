import { useAgentStore } from '../../stores/agentStore';

export function ChatPanel() {
  const reason = 'O chat compartilhado e o encaminhamento entre agentes chegam na Fase 4. Por enquanto use os terminais.';
  const anyRunning = useAgentStore((s) => Object.values(s.sessions).some((x) => x?.status === 'running'));
  const stoppingAll = useAgentStore((s) => s.stoppingAll);
  const stopAll = useAgentStore((s) => s.stopAll);
  return (
    <section aria-label="Chat compartilhado" className="flex h-full flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-center border-b border-border px-3 font-medium">Chat compartilhado</div>
      <div className="flex-1 overflow-auto p-3 text-muted" data-testid="chat-empty">Nenhuma mensagem.</div>
      <form className="flex shrink-0 gap-2 border-t border-border p-2" onSubmit={(e) => e.preventDefault()} title={reason}>
        <label className="sr-only" htmlFor="chat-input">Mensagem</label>
        <textarea id="chat-input" disabled rows={2} placeholder={reason} className="min-h-0 flex-1 resize-none rounded border border-border bg-bg px-2 py-1 disabled:opacity-60" />
        <label className="sr-only" htmlFor="chat-target">Destino</label>
        <select id="chat-target" disabled className="rounded border border-border bg-bg px-2 disabled:opacity-60">
          <option>Destino</option>
        </select>
        <button type="submit" disabled className="rounded bg-accent px-3 text-accent-contrast disabled:opacity-50">Enviar</button>
        <button type="button" disabled={!anyRunning || stoppingAll} onClick={() => void stopAll()} data-testid="stop-all"
          className="rounded border border-border px-3 hover:bg-surface-2 disabled:opacity-50" title={anyRunning ? 'Encerra todos os processos de agentes' : 'Nenhum processo de agente em execução'}>
          {stoppingAll ? 'Parando…' : 'Parar tudo'}
        </button>
      </form>
    </section>
  );
}

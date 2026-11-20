export function ChatPanel() {
  const reason = 'Disponível quando os terminais dos agentes existirem (Fases 3 e 4).';
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
        <button type="button" disabled className="rounded border border-border px-3 disabled:opacity-50" title="Nenhum processo de agente em execução">Parar tudo</button>
      </form>
    </section>
  );
}

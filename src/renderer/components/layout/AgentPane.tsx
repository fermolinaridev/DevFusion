const AGENTS = {
  claude: { name: 'Claude Code', color: 'text-claude' },
  codex: { name: 'Codex', color: 'text-codex' },
} as const;

export function AgentPane({ agent }: { agent: keyof typeof AGENTS }) {
  const a = AGENTS[agent];
  return (
    <section aria-label={a.name} data-testid={`agent-pane-${agent}`} className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className={`font-medium ${a.color}`}>{a.name}</span>
        <span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-status-${agent}`}>
          sessão não iniciada
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-muted">
        <p className="max-w-xs">
          O terminal integrado com a CLI oficial chega na Fase 3. O login continuará sendo feito por você, dentro da própria CLI.
        </p>
      </div>
    </section>
  );
}

import { resultOf, useDoctorStore } from '../../stores/doctorStore';

const AGENTS = {
  claude: { name: 'Claude Code', color: 'text-claude' },
  codex: { name: 'Codex', color: 'text-codex' },
} as const;

export function AgentPane({ agent }: { agent: keyof typeof AGENTS }) {
  const a = AGENTS[agent];
  const report = useDoctorStore((s) => s.report);
  const tool = resultOf(report, agent);
  const auth = resultOf(report, `${agent}-auth`);
  const status = !tool ? 'verificando…'
    : tool.state === 'missing' ? 'não instalado'
    : tool.state !== 'ok' ? 'CLI com problema'
    : auth?.state === 'ok' ? 'pronto · sessão não iniciada'
    : auth?.state === 'unauthenticated' ? 'não autenticado'
    : 'conta não verificada';
  return (
    <section aria-label={a.name} data-testid={`agent-pane-${agent}`} className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className={`font-medium ${a.color}`}>{a.name}</span>
        {tool?.version && <span className="truncate text-xs text-muted">{tool.version}</span>}
        <span className="ml-auto shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-status-${agent}`}>{status}</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-muted">
        <p className="max-w-xs">
          O terminal integrado com a CLI oficial chega na Fase 3. O login continuará sendo feito por você, dentro da própria CLI.
        </p>
      </div>
    </section>
  );
}

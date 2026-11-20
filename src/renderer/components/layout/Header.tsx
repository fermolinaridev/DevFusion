import { useDoctorStore } from '../../stores/doctorStore';

export function Header() {
  const report = useDoctorStore((s) => s.report);
  const ready = report?.summary.readyAgents.length ?? 0;
  const summary = !report || (report.running && report.results.length === 0) ? 'verificando…' : `${ready} de 2 prontos`;
  return (
    <header className="flex h-10 shrink-0 items-center gap-4 border-b border-border bg-surface px-3">
      <span className="font-semibold tracking-tight">DevFusion</span>
      <span className="text-muted">
        Workspace: <span className="text-fg" data-testid="workspace-name">nenhum selecionado</span>
      </span>
      <span className="ml-auto text-muted" data-testid="agents-summary">Agentes: {summary}</span>
    </header>
  );
}

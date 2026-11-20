import { useAppStore } from '../../stores/appStore';
import { useDoctorStore } from '../../stores/doctorStore';

/** Aviso persistente quando o diagnóstico encontra bloqueios ou modo degradado/individual. */
export function DoctorBanner() {
  const report = useDoctorStore((s) => s.report);
  const setView = useAppStore((s) => s.setView);
  if (!report || report.running || report.results.length === 0) return null;
  const { mode, blockingIssues, readyAgents } = report.summary;
  if (mode === 'full' && blockingIssues === 0) return null;
  const names = { claude: 'Claude Code', codex: 'Codex' } as const;
  const text = blockingIssues > 0
    ? `${blockingIssues} problema(s) no sistema impedem o funcionamento normal.`
    : mode === 'individual'
      ? `Modo individual: apenas ${names[readyAgents[0]!]} está pronto.`
      : 'Modo degradado: nenhum agente está pronto.';
  return (
    <div role="status" data-testid="doctor-banner" className="flex items-center gap-3 border-b border-border bg-surface-2 px-3 py-1.5">
      <span className="text-warn" aria-hidden="true">!</span>
      <span>{text}</span>
      <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setView('agents')}>Abrir System Doctor</button>
    </div>
  );
}

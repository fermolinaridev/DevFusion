import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { useDoctorStore } from '../../stores/doctorStore';

const PLATFORM_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', other: 'Outro' } as const;

export function StatusBar() {
  const info = useAppStore((s) => s.info);
  const report = useDoctorStore((s) => s.report);
  const workspace = useAgentStore((s) => s.workspace);
  const active = useAgentStore((s) => Object.values(s.sessions).filter((x) => x?.status === 'running').length);
  const git = !workspace ? '—' : workspace.git.isRepo ? workspace.git.branch ?? '—' : 'não é repositório';
  const problems = report?.results.filter((r) => r.requirement !== 'optional' && r.state !== 'ok').length ?? 0;
  const diag = !report || report.results.length === 0 ? 'não executado' : report.running ? 'verificando…' : problems === 0 ? 'tudo certo' : `${problems} item(ns) com atenção`;
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-surface px-3 text-xs text-muted" data-testid="status-bar">
      <span data-testid="status-git">Git: {git}</span>
      <span data-testid="status-sessions">Sessões ativas: {active}</span>
      <span data-testid="status-doctor">Diagnóstico: {diag}</span>
      {info && (
        <span className="ml-auto" data-testid="status-db">
          DevFusion {info.appVersion} · {PLATFORM_LABEL[info.platform]} {info.arch} · Banco v{info.database.schemaVersion} (SQLite {info.database.sqliteVersion})
        </span>
      )}
    </footer>
  );
}

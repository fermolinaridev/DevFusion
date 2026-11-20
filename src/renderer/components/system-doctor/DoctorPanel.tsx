import { useState } from 'react';
import type { CheckGroup, InstallableDependency } from '@shared/doctor';
import { ON_DEMAND_CHECKS } from '@shared/doctor';
import { useDoctorStore } from '../../stores/doctorStore';
import { Button } from '../ui/Modal';
import { CheckRow } from './CheckRow';
import { InstallDialog } from './InstallDialog';
import { LoginHelpDialog } from './LoginHelpDialog';

const GROUPS: Array<{ id: CheckGroup; title: string }> = [
  { id: 'agents', title: 'Agentes' },
  { id: 'accounts', title: 'Contas' },
  { id: 'network', title: 'Rede' },
  { id: 'system', title: 'Sistema' },
  { id: 'tools', title: 'Ferramentas' },
];

export function DoctorPanel({ compact = false }: { compact?: boolean }) {
  const report = useDoctorStore((s) => s.report);
  const run = useDoctorStore((s) => s.run);
  const [installDep, setInstallDep] = useState<InstallableDependency | null>(null);
  const [loginAgent, setLoginAgent] = useState<'claude' | 'codex' | null>(null);
  const running = report?.running ?? true;
  const hasResults = (report?.results.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3" data-testid="doctor-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted" aria-live="polite" data-testid="doctor-status">
          {running ? 'Verificando o ambiente…' : report?.finishedAt ? `Última verificação: ${new Date(report.finishedAt).toLocaleTimeString()}` : 'Ainda não verificado.'}
        </span>
        <span className="ml-auto flex gap-2">
          <Button onClick={() => void run(ON_DEMAND_CHECKS as never)} disabled={running}>{compact ? 'Python/Docker' : 'Verificar Python/Docker'}</Button>
          <Button variant="primary" onClick={() => void run()} disabled={running} data-testid="doctor-rerun" title="Revalidar tudo">{compact ? 'Revalidar' : 'Revalidar tudo'}</Button>
        </span>
      </div>
      {!hasResults && running && <p className="text-muted">Executando verificações…</p>}
      {GROUPS.map((g) => {
        const items = report?.results.filter((r) => r.group === g.id) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`grp-${g.id}`}>
            <h3 id={`grp-${g.id}`} className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</h3>
            <ul className="rounded border border-border bg-surface">
              {items.map((r) => <CheckRow key={r.id} result={r} compact={compact} running={running} onInstall={setInstallDep} onLogin={setLoginAgent} />)}
            </ul>
          </section>
        );
      })}
      <InstallDialog dependency={installDep} onClose={() => setInstallDep(null)} />
      <LoginHelpDialog agent={loginAgent} onClose={() => setLoginAgent(null)} />
    </div>
  );
}

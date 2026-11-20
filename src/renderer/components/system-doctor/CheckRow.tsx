import type { CheckResult } from '@shared/doctor';
import { useAppStore } from '../../stores/appStore';
import { useDoctorStore } from '../../stores/doctorStore';
import { Button } from '../ui/Modal';
import { StateBadge } from './StateBadge';

export function CheckRow({ result, compact, onInstall, onLogin, running }: {
  result: CheckResult;
  compact?: boolean;
  running: boolean;
  onInstall: (dep: Extract<CheckResult['action'], { kind: 'install' }>['dependency']) => void;
  onLogin: (agent: 'claude' | 'codex') => void;
}) {
  const run = useDoctorStore((s) => s.run);
  const openDocs = useDoctorStore((s) => s.openDocs);
  const setView = useAppStore((s) => s.setView);
  const a = result.action;
  return (
    <li className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0" data-testid={`check-${result.id}`} data-state={result.state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateBadge state={result.state} compact={compact} />
        <span className="font-medium">{result.label}</span>
        {result.version && <span className="text-muted">{result.version}</span>}
        <span className="ml-auto flex gap-2">
          {a.kind === 'install' && <Button onClick={() => onInstall(a.dependency)} data-testid={`install-${a.dependency}`}>Instalar…</Button>}
          {a.kind === 'login' && <Button onClick={() => onLogin(a.agent)} data-testid={`login-${a.agent}`}>Como fazer login</Button>}
          {a.kind === 'open-docs' && <Button onClick={() => void openDocs(a.docId)}>Ver instruções</Button>}
          {a.kind === 'configure-path' && <Button onClick={() => setView('settings')}>Configurar caminho</Button>}
          {a.kind !== 'none' && <Button variant="ghost" disabled={running} onClick={() => void run([result.id])}>Revalidar</Button>}
        </span>
      </div>
      <p className="text-muted" data-testid={`check-detail-${result.id}`}>{result.detail}</p>
      {!compact && result.path && <p className="font-mono text-xs text-muted">{result.path}</p>}
    </li>
  );
}

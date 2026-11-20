import { DoctorPanel } from '../components/system-doctor/DoctorPanel';
import { Button } from '../components/ui/Modal';
import { useAppStore } from '../stores/appStore';
import { useDoctorStore } from '../stores/doctorStore';

const CONTINUE_LABEL = {
  full: 'Continuar',
  individual: 'Continuar com um agente (modo individual)',
  degraded: 'Continuar em modo degradado',
} as const;

export function Onboarding() {
  const report = useDoctorStore((s) => s.report);
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const running = report?.running ?? true;
  const mode = report?.summary.mode ?? 'degraded';
  const ready = report?.summary.readyAgents ?? [];
  const names = { claude: 'Claude Code', codex: 'Codex' } as const;

  return (
    <main className="flex h-full flex-col bg-bg" data-testid="onboarding">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-auto px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Bem-vindo ao DevFusion</h1>
          <p className="text-muted">
            Antes de abrir os agentes, o System Doctor verifica seu ambiente. Nada é instalado sem a sua autorização, e o login é feito sempre pelo fluxo oficial de cada CLI.
          </p>
        </header>
        <DoctorPanel />
      </div>
      <footer className="flex items-center gap-3 border-t border-border bg-surface px-6 py-3">
        <span className="text-muted" data-testid="onboarding-summary">
          {running ? 'Aguardando o diagnóstico…'
            : ready.length === 2 ? 'Os dois agentes estão prontos.'
            : ready.length === 1 ? `Pronto: ${names[ready[0]!]}. Você pode continuar com um agente e configurar o outro depois.`
            : 'Nenhum agente pronto. Você pode continuar para configurar depois; os agentes ficarão indisponíveis.'}
        </span>
        <Button variant="primary" className="ml-auto" disabled={running} onClick={() => void completeOnboarding()} data-testid="onboarding-continue">
          {CONTINUE_LABEL[mode]}
        </Button>
      </footer>
    </main>
  );
}

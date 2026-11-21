import { useEffect, useRef } from 'react';
import type { InstallableDependency } from '@shared/doctor';
import { useDoctorStore } from '../../stores/doctorStore';
import { Button, Modal } from '../ui/Modal';

const NAMES: Record<InstallableDependency, string> = { claude: 'Claude Code', codex: 'Codex', git: 'Git', node: 'Node.js', 'ai-memory': 'ai-memory' };

export function InstallDialog({ dependency, onClose }: { dependency: InstallableDependency | null; onClose: () => void }) {
  const { methods, loadMethods, startInstall, cancelInstall, openSource, install } = useDoctorStore();
  const list = dependency ? methods[dependency] : undefined;
  const outRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (dependency) void loadMethods(dependency); }, [dependency, loadMethods]);
  useEffect(() => { outRef.current?.scrollTo({ top: outRef.current.scrollHeight }); }, [install?.output]);

  const active = install && install.dependency === dependency && install.status !== 'idle' ? install : null;
  const busy = active?.status === 'running' || active?.status === 'awaiting-consent';

  return (
    <Modal
      title={dependency ? `Instalar ${NAMES[dependency]}` : ''}
      open={dependency !== null}
      onClose={() => { if (!busy) onClose(); }}
      testId="install-dialog"
      footer={busy
        ? <Button onClick={() => void cancelInstall()} disabled={active?.status !== 'running'} data-testid="install-cancel">Cancelar instalação</Button>
        : <Button onClick={onClose}>Fechar</Button>}
    >
      <p className="mb-3 text-muted">
        Somente métodos oficiais documentados. O DevFusion executa apenas gerenciadores de pacotes com comando fixo, após sua confirmação em um diálogo do sistema. Scripts da internet nunca são executados automaticamente.
      </p>
      {!list && <p className="text-muted">Carregando métodos…</p>}
      {list?.length === 0 && <p>Nenhum método oficial disponível para esta plataforma.</p>}
      <ul className="flex flex-col gap-3">
        {list?.map((m) => (
          <li key={m.id} className="rounded border border-border p-3" data-testid={`method-${m.id}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{m.title}</span>
              <span className="rounded bg-surface-2 px-1.5 text-xs text-muted">{m.automatic ? 'executável pelo app' : 'somente instrução'}</span>
              <span className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => void openSource(m.id)}>Página oficial</Button>
                {m.automatic && (
                  <Button variant="primary" disabled={!m.available || busy} onClick={() => void startInstall(m.id)} data-testid={`run-${m.id}`}>Instalar</Button>
                )}
              </span>
            </div>
            {m.commandDisplay && <pre className="mt-2 overflow-x-auto rounded bg-bg px-2 py-1 font-mono text-xs">{m.commandDisplay}</pre>}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Origem</dt><dd className="break-all">{m.sourceUrl}</dd>
              <dt className="text-muted">Permissões</dt><dd>{m.permissions}</dd>
              <dt className="text-muted">Versão</dt><dd>{m.versionNote}</dd>
            </dl>
            {m.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {!m.available && m.unavailableReason && <p className="mt-1 text-xs text-warn">Indisponível: {m.unavailableReason}</p>}
          </li>
        ))}
      </ul>
      {active && (
        <section className="mt-4" aria-live="polite" data-testid="install-status" data-status={active.status}>
          <h3 className="mb-1 font-medium">
            {{ 'awaiting-consent': 'Aguardando sua confirmação no diálogo do sistema…', running: 'Instalando…', succeeded: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado', declined: 'Não autorizado', idle: '' }[active.status]}
          </h3>
          {active.message && <p className="mb-2 text-muted" data-testid="install-message">{active.message}</p>}
          {active.output && <pre ref={outRef} className="max-h-56 overflow-auto rounded bg-bg p-2 font-mono text-xs whitespace-pre-wrap" data-testid="install-output">{active.output}</pre>}
        </section>
      )}
    </Modal>
  );
}

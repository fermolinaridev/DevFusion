import { useDoctorStore } from '../../stores/doctorStore';
import { Button, Modal } from '../ui/Modal';

const INFO = {
  claude: { name: 'Claude Code', command: 'claude auth login', docId: 'claude-auth' as const, check: 'claude-auth' as const },
  codex: { name: 'Codex', command: 'codex login', docId: 'codex-auth' as const, check: 'codex-auth' as const },
};

export function LoginHelpDialog({ agent, onClose }: { agent: 'claude' | 'codex' | null; onClose: () => void }) {
  const run = useDoctorStore((s) => s.run);
  const openDocs = useDoctorStore((s) => s.openDocs);
  const i = agent ? INFO[agent] : null;
  return (
    <Modal
      title={i ? `Login no ${i.name}` : ''}
      open={agent !== null}
      onClose={onClose}
      testId="login-dialog"
      footer={<>
        {i && <Button variant="ghost" onClick={() => void openDocs(i.docId)}>Documentação oficial</Button>}
        {i && <Button variant="primary" onClick={() => { void run([i.check]); onClose(); }}>Já fiz login — revalidar</Button>}
      </>}
    >
      {i && (
        <div className="flex flex-col gap-3">
          <p>O login é feito pelo fluxo oficial da própria CLI, com a sua assinatura. O DevFusion não vê nem guarda senhas ou tokens.</p>
          <p>Rode no terminal:</p>
          <pre className="rounded bg-bg px-2 py-1 font-mono">{i.command}</pre>
          <p className="text-muted">O navegador abrirá a página oficial de login. Depois volte aqui e clique em revalidar. A partir da Fase 3 esse passo acontecerá no terminal integrado do próprio DevFusion.</p>
        </div>
      )}
    </Modal>
  );
}

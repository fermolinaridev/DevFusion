import { useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';
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
  const inMainLayout = useAppStore((s) => s.settings.onboardingCompleted);
  const startAgent = useAgentStore((s) => s.start);
  return (
    <Modal
      title={i ? `Login no ${i.name}` : ''}
      open={agent !== null}
      onClose={onClose}
      testId="login-dialog"
      footer={<>
        {i && <Button variant="ghost" onClick={() => void openDocs(i.docId)}>Documentação oficial</Button>}
        {i && <Button onClick={() => { void run([i.check]); onClose(); }}>Já fiz login — revalidar</Button>}
        {i && agent && inMainLayout && <Button variant="primary" onClick={() => { void startAgent(agent, 'login'); onClose(); }} data-testid="login-in-app">Fazer login no terminal do DevFusion</Button>}
      </>}
    >
      {i && (
        <div className="flex flex-col gap-3">
          <p>O login é feito pelo fluxo oficial da própria CLI, com a sua assinatura. O DevFusion não vê nem guarda senhas ou tokens.</p>
          <p>{inMainLayout ? 'Use o botão abaixo para rodar o comando oficial no terminal integrado, ou rode no seu terminal:' : 'Rode no terminal (ou conclua esta etapa e use “Fazer login” no painel do agente):'}</p>
          <pre className="rounded bg-bg px-2 py-1 font-mono">{i.command}</pre>
          <p className="text-muted">O navegador abrirá a página oficial de login. Quando o comando terminar no terminal integrado, a conta é revalidada automaticamente.</p>
        </div>
      )}
    </Modal>
  );
}

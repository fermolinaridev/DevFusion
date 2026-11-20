import type { AgentId, AgentSessionInfo } from '@shared/agents';
import { AGENT_NAMES } from '@shared/agents';
import { isRunning, useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';
import { resultOf, useDoctorStore } from '../../stores/doctorStore';
import { TerminalView } from '../agents/TerminalView';
import { Button } from '../ui/Modal';

const COLOR: Record<AgentId, string> = { claude: 'text-claude', codex: 'text-codex' };

/** Rótulo do estado: só fatos (processo vivo, código de saída, falha ao iniciar). */
function statusLabel(info: AgentSessionInfo | undefined, installed: boolean | null, auth: string | undefined): string {
  if (info?.stopping) return 'encerrando…';
  if (info?.status === 'running') return info.kind === 'login' ? 'login em andamento' : 'sessão ativa';
  if (info?.status === 'completed') return info.kind === 'login' ? 'login encerrado' : `sessão encerrada (código ${info.exitCode ?? '—'})`;
  if (info?.status === 'failed') return info.exitCode !== null ? `processo falhou (código ${info.exitCode})` : 'falha ao iniciar';
  if (installed === null) return 'verificando…';
  if (!installed) return 'não instalado';
  if (auth === 'ok') return 'pronto · sessão não iniciada';
  if (auth === 'unauthenticated') return 'não autenticado';
  return 'conta não verificada';
}

export function AgentPane({ agent }: { agent: AgentId }) {
  const report = useDoctorStore((s) => s.report);
  const info = useAgentStore((s) => s.sessions[agent]);
  const error = useAgentStore((s) => s.errors[agent]);
  const workspace = useAgentStore((s) => s.workspace);
  const { start, interrupt, stop, chooseWorkspace } = useAgentStore();
  const theme = useAppStore((s) => s.settings.theme);
  const tool = resultOf(report, agent);
  const auth = resultOf(report, `${agent}-auth`)?.state;
  const installed = tool ? tool.state === 'ok' : null;
  const running = isRunning(info);
  const status = statusLabel(info, installed, auth);
  const showTerminal = Boolean(info?.sessionId);

  return (
    <section aria-label={AGENT_NAMES[agent]} data-testid={`agent-pane-${agent}`} className="flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className={`font-medium ${COLOR[agent]}`}>{AGENT_NAMES[agent]}</span>
        {tool?.version && <span className="truncate text-xs text-muted">{tool.version}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-status-${agent}`} title={info?.capabilities.automationNote}>{status}</span>
          {running ? (
            <>
              {/* Chaves distintas: o botão focado em "Iniciar" não pode virar "Encerrar" sob o cursor/teclado. */}
              <Button key="interrupt" className="!px-2 !py-0.5 text-xs" onClick={() => void interrupt(agent)} title="Envia Ctrl+C ao processo" data-testid={`interrupt-${agent}`}>Interromper</Button>
              <Button key="stop" className="!px-2 !py-0.5 text-xs" disabled={info?.stopping} onClick={() => void stop(agent)} data-testid={`stop-${agent}`}>Encerrar</Button>
            </>
          ) : (
            <>
              <Button key="login" className="!px-2 !py-0.5 text-xs" disabled={!installed} onClick={() => void start(agent, 'login')} data-testid={`login-start-${agent}`} title="Executa o comando oficial de login da CLI neste terminal">Fazer login</Button>
              <Button key="start" variant="primary" className="!px-2 !py-0.5 text-xs" disabled={!installed || !workspace} onClick={() => void start(agent, 'agent')} data-testid={`start-${agent}`}>Iniciar</Button>
            </>
          )}
        </span>
      </div>
      {error && <p role="alert" className="border-b border-border bg-surface-2 px-3 py-1 text-xs text-warn" data-testid={`agent-error-${agent}`}>{error}</p>}
      <div className="relative min-h-0 flex-1">
        <TerminalView agent={agent} sessionId={info?.sessionId ?? null} themeKey={theme} />
        {!showTerminal && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg p-6 text-center text-muted">
            <div className="flex max-w-sm flex-col items-center gap-3">
              {installed === false && <p>{AGENT_NAMES[agent]} não está instalado. Use o System Doctor para instalar.</p>}
              {installed && !workspace && (
                <>
                  <p>Escolha a pasta do projeto para abrir {AGENT_NAMES[agent]} nela.</p>
                  <Button onClick={() => void chooseWorkspace()}>Escolher workspace…</Button>
                </>
              )}
              {installed && workspace && auth === 'unauthenticated' && <p>Você ainda não fez login. Clique em “Fazer login”: o comando oficial da CLI roda aqui e abre o navegador.</p>}
              {installed && workspace && auth !== 'unauthenticated' && <p>Clique em “Iniciar” para abrir a CLI oficial em <span className="font-mono">{workspace.displayPath}</span>.</p>}
              <p className="text-xs">{info?.capabilities.automationNote}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

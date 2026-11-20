import { useState } from 'react';
import type { AgentId, AgentSessionInfo } from '@shared/agents';
import { forwardHeader, type PermissionPreset } from '@shared/orchestration';
import { AGENT_NAMES } from '@shared/agents';
import { isRunning, useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';
import { resultOf, useDoctorStore } from '../../stores/doctorStore';
import { useChatStore } from '../../stores/chatStore';
import { TerminalView, terminalSelection } from '../agents/TerminalView';
import { OutboundDialog, type OutboundDraft } from '../chat/OutboundDialog';
import { Button } from '../ui/Modal';

const COLOR: Record<AgentId, string> = { claude: 'text-claude', codex: 'text-codex' };
const OTHER: Record<AgentId, AgentId> = { claude: 'codex', codex: 'claude' };
const PERMISSION_LABEL: Record<PermissionPreset, string> = { 'cli-default': 'Permissões: padrão da CLI', 'read-only': 'Permissões: somente leitura' };
const PERMISSION_HELP: Record<AgentId, string> = {
  claude: 'Somente leitura inicia com --permission-mode plan (planejamento, sem editar). Padrão da CLI usa suas configurações do Claude Code.',
  codex: 'Somente leitura inicia com --sandbox read-only --ask-for-approval on-request. Padrão da CLI usa suas configurações do Codex.',
};

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
  const { start, interrupt, stop, chooseWorkspace, setPermission } = useAgentStore();
  const permission = useAgentStore((s) => s.permission[agent]);
  const hasSelection = useAgentStore((s) => s.hasSelection[agent] ?? false);
  const forward = useChatStore((s) => s.forward);
  const [draft, setDraft] = useState<OutboundDraft | null>(null);
  const theme = useAppStore((s) => s.settings.theme);
  const tool = resultOf(report, agent);
  const auth = resultOf(report, `${agent}-auth`)?.state;
  const installed = tool ? tool.state === 'ok' : null;
  const running = isRunning(info);
  const status = statusLabel(info, installed, auth);
  const showTerminal = Boolean(info?.sessionId);
  const other = OTHER[agent];
  const openForward = () => {
    const content = terminalSelection(agent).trim();
    if (!content) return;
    setDraft({
      title: `Encaminhar seleção de ${AGENT_NAMES[agent]} para ${AGENT_NAMES[other]}`,
      target: other, content, warnings: [], prefix: forwardHeader(AGENT_NAMES[agent]),
      confirm: async (text) => { const r = await forward(agent, other, text); return r.ok ? { ok: true } : r; },
    });
  };

  return (
    <section aria-label={AGENT_NAMES[agent]} data-testid={`agent-pane-${agent}`} className="flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className={`shrink-0 font-medium whitespace-nowrap ${COLOR[agent]}`}>{AGENT_NAMES[agent]}</span>
        {tool?.version && <span className="min-w-0 truncate text-xs text-muted" title={tool.version}>{tool.version}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-status-${agent}`} title={info?.capabilities.automationNote}>{status}</span>
          {running && info?.kind === 'agent' && info.permission === 'read-only' && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-permission-${agent}`}>somente leitura</span>}
          {running && (
            <Button key="forward" className="!px-2 !py-0.5 text-xs" disabled={!hasSelection} onClick={openForward} data-testid={`forward-${agent}`}
              title={hasSelection ? `Encaminhar o texto selecionado para ${AGENT_NAMES[other]}` : 'Selecione texto no terminal para encaminhar'}>Encaminhar →</Button>
          )}
          {running ? (
            <>
              {/* Chaves distintas: o botão focado em "Iniciar" não pode virar "Encerrar" sob o cursor/teclado. */}
              <Button key="interrupt" className="!px-2 !py-0.5 text-xs" onClick={() => void interrupt(agent)} title="Envia Ctrl+C ao processo" data-testid={`interrupt-${agent}`}>Interromper</Button>
              <Button key="stop" className="!px-2 !py-0.5 text-xs" disabled={info?.stopping} onClick={() => void stop(agent)} data-testid={`stop-${agent}`}>Encerrar</Button>
            </>
          ) : (
            <>
              <label className="sr-only" htmlFor={`perm-${agent}`}>Permissões</label>
              <select key="perm" id={`perm-${agent}`} value={permission} onChange={(e) => setPermission(agent, e.target.value as PermissionPreset)}
                className="rounded border border-border bg-bg px-1 py-0.5 text-xs" title={PERMISSION_HELP[agent]} data-testid={`permission-${agent}`}>
                {(Object.keys(PERMISSION_LABEL) as PermissionPreset[]).map((p) => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
              </select>
              <Button key="login" className="!px-2 !py-0.5 text-xs" disabled={!installed} onClick={() => void start(agent, 'login')} data-testid={`login-start-${agent}`} title="Executa o comando oficial de login da CLI neste terminal">Fazer login</Button>
              <Button key="start" variant="primary" className="!px-2 !py-0.5 text-xs" disabled={!installed || !workspace} onClick={() => void start(agent, 'agent')} data-testid={`start-${agent}`}>Iniciar</Button>
            </>
          )}
        </span>
      </div>
      <OutboundDialog draft={draft} onClose={() => setDraft(null)} />
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

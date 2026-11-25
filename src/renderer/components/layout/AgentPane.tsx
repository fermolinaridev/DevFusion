import { useMemo, useState } from 'react';
import type { AgentId, AgentSessionInfo } from '@shared/agents';
import { forwardHeader, type PermissionPreset } from '@shared/orchestration';
import { AGENT_NAMES } from '@shared/agents';
import { isRunning, useAgentStore } from '../../stores/agentStore';
import { useAppStore } from '../../stores/appStore';
import { resultOf, useDoctorStore } from '../../stores/doctorStore';
import { useChatStore } from '../../stores/chatStore';
import { useGitStore } from '../../stores/gitStore';
import { TerminalView, terminalSelection } from '../agents/TerminalView';
import { OutboundDialog, type OutboundDraft } from '../chat/OutboundDialog';
import { Button } from '../ui/Modal';
import { EFFORT_LABEL, modelLabel } from '@shared/orchestrator';
import { resolveSpend } from '@shared/spend';

const COLOR: Record<AgentId, string> = { claude: 'text-claude', codex: 'text-codex' };
const OTHER: Record<AgentId, AgentId> = { claude: 'codex', codex: 'claude' };
const IS_MAC = navigator.userAgent.includes('Mac');
const SELECT_HINT = `Selecione texto no terminal para encaminhar. Se a CLI capturar o mouse (ex.: Codex), segure ${IS_MAC ? '⌥ Option' : 'Shift'} enquanto seleciona.`;
const PERMISSION_LABEL: Record<PermissionPreset, string> = { 'cli-default': 'padrão da CLI', 'read-only': 'somente leitura' };
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

/** `orchestrator`: painel central do Dev Orchestrator (Fase 9) — a CLI inicia no papel de gerente. */
export function AgentPane({ agent, orchestrator = false }: { agent: AgentId; orchestrator?: boolean }) {
  const orchSettings = useAppStore((s) => s.settings.orchestrator);
  const orch = useMemo(() => resolveSpend(orchSettings), [orchSettings]);
  const leadSlot = agent === 'claude' ? orch.leadClaude : orch.leadCodex;
  const report = useDoctorStore((s) => s.report);
  const info = useAgentStore((s) => s.sessions[agent]);
  const error = useAgentStore((s) => s.errors[agent]);
  const workspace = useAgentStore((s) => s.workspace);
  const { start, interrupt, stop, chooseWorkspace, setPermission } = useAgentStore();
  const permission = useAgentStore((s) => s.permission[agent]);
  const locationId = useAgentStore((s) => s.location[agent]);
  const setLocation = useAgentStore((s) => s.setLocation);
  // Seleciona o array estável e filtra fora do seletor (Zustand 5 exige referências estáveis).
  const allWorktrees = useGitStore((s) => s.worktrees);
  const worktrees = useMemo(() => allWorktrees.filter((w) => w.status === 'active' && w.present), [allWorktrees]);
  const hasSelection = useAgentStore((s) => s.hasSelection[agent] ?? false);
  const forward = useChatStore((s) => s.forward);
  const [draft, setDraft] = useState<OutboundDraft | null>(null);
  const theme = useAppStore((s) => s.settings.theme);
  const tool = resultOf(report, agent);
  const auth = resultOf(report, `${agent}-auth`)?.state;
  const installed = tool ? tool.state === 'ok' : null;
  const running = isRunning(info);
  // Sessão aberta no outro papel (direta × orquestrador) não é controlada por este painel.
  const otherRole = running && info?.kind === 'agent' && (info.role === 'orchestrator') !== orchestrator;
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
    <section aria-label={orchestrator ? `Orquestrador (${AGENT_NAMES[agent]})` : AGENT_NAMES[agent]} data-testid={orchestrator ? 'orchestrator-pane' : `agent-pane-${agent}`} className="flex h-full flex-col bg-bg">
      {/* Quebra em duas linhas quando o painel fica estreito: nenhum botão some da tela. */}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-1">
        <span className={`shrink-0 font-medium whitespace-nowrap ${COLOR[agent]}`}>{orchestrator ? `Orquestrador · ${AGENT_NAMES[agent]}` : AGENT_NAMES[agent]}</span>
        {orchestrator && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs" data-testid="orchestrator-model">{modelLabel(leadSlot.model)} · esforço {EFFORT_LABEL[leadSlot.effort]}</span>}
        {tool?.version && <span className="min-w-0 truncate text-xs text-muted" title={tool.version}>{tool.version}</span>}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-status-${agent}`} title={info?.capabilities.automationNote}>{status}</span>
          {running && info?.kind === 'agent' && info.location.kind === 'worktree' && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-location-${agent}`}>worktree {info.location.name}</span>}
          {running && info?.kind === 'agent' && info.permission === 'read-only' && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted" data-testid={`agent-permission-${agent}`}>somente leitura</span>}
          {running && !orchestrator && (
            <Button key="forward" className="!px-2 !py-0.5 text-xs" disabled={!hasSelection} onClick={openForward} data-testid={`forward-${agent}`}
              title={hasSelection ? `Encaminhar o texto selecionado para ${AGENT_NAMES[other]}` : SELECT_HINT}>Encaminhar →</Button>
          )}
          {running ? (
            <>
              {/* Chaves distintas: o botão focado em "Iniciar" não pode virar "Encerrar" sob o cursor/teclado. */}
              <Button key="interrupt" className="!px-2 !py-0.5 text-xs" onClick={() => void interrupt(agent)} title="Envia Ctrl+C ao processo" data-testid={`interrupt-${agent}`}>Interromper</Button>
              <Button key="stop" className="!px-2 !py-0.5 text-xs" disabled={info?.stopping} onClick={() => void stop(agent)} data-testid={`stop-${agent}`}>Encerrar</Button>
            </>
          ) : (
            <>
              {!orchestrator && worktrees.length > 0 && (
                <select key="loc" value={locationId ?? ''} onChange={(e) => setLocation(agent, e.target.value || null)} aria-label="Local de execução"
                  className="max-w-32 rounded border border-border bg-bg px-1 py-0.5 text-xs" title="Onde iniciar o agente: raiz do workspace ou um worktree" data-testid={`location-${agent}`}>
                  <option value="">raiz</option>
                  {worktrees.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
              <label className="sr-only" htmlFor={`perm-${agent}`}>Permissões</label>
              <select key="perm" id={`perm-${agent}`} value={permission} onChange={(e) => setPermission(agent, e.target.value as PermissionPreset)}
                className="rounded border border-border bg-bg px-1 py-0.5 text-xs" title={PERMISSION_HELP[agent]} data-testid={`permission-${agent}`}>
                {(Object.keys(PERMISSION_LABEL) as PermissionPreset[]).map((p) => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
              </select>
              <Button key="login" className="!px-2 !py-0.5 text-xs" disabled={!installed} onClick={() => void start(agent, 'login')} data-testid={`login-start-${agent}`} title="Executa o comando oficial de login da CLI neste terminal">Fazer login</Button>
              <Button key="start" variant="primary" className="!px-2 !py-0.5 text-xs" disabled={!installed || !workspace || otherRole} onClick={() => void start(agent, 'agent', orchestrator)} data-testid={orchestrator ? 'orchestrator-start' : `start-${agent}`}>{orchestrator ? 'Iniciar orquestrador' : 'Iniciar'}</Button>
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
              {installed && workspace && auth !== 'unauthenticated' && !orchestrator && <p>Clique em “Iniciar” para abrir a CLI oficial em <span className="font-mono">{workspace.displayPath}</span>.</p>}
              {installed && workspace && auth !== 'unauthenticated' && orchestrator && (
                <p>“Iniciar orquestrador” abre o {AGENT_NAMES[agent]} oficial ({modelLabel(leadSlot.model)}, esforço {EFFORT_LABEL[leadSlot.effort]}) como gerente do projeto em <span className="font-mono">{workspace.displayPath}</span>. Diga o que precisa: ele classifica, dispara os workers (à esquerda e à direita) e reporta. Aprovações continuam com você, aqui no terminal.</p>
              )}
              <p className="text-xs">{info?.capabilities.automationNote}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

import { create } from 'zustand';
import type { AgentId, AgentSessionInfo, SessionKind, WorkspaceInfo } from '@shared/agents';
import type { PermissionPreset } from '@shared/orchestration';
import { unwrap } from '../lib/ipc';

/** Tamanho atual de cada terminal (preenchido pelo TerminalView após o ajuste). */
export const terminalSizes: Record<AgentId, { cols: number; rows: number }> = { claude: { cols: 100, rows: 30 }, codex: { cols: 100, rows: 30 } };

interface AgentState {
  sessions: Partial<Record<AgentId, AgentSessionInfo>>;
  workspace: WorkspaceInfo | null;
  /** Mensagem de erro por agente (ex.: falha ao iniciar). */
  errors: Partial<Record<AgentId, string>>;
  workspaceError: string | null;
  stoppingAll: boolean;
  /** Há texto selecionado no terminal de cada agente. */
  hasSelection: Partial<Record<AgentId, boolean>>;
  permission: Record<AgentId, PermissionPreset>;
  /** Onde iniciar cada agente: null = raiz do workspace; senão id do worktree. */
  location: Record<AgentId, string | null>;
  setLocation(agent: AgentId, worktreeId: string | null): void;
  setHasSelection(agent: AgentId, v: boolean): void;
  setPermission(agent: AgentId, p: PermissionPreset): void;
  init(): () => void;
  start(agent: AgentId, kind: SessionKind): Promise<void>;
  interrupt(agent: AgentId): Promise<void>;
  stop(agent: AgentId): Promise<void>;
  stopAll(): Promise<void>;
  chooseWorkspace(): Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  sessions: {},
  workspace: null,
  errors: {},
  workspaceError: null,
  stoppingAll: false,
  hasSelection: {},
  permission: { claude: 'cli-default', codex: 'cli-default' },
  location: { claude: null, codex: null },
  setLocation(agent, worktreeId) { set((s) => ({ location: { ...s.location, [agent]: worktreeId } })); },
  setHasSelection(agent, v) { if (get().hasSelection[agent] !== v) set((s) => ({ hasSelection: { ...s.hasSelection, [agent]: v } })); },
  setPermission(agent, p) { set((s) => ({ permission: { ...s.permission, [agent]: p } })); },
  init() {
    const off = window.devfusion.agents.onState((info) => set((s) => ({ sessions: { ...s.sessions, [info.agent]: info } })));
    const offWs = window.devfusion.workspace.onChanged((workspace) => set({ workspace }));
    void unwrap(window.devfusion.agents.list()).then((list) => set({ sessions: Object.fromEntries(list.map((i) => [i.agent, i])) }));
    void unwrap(window.devfusion.workspace.get()).then((workspace) => set({ workspace }));
    return () => { off(); offWs(); };
  },
  async start(agent, kind) {
    set((s) => ({ errors: { ...s.errors, [agent]: undefined } }));
    const { cols, rows } = terminalSizes[agent];
    const r = await unwrap(window.devfusion.agents.start(agent, kind, cols, rows, kind === 'agent' ? get().permission[agent] : undefined, kind === 'agent' ? get().location[agent] : null));
    if (!r.ok) set((s) => ({ errors: { ...s.errors, [agent]: r.reason } }));
  },
  async interrupt(agent) { await unwrap(window.devfusion.agents.interrupt(agent)); },
  async stop(agent) { await unwrap(window.devfusion.agents.stop(agent)); },
  async stopAll() {
    set({ stoppingAll: true });
    try { await unwrap(window.devfusion.agents.stopAll()); } finally { set({ stoppingAll: false }); }
  },
  async chooseWorkspace() {
    const r = await unwrap(window.devfusion.workspace.choose());
    if (!r.ok) { set({ workspaceError: r.reason }); return; }
    set({ workspaceError: null, workspace: r.value ?? get().workspace });
  },
}));

export const isRunning = (info: AgentSessionInfo | undefined) => info?.status === 'running';

import type { CheckId, DocId, DoctorReport, InstallMethod, InstallState, InstallableDependency } from '../shared/doctor';
import type { AgentId, AgentSessionInfo, SessionKind, WorkspaceInfo } from '../shared/agents';
import type { ActionResult, AppInfo, IpcResult } from '../shared/ipcContracts';
import type { ChatMessage, ChatTarget, OutboundPreview, PermissionPreset, Task, TaskDecision, TaskOutbound } from '../shared/orchestration';
import type { Settings } from '../shared/settings';
import type { UsageReport } from '../shared/usage';
import type { ExplorerEntry, GitFileStatus, GitLocation, MergeCheck, RepoStatus, WorktreeInfo } from '../shared/git';
import type { DashboardData, HistoryOverview, SessionRecord } from '../shared/history';
import type { UpdateStatus } from '../shared/updates';
import type { WorkersSnapshot } from '../shared/orchestrator';

export interface DevFusionApi {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  settings: {
    getAll(): Promise<IpcResult<Settings>>;
    /** Aceita `unknown` de propósito: o main valida chave e valor. */
    set(key: string, value: unknown): Promise<IpcResult<Settings>>;
  };
  doctor: {
    getReport(): Promise<IpcResult<DoctorReport>>;
    run(checks?: CheckId[]): Promise<IpcResult<DoctorReport>>;
    /** Retorna função para cancelar a inscrição. */
    onReport(cb: (report: DoctorReport) => void): () => void;
  };
  installer: {
    getMethods(dependency: InstallableDependency): Promise<IpcResult<InstallMethod[]>>;
    getState(): Promise<IpcResult<InstallState>>;
    install(methodId: string): Promise<IpcResult<InstallState>>;
    cancel(): Promise<IpcResult<boolean>>;
    openSource(methodId: string): Promise<IpcResult<boolean>>;
    onState(cb: (state: InstallState) => void): () => void;
  };
  docs: {
    open(docId: DocId): Promise<IpcResult<boolean>>;
  };
  workspace: {
    get(): Promise<IpcResult<WorkspaceInfo | null>>;
    onChanged(cb: (info: WorkspaceInfo | null) => void): () => void;
    openRecent(id: string): Promise<IpcResult<ActionResult<WorkspaceInfo>>>;
    /** Abre o seletor nativo de pasta no main. */
    choose(): Promise<IpcResult<ActionResult<WorkspaceInfo | null>>>;
  };
  agents: {
    list(): Promise<IpcResult<AgentSessionInfo[]>>;
    start(agent: AgentId, kind: SessionKind, cols: number, rows: number, permission?: PermissionPreset, worktreeId?: string | null, orchestrator?: boolean): Promise<IpcResult<ActionResult<AgentSessionInfo>>>;
    interrupt(agent: AgentId): Promise<IpcResult<void>>;
    stop(agent: AgentId): Promise<IpcResult<AgentSessionInfo>>;
    stopAll(): Promise<IpcResult<AgentSessionInfo[]>>;
    onState(cb: (info: AgentSessionInfo) => void): () => void;
  };
  terminal: {
    write(agent: AgentId, data: string): Promise<IpcResult<void>>;
    resize(agent: AgentId, cols: number, rows: number): Promise<IpcResult<void>>;
    ack(agent: AgentId, bytes: number): Promise<IpcResult<void>>;
    replay(agent: AgentId): Promise<IpcResult<string>>;
    onData(cb: (payload: { agent: AgentId; data: string }) => void): () => void;
  };
  chat: {
    list(limit?: number): Promise<IpcResult<ChatMessage[]>>;
    /** Cola no terminal do(s) agente(s); o usuário confirma com Enter no terminal. */
    send(to: ChatTarget, content: string): Promise<IpcResult<ActionResult<ChatMessage>>>;
    forward(from: AgentId, to: AgentId, content: string): Promise<IpcResult<ActionResult<ChatMessage>>>;
    onMessage(cb: (msg: ChatMessage) => void): () => void;
  };
  tasks: {
    list(): Promise<IpcResult<Task[]>>;
    create(input: { title: string; description: string; criteria: string[]; developer: AgentId; reviewer: AgentId; worktree: boolean }): Promise<IpcResult<ActionResult<Task | null>>>;
    preview(taskId: string, action: TaskOutbound, notes?: string): Promise<IpcResult<ActionResult<OutboundPreview>>>;
    send(taskId: string, action: TaskOutbound, content: string): Promise<IpcResult<ActionResult<Task>>>;
    decide(taskId: string, decision: TaskDecision, note?: string): Promise<IpcResult<ActionResult<Task>>>;
    onUpdated(cb: (task: Task) => void): () => void;
  };
  usage: {
    get(): Promise<IpcResult<UsageReport>>;
    refresh(): Promise<IpcResult<UsageReport>>;
    onChanged(cb: (report: UsageReport) => void): () => void;
  };
  git: {
    status(location: GitLocation): Promise<IpcResult<RepoStatus>>;
    list(location: GitLocation, rel: string): Promise<IpcResult<ActionResult<ExplorerEntry[]>>>;
    fileDiff(location: GitLocation, rel: string): Promise<IpcResult<ActionResult<string>>>;
    onFsChanged(cb: () => void): () => void;
  };
  worktrees: {
    list(): Promise<IpcResult<WorktreeInfo[]>>;
    create(name: string, baseRef: string, agent: AgentId | null): Promise<IpcResult<ActionResult<WorktreeInfo | null>>>;
    files(id: string): Promise<IpcResult<ActionResult<GitFileStatus[]>>>;
    commit(id: string, message: string): Promise<IpcResult<ActionResult<string>>>;
    checkMerge(id: string): Promise<IpcResult<ActionResult<MergeCheck>>>;
    merge(id: string): Promise<IpcResult<ActionResult<WorktreeInfo | null>>>;
    revert(id: string): Promise<IpcResult<ActionResult<WorktreeInfo | null>>>;
    remove(id: string, deleteBranch: boolean): Promise<IpcResult<ActionResult<boolean>>>;
    openFolder(id: string): Promise<IpcResult<ActionResult<boolean>>>;
    onChanged(cb: () => void): () => void;
  };
  editor: {
    read(location: GitLocation, rel: string): Promise<IpcResult<ActionResult<{ content: string; mtimeMs: number; size: number }>>>;
    write(location: GitLocation, rel: string, content: string, expectedMtimeMs: number, overwrite: boolean): Promise<IpcResult<ActionResult<{ status: 'saved'; mtimeMs: number } | { status: 'conflict'; diskMtimeMs: number }>>>;
  };
  history: {
    overview(): Promise<IpcResult<HistoryOverview | null>>;
    search(query: string, limit: number): Promise<IpcResult<ChatMessage[]>>;
    sessions(): Promise<IpcResult<SessionRecord[]>>;
    exportToFile(): Promise<IpcResult<ActionResult<string | null>>>;
    deleteAll(): Promise<IpcResult<ActionResult<{ messages: number; sessions: number; tasks: number } | null>>>;
  };
  dashboard: {
    get(): Promise<IpcResult<DashboardData>>;
  };
  diagnostics: {
    exportToFile(): Promise<IpcResult<ActionResult<string | null>>>;
    openLogsFolder(): Promise<IpcResult<boolean>>;
  };
  /** Aviso de nova versão (só leitura do GitHub Releases; nada é baixado). */
  updates: {
    get(): Promise<IpcResult<UpdateStatus>>;
    check(): Promise<IpcResult<UpdateStatus>>;
    openRelease(): Promise<IpcResult<boolean>>;
    onChanged(cb: (s: UpdateStatus) => void): () => void;
  };
  /** Workers do Dev Orchestrator (só leitura; parar só workers do Codex). */
  workers: {
    list(): Promise<IpcResult<WorkersSnapshot>>;
    stop(id: string): Promise<IpcResult<boolean>>;
    onChanged(cb: (s: WorkersSnapshot) => void): () => void;
  };
}

declare global {
  interface Window {
    readonly devfusion: DevFusionApi;
  }
}

import type { CheckId, DocId, DoctorReport, InstallMethod, InstallState, InstallableDependency } from '../shared/doctor';
import type { AgentId, AgentSessionInfo, SessionKind, WorkspaceInfo } from '../shared/agents';
import type { ActionResult, AppInfo, IpcResult } from '../shared/ipcContracts';
import type { ChatMessage, ChatTarget, OutboundPreview, PermissionPreset, Task, TaskDecision, TaskOutbound } from '../shared/orchestration';
import type { Settings } from '../shared/settings';

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
    /** Abre o seletor nativo de pasta no main. */
    choose(): Promise<IpcResult<ActionResult<WorkspaceInfo | null>>>;
  };
  agents: {
    list(): Promise<IpcResult<AgentSessionInfo[]>>;
    start(agent: AgentId, kind: SessionKind, cols: number, rows: number, permission?: PermissionPreset): Promise<IpcResult<ActionResult<AgentSessionInfo>>>;
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
    create(input: { title: string; description: string; criteria: string[]; developer: AgentId; reviewer: AgentId }): Promise<IpcResult<ActionResult<Task>>>;
    preview(taskId: string, action: TaskOutbound, notes?: string): Promise<IpcResult<ActionResult<OutboundPreview>>>;
    send(taskId: string, action: TaskOutbound, content: string): Promise<IpcResult<ActionResult<Task>>>;
    decide(taskId: string, decision: TaskDecision, note?: string): Promise<IpcResult<ActionResult<Task>>>;
    onUpdated(cb: (task: Task) => void): () => void;
  };
}

declare global {
  interface Window {
    readonly devfusion: DevFusionApi;
  }
}

import { z } from 'zod';
import {
  DoctorRunArgsSchema, InstallPlanArgsSchema, InstallRunArgsSchema, OpenDocArgsSchema,
  type CheckId, type DoctorReport, type InstallMethod, type InstallState, type InstallableDependency, type DocId,
} from './doctor';
import {
  AgentArgsSchema, AgentStartArgsSchema, TerminalAckArgsSchema, TerminalResizeArgsSchema, TerminalWriteArgsSchema,
  type AgentId, type AgentSessionInfo, type SessionKind, type WorkspaceInfo,
} from './agents';
import { IPC } from './ipcChannels';
import {
  ChatListArgsSchema, ChatSendArgsSchema, ForwardArgsSchema, TaskCreateArgsSchema, TaskDecideArgsSchema, TaskPreviewArgsSchema, TaskSendArgsSchema,
  type ChatMessage, type ChatTarget, type OutboundPreview, type PermissionPreset, type Task, type TaskDecision, type TaskOutbound,
} from './orchestration';
import { SETTINGS_SCHEMA, isSettingKey, type Settings } from './settings';
import type { UsageReport } from './usage';
import type { UpdateStatus } from './updates';
import { WorkerStopArgsSchema, type WorkersSnapshot } from './orchestrator';
import {
  ExplorerDiffArgsSchema, ExplorerListArgsSchema, GitStatusArgsSchema, WorktreeCommitArgsSchema, WorktreeCreateArgsSchema, WorktreeIdArgsSchema, WorktreeRemoveArgsSchema,
  type ExplorerEntry, type GitFileStatus, type GitLocation, type MergeCheck, type RepoStatus, type WorktreeInfo,
  EditorReadArgsSchema, EditorWriteArgsSchema,
} from './git';
import { HistorySearchArgsSchema, OpenRecentArgsSchema, type DashboardData, type HistoryOverview, type SessionRecord } from './history';

/** Envelope de resposta: erros viajam como dados, sem stack nem detalhes internos. */
export type IpcErrorCode = 'INVALID_ARGUMENT' | 'FORBIDDEN_SENDER' | 'INTERNAL';
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode; message: string } };

export const AppInfoSchema = z.object({
  appVersion: z.string(),
  platform: z.enum(['win32', 'darwin', 'linux', 'other']),
  arch: z.string(),
  versions: z.object({ electron: z.string(), chrome: z.string(), node: z.string() }),
  database: z.object({ schemaVersion: z.number().int().nonnegative(), sqliteVersion: z.string() }),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

const settingSetArgs = z
  .object({ key: z.string(), value: z.unknown() })
  .strict()
  .superRefine((arg, ctx) => {
    if (!isSettingKey(arg.key)) {
      ctx.addIssue({ code: 'custom', message: 'Chave de configuração desconhecida' });
      return;
    }
    const parsed = SETTINGS_SCHEMA[arg.key].safeParse(arg.value);
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: `Valor inválido para ${arg.key}` });
  });

/** Schemas de argumento por canal (validados no main). */
export const IPC_ARG_SCHEMAS = {
  [IPC.appGetInfo]: z.undefined(),
  [IPC.settingsGetAll]: z.undefined(),
  [IPC.settingsSet]: settingSetArgs,
  [IPC.doctorGetReport]: z.undefined(),
  [IPC.doctorRun]: DoctorRunArgsSchema,
  [IPC.installerGetMethods]: InstallPlanArgsSchema,
  [IPC.installerGetState]: z.undefined(),
  [IPC.installerInstall]: InstallRunArgsSchema,
  [IPC.installerCancel]: z.undefined(),
  [IPC.installerOpenSource]: InstallRunArgsSchema,
  [IPC.docsOpen]: OpenDocArgsSchema,
  [IPC.workspaceGet]: z.undefined(),
  [IPC.workspaceChoose]: z.undefined(),
  [IPC.agentsList]: z.undefined(),
  [IPC.agentStart]: AgentStartArgsSchema,
  [IPC.agentInterrupt]: AgentArgsSchema,
  [IPC.agentStop]: AgentArgsSchema,
  [IPC.agentsStopAll]: z.undefined(),
  [IPC.terminalWrite]: TerminalWriteArgsSchema,
  [IPC.terminalResize]: TerminalResizeArgsSchema,
  [IPC.terminalAck]: TerminalAckArgsSchema,
  [IPC.terminalReplay]: AgentArgsSchema,
  [IPC.chatList]: ChatListArgsSchema,
  [IPC.chatSend]: ChatSendArgsSchema,
  [IPC.chatForward]: ForwardArgsSchema,
  [IPC.tasksList]: z.undefined(),
  [IPC.tasksCreate]: TaskCreateArgsSchema,
  [IPC.tasksPreview]: TaskPreviewArgsSchema,
  [IPC.tasksSend]: TaskSendArgsSchema,
  [IPC.tasksDecide]: TaskDecideArgsSchema,
  [IPC.usageGet]: z.undefined(),
  [IPC.usageRefresh]: z.undefined(),
  [IPC.gitStatus]: GitStatusArgsSchema,
  [IPC.explorerList]: ExplorerListArgsSchema,
  [IPC.explorerDiff]: ExplorerDiffArgsSchema,
  [IPC.worktreesList]: z.undefined(),
  [IPC.worktreesCreate]: WorktreeCreateArgsSchema,
  [IPC.worktreesFiles]: WorktreeIdArgsSchema,
  [IPC.worktreesCommit]: WorktreeCommitArgsSchema,
  [IPC.worktreesCheckMerge]: WorktreeIdArgsSchema,
  [IPC.worktreesMerge]: WorktreeIdArgsSchema,
  [IPC.worktreesRevert]: WorktreeIdArgsSchema,
  [IPC.worktreesRemove]: WorktreeRemoveArgsSchema,
  [IPC.worktreesOpenFolder]: WorktreeIdArgsSchema,
  [IPC.editorRead]: EditorReadArgsSchema,
  [IPC.editorWrite]: EditorWriteArgsSchema,
  [IPC.historyOverview]: z.undefined(),
  [IPC.historySearch]: HistorySearchArgsSchema,
  [IPC.historySessions]: z.undefined(),
  [IPC.historyExport]: z.undefined(),
  [IPC.historyDelete]: z.undefined(),
  [IPC.dashboardGet]: z.undefined(),
  [IPC.workspaceOpenRecent]: OpenRecentArgsSchema,
  [IPC.diagnosticsExport]: z.undefined(),
  [IPC.logsOpenFolder]: z.undefined(),
  [IPC.updatesGet]: z.undefined(),
  [IPC.updatesCheck]: z.undefined(),
  [IPC.updatesOpenRelease]: z.undefined(),
  [IPC.workersList]: z.undefined(),
  [IPC.workersStop]: WorkerStopArgsSchema,
} as const;

/** Resultado de ações que podem falhar por motivo esperado (mensagem para o usuário). */
export type ActionResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface IpcHandlers {
  [IPC.appGetInfo]: () => AppInfo;
  [IPC.settingsGetAll]: () => Settings;
  /** Ligar a integração ai-memory pede confirmação nativa no main; recusada, nada muda. */
  [IPC.settingsSet]: (arg: { key: keyof Settings; value: Settings[keyof Settings] }) => Settings | Promise<Settings>;
  [IPC.doctorGetReport]: () => DoctorReport;
  [IPC.doctorRun]: (arg: { checks?: CheckId[] } | undefined) => Promise<DoctorReport>;
  [IPC.installerGetMethods]: (arg: { dependency: InstallableDependency }) => Promise<InstallMethod[]>;
  [IPC.installerGetState]: () => InstallState;
  [IPC.installerInstall]: (arg: { methodId: string }) => Promise<InstallState>;
  [IPC.installerCancel]: () => boolean;
  [IPC.installerOpenSource]: (arg: { methodId: string }) => Promise<boolean>;
  [IPC.docsOpen]: (arg: { docId: DocId }) => Promise<boolean>;
  [IPC.workspaceGet]: () => Promise<WorkspaceInfo | null>;
  [IPC.workspaceChoose]: () => Promise<ActionResult<WorkspaceInfo | null>>;
  [IPC.agentsList]: () => AgentSessionInfo[];
  [IPC.agentStart]: (arg: { agent: AgentId; kind: SessionKind; cols: number; rows: number; permission: PermissionPreset; worktreeId: string | null; orchestrator: boolean }) => Promise<ActionResult<AgentSessionInfo>>;
  [IPC.agentInterrupt]: (arg: { agent: AgentId }) => Promise<void>;
  [IPC.agentStop]: (arg: { agent: AgentId }) => Promise<AgentSessionInfo>;
  [IPC.agentsStopAll]: () => Promise<AgentSessionInfo[]>;
  [IPC.terminalWrite]: (arg: { agent: AgentId; data: string }) => void;
  [IPC.terminalResize]: (arg: { agent: AgentId; cols: number; rows: number }) => void;
  [IPC.terminalAck]: (arg: { agent: AgentId; bytes: number }) => void;
  [IPC.terminalReplay]: (arg: { agent: AgentId }) => string;
  [IPC.chatList]: (arg: { limit: number } | undefined) => ChatMessage[];
  [IPC.chatSend]: (arg: { to: ChatTarget; content: string }) => Promise<ActionResult<ChatMessage>>;
  [IPC.chatForward]: (arg: { from: AgentId; to: AgentId; content: string }) => Promise<ActionResult<ChatMessage>>;
  [IPC.tasksList]: () => Task[];
  [IPC.tasksCreate]: (arg: { title: string; description: string; criteria: string[]; developer: AgentId; reviewer: AgentId; worktree: boolean }) => Promise<ActionResult<Task | null>>;
  [IPC.tasksPreview]: (arg: { taskId: string; action: TaskOutbound; notes?: string }) => Promise<ActionResult<OutboundPreview>>;
  [IPC.tasksSend]: (arg: { taskId: string; action: TaskOutbound; content: string }) => Promise<ActionResult<Task>>;
  [IPC.tasksDecide]: (arg: { taskId: string; decision: TaskDecision; note?: string }) => ActionResult<Task>;
  [IPC.usageGet]: () => UsageReport;
  [IPC.usageRefresh]: () => Promise<UsageReport>;
  [IPC.gitStatus]: (arg: { location: GitLocation }) => Promise<RepoStatus>;
  [IPC.explorerList]: (arg: { location: GitLocation; rel: string }) => Promise<ActionResult<ExplorerEntry[]>>;
  [IPC.explorerDiff]: (arg: { location: GitLocation; rel: string }) => Promise<ActionResult<string>>;
  [IPC.worktreesList]: () => Promise<WorktreeInfo[]>;
  /** Pede confirmação nativa; `value: null` = usuário recusou. */
  [IPC.worktreesCreate]: (arg: { name: string; baseRef: string; agent: AgentId | null }) => Promise<ActionResult<WorktreeInfo | null>>;
  [IPC.worktreesFiles]: (arg: { id: string }) => Promise<ActionResult<GitFileStatus[]>>;
  [IPC.worktreesCommit]: (arg: { id: string; message: string }) => Promise<ActionResult<string>>;
  [IPC.worktreesCheckMerge]: (arg: { id: string }) => Promise<ActionResult<MergeCheck>>;
  [IPC.worktreesMerge]: (arg: { id: string }) => Promise<ActionResult<WorktreeInfo | null>>;
  [IPC.worktreesRevert]: (arg: { id: string }) => Promise<ActionResult<WorktreeInfo | null>>;
  [IPC.worktreesRemove]: (arg: { id: string; deleteBranch: boolean }) => Promise<ActionResult<boolean>>;
  [IPC.worktreesOpenFolder]: (arg: { id: string }) => Promise<ActionResult<boolean>>;
  [IPC.editorRead]: (arg: { location: GitLocation; rel: string }) => Promise<ActionResult<{ content: string; mtimeMs: number; size: number }>>;
  [IPC.editorWrite]: (arg: { location: GitLocation; rel: string; content: string; expectedMtimeMs: number; overwrite: boolean }) => Promise<ActionResult<{ status: 'saved'; mtimeMs: number } | { status: 'conflict'; diskMtimeMs: number }>>;
  [IPC.historyOverview]: () => HistoryOverview | null;
  [IPC.historySearch]: (arg: { query: string; limit: number }) => ChatMessage[];
  [IPC.historySessions]: () => SessionRecord[];
  /** Abre o diálogo nativo de salvar; `value: null` = cancelado. */
  [IPC.historyExport]: () => Promise<ActionResult<string | null>>;
  /** Confirmação nativa; `value: null` = cancelado. */
  [IPC.historyDelete]: () => Promise<ActionResult<{ messages: number; sessions: number; tasks: number } | null>>;
  [IPC.dashboardGet]: () => DashboardData;
  [IPC.workspaceOpenRecent]: (arg: { id: string }) => Promise<ActionResult<WorkspaceInfo>>;
  /** Diálogo nativo de salvar; `value: null` = cancelado. */
  [IPC.diagnosticsExport]: () => Promise<ActionResult<string | null>>;
  [IPC.logsOpenFolder]: () => Promise<boolean>;
  [IPC.updatesGet]: () => UpdateStatus;
  /** Consulta o GitHub Releases agora (respeita a preferência; nunca baixa nada). */
  [IPC.updatesCheck]: () => Promise<UpdateStatus>;
  /** Abre no navegador a página da release disponível (URL validada no main). */
  [IPC.updatesOpenRelease]: () => Promise<boolean>;
  /** Workers do orquestrador observados (só leitura). */
  [IPC.workersList]: () => WorkersSnapshot;
  /** Encerra um worker do Codex (grupo de processos). */
  [IPC.workersStop]: (arg: { id: string }) => boolean;
}

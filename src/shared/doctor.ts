import { z } from 'zod';

/** Estados de um check (docs/03-SYSTEM-DOCTOR.md). */
export const CHECK_STATES = ['ok', 'missing', 'incompatible', 'unauthenticated', 'unknown', 'optional', 'error'] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const CHECK_IDS = [
  'os',
  'app-data',
  'disk',
  'pty',
  'git',
  'claude',
  'codex',
  'claude-auth',
  'codex-auth',
  'net-anthropic',
  'net-openai',
  'node',
  'npm',
  'workspace',
  'ai-memory',
  'python',
  'docker',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** Checks que só rodam quando o usuário pede (Python/Docker dependem do projeto). */
export const ON_DEMAND_CHECKS: readonly CheckId[] = ['python', 'docker'];

export type CheckGroup = 'system' | 'agents' | 'accounts' | 'network' | 'tools';

export type SuggestedAction =
  | { kind: 'install'; dependency: InstallableDependency }
  | { kind: 'login'; agent: 'claude' | 'codex' }
  | { kind: 'open-docs'; docId: DocId }
  | { kind: 'configure-path'; tool: ConfigurableTool }
  | { kind: 'retry' }
  | { kind: 'none' };

export interface CheckResult {
  id: CheckId;
  label: string;
  group: CheckGroup;
  /** Necessidade conforme a tabela do System Doctor. */
  requirement: 'required' | 'agent' | 'optional';
  state: CheckState;
  version: string | null;
  /** Caminho com o diretório home substituído por "~". */
  path: string | null;
  /** Texto curto, sanitizado, sem segredos. */
  detail: string;
  action: SuggestedAction;
  durationMs: number;
  checkedAt: string;
}

export interface DoctorReport {
  runId: number;
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  results: CheckResult[];
  summary: DoctorSummary;
}

export interface DoctorSummary {
  /** Agentes instalados e autenticados. */
  readyAgents: Array<'claude' | 'codex'>;
  /** Algum item obrigatório com problema. */
  blockingIssues: number;
  /** Modo sugerido para continuar. */
  mode: 'full' | 'individual' | 'degraded';
}

// ---------------------------------------------------------------- instalação

export const INSTALLABLE = ['git', 'claude', 'codex', 'node', 'ai-memory'] as const;
export type InstallableDependency = (typeof INSTALLABLE)[number];

export const CONFIGURABLE_TOOLS = ['git', 'claude', 'codex'] as const;
export type ConfigurableTool = (typeof CONFIGURABLE_TOOLS)[number];

export const DOC_IDS = ['claude-setup', 'claude-auth', 'codex-cli', 'codex-auth', 'git-download', 'node-download', 'ai-memory'] as const;
export type DocId = (typeof DOC_IDS)[number];

export interface InstallMethod {
  id: string;
  dependency: InstallableDependency;
  title: string;
  /** Página oficial que documenta o método. */
  sourceUrl: string;
  /** Comando exatamente como será executado (exibição). Null quando é só instrução. */
  commandDisplay: string | null;
  /** Execução automática permitida (apenas gerenciadores de pacote com comando fixo). */
  automatic: boolean;
  /** Disponível neste computador (ex.: o gerenciador de pacotes existe). */
  available: boolean;
  unavailableReason: string | null;
  permissions: string;
  versionNote: string;
  notes: string[];
}

export type InstallStatus = 'idle' | 'awaiting-consent' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'declined';

export interface InstallState {
  methodId: string | null;
  dependency: InstallableDependency | null;
  status: InstallStatus;
  output: string;
  exitCode: number | null;
  message: string | null;
}

// ---------------------------------------------------------------- schemas de IPC

export const DoctorRunArgsSchema = z
  .object({ checks: z.array(z.enum(CHECK_IDS)).min(1).max(CHECK_IDS.length).optional() })
  .strict()
  .optional();

export const InstallPlanArgsSchema = z.object({ dependency: z.enum(INSTALLABLE) }).strict();
export const InstallRunArgsSchema = z.object({ methodId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) }).strict();
export const OpenDocArgsSchema = z.object({ docId: z.enum(DOC_IDS) }).strict();

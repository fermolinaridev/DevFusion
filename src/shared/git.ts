import { z } from 'zod';
import { AGENT_IDS, type AgentId } from './agentIds';

export type GitFileKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'other';
export interface GitFileStatus { path: string; kind: GitFileKind; code: string }

export interface RepoStatus {
  isRepo: boolean;
  hasCommits: boolean;
  branch: string | null;
  headSha: string | null;
  branches: string[];
  clean: boolean;
  files: GitFileStatus[];
}

export type WorktreeStatus = 'active' | 'merged' | 'reverted' | 'removed';

export interface WorktreeInfo {
  id: string;
  name: string;
  displayPath: string;
  branch: string;
  baseRef: string;
  baseSha: string;
  agent: AgentId | null;
  taskId: string | null;
  status: WorktreeStatus;
  /** Commits do branch desde a base. */
  ahead: number;
  /** Commits novos no branch alvo (raiz) que o worktree não tem. */
  behind: number;
  /** Arquivos com alterações não commitadas no worktree. */
  uncommitted: number;
  /** O diretório ainda existe e está registrado no Git. */
  present: boolean;
  createdAt: string;
  mergedSha: string | null;
}

export interface WorktreeCreatePreview {
  branch: string;
  displayPath: string;
  baseRef: string;
  baseSha: string;
  /** Arquivos com alterações não commitadas na raiz (não vão para o worktree). */
  rootUncommitted: number;
  commands: string[];
}

export interface WorktreeDiff { files: GitFileStatus[]; text: string; warnings: string[] }

export interface MergeCheck {
  targetBranch: string | null;
  conflicts: string[];
  /** Motivos que impedem integrar agora (raiz suja, nada a integrar, etc.). */
  blockers: string[];
  canMerge: boolean;
}

export type GitLocation = { kind: 'root' } | { kind: 'worktree'; id: string };

export interface ExplorerEntry { name: string; rel: string; type: 'dir' | 'file' | 'symlink'; status: GitFileKind | null }

// ---------------------------------------------------------------- schemas IPC

/** Nome curto para pasta/branch: letras, números, hífen. */
const name = z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/, 'Use letras, números e hífens');
/** Referência Git conservadora (sem espaços, "..", "~", "^", ":", "\\", controle; não começa com "-"). */
export const GitRefSchema = z.string().trim().min(1).max(200)
  .refine((r) => !/[\s~^:?*[\\\u0000-\u001f\u007f]|\.\.|@\{|^-|\/$|\.lock$|^\//.test(r), 'Referência Git inválida');
const id = z.string().uuid();
export const LocationSchema = z.union([z.object({ kind: z.literal('root') }).strict(), z.object({ kind: z.literal('worktree'), id }).strict()]);
const relPath = z.string().max(4096).refine((p) => !p.includes('\0'), 'Caminho inválido');

export const WorktreeCreateArgsSchema = z.object({ name, baseRef: GitRefSchema, agent: z.enum(AGENT_IDS).nullable() }).strict();
export const WorktreeIdArgsSchema = z.object({ id }).strict();
export const WorktreeCommitArgsSchema = z.object({ id, message: z.string().trim().min(3).max(500) }).strict();
export const WorktreeRemoveArgsSchema = z.object({ id, deleteBranch: z.boolean() }).strict();
export const ExplorerListArgsSchema = z.object({ location: LocationSchema, rel: relPath }).strict();
export const ExplorerDiffArgsSchema = z.object({ location: LocationSchema, rel: relPath.refine((p) => p.length > 0, 'Arquivo obrigatório') }).strict();
export const GitStatusArgsSchema = z.object({ location: LocationSchema }).strict();

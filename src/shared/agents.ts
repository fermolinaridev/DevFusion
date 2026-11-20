import { z } from 'zod';
import { PERMISSION_PRESETS, type PermissionPreset } from './orchestration';

import { AGENT_IDS, type AgentId } from './agentIds';

export { AGENT_IDS, AGENT_NAMES, type AgentId } from './agentIds';

/** "agent" = CLI interativa; "login" = comando oficial de login da CLI. */
export type SessionKind = 'agent' | 'login';

/**
 * Estados de agente (docs/04-AGENTES.md). Com PTY só usamos os que são fatos
 * observáveis: processo vivo, código de saída, falha ao iniciar. "awaiting_approval"
 * e "rate_limited" exigem eventos estruturados e não são inferidos do texto.
 */
export type AgentStatus = 'idle' | 'running' | 'awaiting_approval' | 'rate_limited' | 'failed' | 'disconnected' | 'completed';

export interface AgentCapabilities {
  interactive: boolean;
  automatable: boolean;
  structuredEvents: boolean;
  /** Por que a automação está ou não disponível (exibido na UI). */
  automationNote: string;
}

export interface AgentSessionInfo {
  agent: AgentId;
  kind: SessionKind;
  status: AgentStatus;
  /** Preset de permissão usado ao iniciar (flags oficiais da CLI). */
  permission: PermissionPreset;
  /** Onde o processo roda: raiz do workspace ou um worktree. */
  location: { kind: 'root' } | { kind: 'worktree'; id: string; name: string };
  /** Encerramento em andamento (Ctrl‑C → SIGTERM → SIGKILL). */
  stopping: boolean;
  sessionId: string | null;
  pid: number | null;
  cwd: string | null;
  command: string | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  signal: number | null;
  error: string | null;
  capabilities: AgentCapabilities;
}

export interface WorkspaceInfo {
  id: string;
  /** Caminho com home abreviado para exibição. */
  displayPath: string;
  name: string;
  git: { isRepo: boolean; branch: string | null };
}

const agent = z.enum(AGENT_IDS);
export const AgentArgsSchema = z.object({ agent }).strict();
export const AgentStartArgsSchema = z
  .object({
    agent, kind: z.enum(['agent', 'login']), cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(500),
    permission: z.enum(PERMISSION_PRESETS).default('cli-default'),
    worktreeId: z.string().uuid().nullable().default(null),
  })
  .strict();
/** Entrada do teclado do xterm (limitada para não travar o PTY). */
export const TerminalWriteArgsSchema = z.object({ agent, data: z.string().min(1).max(65_536) }).strict();
export const TerminalResizeArgsSchema = z.object({ agent, cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(500) }).strict();
export const TerminalAckArgsSchema = z.object({ agent, bytes: z.number().int().min(0).max(64 * 1024 * 1024) }).strict();

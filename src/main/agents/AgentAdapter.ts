import type { AgentCapabilities, AgentId, AgentStatus, SessionKind } from '@shared/agents';
import type { PermissionPreset } from '@shared/orchestration';

/**
 * Interface de docs/04-AGENTES.md, adaptada ao que um PTY realmente oferece.
 * `sendMessage` cola texto no terminal (bracketed paste) sem pressionar Enter:
 * enviar de fato continua sendo uma ação do usuário no terminal.
 */
export interface AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  checkInstallation(): Promise<boolean>;
  checkAuthentication(): Promise<boolean | 'unknown'>;
  capabilities(): Promise<AgentCapabilities>;
  startSession(workspace: string, opts: { kind: SessionKind; cols: number; rows: number; permission?: PermissionPreset; location?: { kind: 'root' } | { kind: 'worktree'; id: string; name: string } }): Promise<void>;
  sendMessage(message: string): Promise<void>;
  getStatus(): AgentStatus;
  interrupt(): Promise<void>;
  closeSession(): Promise<void>;
}

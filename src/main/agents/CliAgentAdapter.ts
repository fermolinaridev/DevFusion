import { randomUUID } from 'node:crypto';
import type { CheckResult } from '@shared/doctor';
import type { AgentCapabilities, AgentId, AgentSessionInfo, AgentStatus, SessionKind } from '@shared/agents';
import type { PlatformDetector, ToolName } from '../system/PlatformDetector';
import { ptyCommand, type TerminalManager } from '../terminal/TerminalManager';
import type { AgentAdapter } from './AgentAdapter';

export interface CliAgentConfig {
  id: AgentId;
  name: string;
  tool: ToolName;
  /** Argumentos da sessão interativa (vazio = CLI oficial sem flags). */
  agentArgs: string[];
  /** Comando oficial de login da CLI. */
  loginArgs: string[];
  capabilities: AgentCapabilities;
}

export interface CliAgentDeps {
  detector: PlatformDetector;
  terminals: TerminalManager;
  configuredPath: () => string | null;
  doctorResult: (id: 'claude' | 'codex' | 'claude-auth' | 'codex-auth') => CheckResult | null;
  onChange: (info: AgentSessionInfo) => void;
  onSessionCreated?: (sessionId: string, agent: AgentId, kind: SessionKind) => void;
  onSessionEnded?: (sessionId: string, status: AgentStatus, kind: SessionKind) => void;
}

/** Remove sequências de escape/controle (exceto \n e \t) de texto colado no terminal. */
export function sanitizePaste(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

export class CliAgentAdapter implements AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  private info: AgentSessionInfo;

  constructor(private readonly cfg: CliAgentConfig, private readonly deps: CliAgentDeps) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.info = { agent: cfg.id, kind: 'agent', status: 'idle', stopping: false, sessionId: null, pid: null, cwd: null, command: null, startedAt: null, endedAt: null, exitCode: null, signal: null, error: null, capabilities: cfg.capabilities };
  }

  snapshot(): AgentSessionInfo { return { ...this.info }; }

  async checkInstallation(): Promise<boolean> { return this.deps.doctorResult(this.cfg.id)?.state === 'ok'; }

  /** Status de conta vem apenas do System Doctor (comando oficial). Desconhecido não é login. */
  async checkAuthentication(): Promise<boolean | 'unknown'> {
    const r = this.deps.doctorResult(`${this.cfg.id}-auth`);
    if (r?.state === 'ok') return true;
    if (r?.state === 'unauthenticated') return false;
    return 'unknown';
  }

  async capabilities(): Promise<AgentCapabilities> { return this.cfg.capabilities; }

  getStatus(): AgentStatus { return this.info.status; }

  async startSession(cwd: string, opts: { kind: SessionKind; cols: number; rows: number }): Promise<void> {
    if (this.deps.terminals.has(this.id)) throw new Error(`${this.name} já está em execução.`);
    const { found } = this.deps.detector.locate(this.cfg.tool, this.deps.configuredPath());
    if (!found) {
      this.update({ status: 'failed', error: `${this.name} não foi encontrado. Instale ou configure o caminho no System Doctor.` });
      throw new Error(this.info.error!);
    }
    const args = opts.kind === 'login' ? this.cfg.loginArgs : this.cfg.agentArgs;
    const env: NodeJS.ProcessEnv = { ...this.deps.detector.childEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env['NO_COLOR'];
    const sessionId = randomUUID();
    try {
      const cmd = ptyCommand(found.path, args, this.deps.detector.platform, env);
      const pid = this.deps.terminals.start(this.id, { file: cmd.file, args: cmd.args, cwd, env, cols: opts.cols, rows: opts.rows });
      this.update({
        kind: opts.kind, status: 'running', stopping: false, sessionId, pid, cwd: this.deps.detector.shortenHome(cwd),
        command: [this.cfg.tool, ...args].join(' '), startedAt: new Date().toISOString(), endedAt: null, exitCode: null, signal: null, error: null,
      });
      this.deps.onSessionCreated?.(sessionId, this.id, opts.kind);
    } catch (e) {
      this.update({ status: 'failed', error: `Não foi possível iniciar ${this.name}: ${(e as Error).message}` });
      throw e;
    }
  }

  /** Chamado pelo serviço quando o PTY termina. */
  handleExit(exitCode: number, signal: number | null): void {
    const status: AgentStatus = exitCode === 0 && !signal ? 'completed' : this.info.stopping ? 'completed' : 'failed';
    this.update({ status, stopping: false, pid: null, exitCode, signal, endedAt: new Date().toISOString() });
    if (this.info.sessionId) this.deps.onSessionEnded?.(this.info.sessionId, status, this.info.kind);
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.deps.terminals.has(this.id)) throw new Error(`${this.name} não está em execução.`);
    this.deps.terminals.write(this.id, `\x1b[200~${sanitizePaste(message)}\x1b[201~`);
  }

  async interrupt(): Promise<void> { this.deps.terminals.interrupt(this.id); }

  async closeSession(): Promise<void> {
    if (!this.deps.terminals.has(this.id)) return;
    this.update({ stopping: true });
    await this.deps.terminals.stop(this.id);
  }

  private update(patch: Partial<AgentSessionInfo>): void {
    this.info = { ...this.info, ...patch };
    this.deps.onChange(this.snapshot());
  }
}

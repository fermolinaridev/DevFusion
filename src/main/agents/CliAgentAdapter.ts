import { randomUUID } from 'node:crypto';
import type { CheckResult } from '@shared/doctor';
import type { AgentCapabilities, AgentId, AgentSessionInfo, AgentStatus, SessionKind } from '@shared/agents';
import type { PermissionPreset } from '@shared/orchestration';
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
  /** Flags oficiais por preset de permissão. Nunca incluir bypass/danger. */
  permissionArgs: Record<PermissionPreset, string[]>;
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
  /** Argumentos extras para sessões de agente (ex.: --settings da statusline de uso). */
  extraAgentArgs?: () => string[];
  /** Embrulha sessões de agente (ex.: `ai-memory run`); null = lançar direto. Lança erro se não puder. */
  wrapAgentLaunch?: (exe: string, args: string[]) => { file: string; args: string[]; display: string[] } | null;
}

export class PasteNotSafeError extends Error {}

/** Flags cujo valor é longo ou interno (settings, roster, instruções): exibidas como "…". */
const HIDDEN_VALUE_FLAGS = new Set(['--settings', '--agents', '--append-system-prompt']);

/** Comando para exibição: oculta valores de settings/instruções, mantém modelo e esforço. */
export function displayArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (HIDDEN_VALUE_FLAGS.has(a)) { if (a !== '--settings') out.push(a, '…'); i++; continue; }
    if (a === '-c' && args[i + 1]?.startsWith('developer_instructions=')) { out.push('-c', 'developer_instructions=…'); i++; continue; }
    out.push(a);
  }
  return out;
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
    this.info = { agent: cfg.id, kind: 'agent', status: 'idle', permission: 'cli-default', role: 'direct', location: { kind: 'root' }, stopping: false, sessionId: null, pid: null, cwd: null, command: null, startedAt: null, endedAt: null, exitCode: null, signal: null, error: null, capabilities: cfg.capabilities };
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

  /**
   * `orchestratorArgs`: argumentos oficiais do papel de orquestrador; substituem os extras padrão
   * (a statusline vai mesclada no mesmo `--settings`).
   */
  async startSession(cwd: string, opts: { kind: SessionKind; cols: number; rows: number; permission?: PermissionPreset; location?: AgentSessionInfo['location']; orchestratorArgs?: string[] }): Promise<void> {
    if (this.deps.terminals.has(this.id)) throw new Error(`${this.name} já está em execução.`);
    const { found } = this.deps.detector.locate(this.cfg.tool, this.deps.configuredPath());
    if (!found) {
      this.update({ status: 'failed', error: `${this.name} não foi encontrado. Instale ou configure o caminho no System Doctor.` });
      throw new Error(this.info.error!);
    }
    const permission = opts.kind === 'login' ? 'cli-default' : opts.permission ?? 'cli-default';
    const role = opts.kind === 'agent' && opts.orchestratorArgs ? 'orchestrator' : 'direct';
    const args = opts.kind === 'login' ? this.cfg.loginArgs : [...this.cfg.agentArgs, ...this.cfg.permissionArgs[permission], ...(opts.orchestratorArgs ?? this.deps.extraAgentArgs?.() ?? [])];
    const env: NodeJS.ProcessEnv = { ...this.deps.detector.childEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env['NO_COLOR'];
    const sessionId = randomUUID();
    try {
      const wrapped = opts.kind === 'agent' ? this.deps.wrapAgentLaunch?.(found.path, args) ?? null : null;
      const cmd = wrapped ? ptyCommand(wrapped.file, wrapped.args, this.deps.detector.platform, env) : ptyCommand(found.path, args, this.deps.detector.platform, env);
      const pid = this.deps.terminals.start(this.id, { file: cmd.file, args: cmd.args, cwd, env, cols: opts.cols, rows: opts.rows });
      this.cwdReal = cwd;
      this.update({
        kind: opts.kind, permission, role, location: opts.location ?? { kind: 'root' }, status: 'running', stopping: false, sessionId, pid, cwd: this.deps.detector.shortenHome(cwd),
        command: [...(wrapped ? wrapped.display : [this.cfg.tool]), ...displayArgs(args)].join(' '), startedAt: new Date().toISOString(), endedAt: null, exitCode: null, signal: null, error: null,
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
    const text = sanitizePaste(message);
    if (this.deps.terminals.bracketedPaste(this.id)) {
      this.deps.terminals.write(this.id, `\x1b[200~${text}\x1b[201~`);
      return;
    }
    // Sem colagem delimitada, cada quebra de linha seria um Enter: nunca enviar sozinho.
    if (text.includes('\n')) throw new PasteNotSafeError(`${this.name} não está aceitando colagem segura de várias linhas neste momento (o programa não ativou bracketed paste). Copie o texto manualmente ou envie uma linha só.`);
    this.deps.terminals.write(this.id, text);
  }

  /** Diretório real onde o processo atual roda (null se parado). */
  runningCwd(): string | null { return this.deps.terminals.has(this.id) ? this.cwdReal : null; }
  private cwdReal: string | null = null;

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

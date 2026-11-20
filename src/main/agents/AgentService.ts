import { homedir } from 'node:os';
import type { AgentId, AgentSessionInfo, SessionKind } from '@shared/agents';
import { AGENT_IDS } from '@shared/agents';
import type { CheckId } from '@shared/doctor';
import { TerminalManager, type PtyFactory, type TerminalOptions } from '../terminal/TerminalManager';
import { CliAgentAdapter, type CliAgentDeps } from './CliAgentAdapter';
import { CLAUDE_CONFIG } from './ClaudeCodeAdapter';
import { CODEX_CONFIG } from './CodexAdapter';

export interface AgentServiceDeps extends Omit<CliAgentDeps, 'terminals' | 'configuredPath' | 'onChange'> {
  ptyFactory: PtyFactory;
  terminalOptions?: TerminalOptions;
  configuredPaths: () => Record<AgentId, string | null>;
  workspacePath: () => string | null;
  revalidate: (checks: CheckId[]) => Promise<unknown>;
  emitState: (info: AgentSessionInfo) => void;
  emitData: (agent: AgentId, data: string) => void;
  /** Diagnóstico: chamado quando um processo de agente termina, com o fim da tela. */
  onExitDiagnostics?: (d: { agent: AgentId; kind: SessionKind; exitCode: number; signal: number | null; durationMs: number | null; stoppedByUser: boolean; screenTail: string }) => void;
}

/** Remove sequências ANSI/OSC e devolve as últimas linhas visíveis (para log). */
export function screenTail(raw: string, maxLines = 15, maxChars = 1200): string {
  const plain = raw
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '\n')
    .replace(/\x1b./g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  const lines = plain.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1);
  return lines.slice(-maxLines).join(' | ').slice(-maxChars);
}

/** Coordena os dois adapters e seus PTYs independentes. */
export class AgentService {
  readonly terminals: TerminalManager;
  private readonly adapters: Record<AgentId, CliAgentAdapter>;

  constructor(private readonly deps: AgentServiceDeps) {
    this.terminals = new TerminalManager(deps.ptyFactory, {
      onData: (key, data) => deps.emitData(key as AgentId, data),
      onExit: (key, { exitCode, signal }) => {
        const agent = key as AgentId;
        const before = this.adapters[agent].snapshot();
        deps.onExitDiagnostics?.({
          agent, kind: before.kind, exitCode, signal,
          durationMs: before.startedAt ? Date.now() - Date.parse(before.startedAt) : null,
          stoppedByUser: before.stopping,
          screenTail: screenTail(this.terminals.replay(agent)),
        });
        this.adapters[agent].handleExit(exitCode, signal);
      },
    }, deps.terminalOptions);
    const make = (cfg: typeof CLAUDE_CONFIG) => new CliAgentAdapter(cfg, {
      ...deps,
      terminals: this.terminals,
      configuredPath: () => deps.configuredPaths()[cfg.id],
      onChange: deps.emitState,
      onSessionEnded: (id, status, kind) => {
        deps.onSessionEnded?.(id, status, kind);
        // Ao fim de um login (ou sessão), revalida a conta pelo comando oficial.
        void deps.revalidate([`${cfg.id}-auth` as CheckId]);
      },
    });
    this.adapters = { claude: make(CLAUDE_CONFIG), codex: make(CODEX_CONFIG) };
  }

  adapter(agent: AgentId): CliAgentAdapter { return this.adapters[agent]; }
  list(): AgentSessionInfo[] { return AGENT_IDS.map((a) => this.adapters[a].snapshot()); }

  async start(agent: AgentId, kind: SessionKind, cols: number, rows: number): Promise<AgentSessionInfo> {
    const ws = this.deps.workspacePath();
    if (kind === 'agent' && !ws) throw new Error('Selecione um workspace antes de iniciar o agente.');
    await this.adapters[agent].startSession(kind === 'agent' ? ws! : ws ?? homedir(), { kind, cols, rows });
    return this.adapters[agent].snapshot();
  }

  async stop(agent: AgentId): Promise<AgentSessionInfo> {
    await this.adapters[agent].closeSession();
    return this.adapters[agent].snapshot();
  }

  async stopAll(): Promise<AgentSessionInfo[]> {
    await Promise.all(AGENT_IDS.map((a) => this.adapters[a].closeSession()));
    return this.list();
  }
}

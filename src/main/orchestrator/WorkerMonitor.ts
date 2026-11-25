import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '@shared/agentIds';
import { killTree } from '../system/ProcessRunner';
import { ORCH_TIERS, type Effort, type OrchTier, type OrchestratorSettings, type WorkerInfo, type WorkersSnapshot } from '@shared/orchestrator';

const MAX_TEXT = 4000;
const MAX_FILES = 3000;
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? s.slice(0, n) + '…' : s);
const tierOf = (s: string | undefined): OrchTier | null => (ORCH_TIERS as readonly string[]).includes(s ?? '') ? (s as OrchTier) : null;

export interface WorkerMonitorDeps {
  eventsDir: string;
  emit: (s: WorkersSnapshot) => void;
  shorten: (p: string) => string;
  /** Processo vivo? (injetável para testes) */
  alive?: (pid: number) => boolean;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  log?: { warn: (m: string, meta?: unknown) => void };
  /** Padrão: plataforma atual. */
  platform?: NodeJS.Platform;
}

/**
 * Observa a pasta de eventos do orquestrador e monta a lista de workers. Só lê e exibe:
 * nunca decide nada a partir do conteúdo nem escreve nos terminais dos agentes.
 * - Claude: arquivos `c-*.json` gravados pelos hooks oficiais (PreToolUse/PostToolUse do Agent,
 *   SubagentStart/SubagentStop).
 * - Codex: arquivos `codex-<ts>-<pid>.*` gravados pelo script do worker (`codex exec --json`).
 */
export class WorkerMonitor {
  private lead: AgentId | null = null;
  private settings: OrchestratorSettings | null = null;
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private last = '';
  private readonly alive: (pid: number) => boolean;
  private readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  private readonly win: boolean;

  constructor(private readonly deps: WorkerMonitorDeps) {
    this.alive = deps.alive ?? ((pid) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } });
    this.win = (deps.platform ?? process.platform) === 'win32';
    // Windows não tem grupos de processos: taskkill /T encerra o worker e os filhos.
    this.kill = deps.kill ?? ((pid, sig) => { if (this.win) killTree(pid); else process.kill(pid, sig); });
  }

  /** Nova sessão do orquestrador: limpa eventos antigos (contêm prompts) e começa a observar. */
  begin(lead: AgentId, settings: OrchestratorSettings): void {
    this.stopWatching();
    rmSync(this.deps.eventsDir, { recursive: true, force: true });
    mkdirSync(this.deps.eventsDir, { recursive: true });
    this.lead = lead;
    this.settings = settings;
    try { this.watcher = watch(this.deps.eventsDir, () => this.schedule()); } catch { this.watcher = null; }
    // Reserva: fs.watch pode perder eventos; também detecta processo de worker que morreu.
    this.timer = setInterval(() => this.refresh(), 2000);
    this.timer.unref();
    this.refresh(true);
  }

  /** Orquestrador encerrou: os eventos continuam visíveis até a próxima sessão. */
  end(): void {
    this.lead = null;
    this.stopWatching();
    this.refresh(true);
  }

  private stopWatching(): void {
    this.watcher?.close(); this.watcher = null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    if (this.debounce) clearTimeout(this.debounce); this.debounce = null;
  }

  private schedule(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(() => { this.debounce = null; this.refresh(); }, 150);
  }

  refresh(force = false): WorkersSnapshot {
    const snap = this.snapshot();
    const key = JSON.stringify(snap);
    if (force || key !== this.last) { this.last = key; this.deps.emit(snap); }
    return snap;
  }

  snapshot(): WorkersSnapshot {
    let names: string[] = [];
    try { names = readdirSync(this.deps.eventsDir).slice(0, MAX_FILES); } catch { /* pasta ainda não existe */ }
    // Subagentes rodam dentro do orquestrador: se ele encerrou, os que não terminaram foram interrompidos.
    const claude = this.claudeWorkers(names).map((w) => (this.lead === null && w.status === 'running' ? { ...w, status: 'stopped' as const } : w));
    const workers = [...claude, ...this.codexWorkers(names)].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return { lead: this.lead, workers };
  }

  // ------------------------------------------------------------------ Claude (hooks oficiais)
  private claudeWorkers(names: string[]): WorkerInfo[] {
    const events: Array<{ at: number; e: Record<string, unknown> }> = [];
    for (const n of names) {
      if (!/^c-\d+-\d+\.json$/.test(n)) continue;
      const p = join(this.deps.eventsDir, n);
      try { events.push({ at: statSync(p).mtimeMs, e: JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown> }); } catch { /* arquivo em escrita */ }
    }
    events.sort((a, b) => a.at - b.at);
    const byId = new Map<string, WorkerInfo>();
    const pending = new Map<string, Array<{ task: string; toolUseId: string }>>();
    const taskByToolUse = new Map<string, string>();
    for (const { at, e } of events) {
      const ev = String(e['hook_event_name'] ?? '');
      const input = (e['tool_input'] ?? {}) as Record<string, unknown>;
      if (ev === 'PreToolUse') {
        const type = String(input['subagent_type'] ?? 'general-purpose');
        const task = String(input['description'] ?? '') + (input['prompt'] ? `: ${String(input['prompt'])}` : '');
        taskByToolUse.set(String(e['tool_use_id'] ?? ''), task);
        pending.set(type, [...(pending.get(type) ?? []), { task, toolUseId: String(e['tool_use_id'] ?? '') }]);
      } else if (ev === 'SubagentStart') {
        const id = String(e['agent_id'] ?? ''); const type = String(e['agent_type'] ?? '');
        if (!id) continue;
        const queue = pending.get(type) ?? [];
        const p = queue.shift();
        byId.set(id, this.claudeInfo(id, type, p?.task ?? '', at));
      } else if (ev === 'SubagentStop') {
        const id = String(e['agent_id'] ?? '');
        const w = byId.get(id) ?? this.claudeInfo(id, String(e['agent_type'] ?? ''), '', at);
        byId.set(id, { ...w, status: w.status === 'running' ? 'completed' : w.status, endedAt: new Date(at).toISOString(), output: clip(String(e['last_assistant_message'] ?? '')) || w.output });
      } else if (ev === 'PostToolUse') {
        const r = (e['tool_response'] ?? {}) as Record<string, unknown>;
        const id = String(r['agentId'] ?? '');
        const w = byId.get(id);
        if (!w) continue;
        const task = taskByToolUse.get(String(e['tool_use_id'] ?? ''));
        // `async_launched` (subagente em segundo plano) chega antes do fim: continua rodando até o SubagentStop.
        const st = String(r['status'] ?? '');
        const status = st === 'completed' ? 'completed' : /^(error|failed|cancelled|interrupted)$/.test(st) && w.status === 'running' ? 'failed' : w.status;
        const model = typeof r['resolvedModel'] === 'string' ? r['resolvedModel'] : w.model;
        byId.set(id, { ...w, task: task ? clip(task, 600) : w.task, model, status, endedAt: status === 'running' ? null : w.endedAt ?? new Date(at).toISOString() });
      }
    }
    return [...byId.values()];
  }

  private claudeInfo(id: string, type: string, task: string, at: number): WorkerInfo {
    const tier = type.startsWith('claude-') ? tierOf(type.slice('claude-'.length)) : null;
    const slot = tier && this.settings ? this.settings.roster[tier].claude : null;
    return {
      id: `claude-${id}`, provider: 'claude', tier, name: type || 'subagente', model: slot?.model ?? null, effort: slot?.effort ?? null,
      task: clip(task, 600), status: 'running', activity: null, output: null, startedAt: new Date(at).toISOString(), endedAt: null, tokens: null, cwd: null,
    };
  }

  // ------------------------------------------------------------------ Codex (script do worker)
  private codexWorkers(names: string[]): WorkerInfo[] {
    const ids = [...new Set(names.filter((n) => /^codex-\d+-\d+\.meta$/.test(n)).map((n) => n.slice(0, -'.meta'.length)))];
    return ids.map((id) => this.codexInfo(id)).filter((w): w is WorkerInfo => w !== null);
  }

  private read(id: string, ext: string): string | null {
    try { return readFileSync(join(this.deps.eventsDir, `${id}.${ext}`), 'utf8'); } catch { return null; }
  }

  private codexInfo(id: string): WorkerInfo | null {
    const meta = this.read(id, 'meta');
    if (!meta) return null;
    const [tierS, model, effort] = meta.trim().split(/\s+/);
    const startedAt = new Date(Number(id.split('-')[1]) * 1000).toISOString();
    const dir = this.read(id, 'dir');
    let activity: string | null = null; let lastMessage: string | null = null; let tokens: WorkerInfo['tokens'] = null; let finished = false; let error: string | null = null;
    for (const line of (this.read(id, 'jsonl') ?? '').split('\n')) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>;
      try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const item = (e['item'] ?? {}) as Record<string, unknown>;
      if (e['type'] === 'item.completed' || e['type'] === 'item.started') {
        if (item['type'] === 'agent_message' && typeof item['text'] === 'string') lastMessage = item['text'];
        else if (item['type'] === 'command_execution' && typeof item['command'] === 'string') activity = `$ ${item['command']}`;
        else if (item['type'] === 'file_change') activity = 'alterando arquivos';
        else if (typeof item['type'] === 'string' && item['type'] !== 'reasoning') activity = String(item['type']);
      } else if (e['type'] === 'turn.completed') {
        finished = true;
        const u = (e['usage'] ?? {}) as Record<string, unknown>;
        if (typeof u['input_tokens'] === 'number' && typeof u['output_tokens'] === 'number') tokens = { input: u['input_tokens'], output: u['output_tokens'] };
      } else if (e['type'] === 'turn.failed' || e['type'] === 'error') {
        const err = (e['error'] ?? {}) as Record<string, unknown>;
        error = String(err['message'] ?? e['message'] ?? 'erro');
      }
    }
    const exitRaw = this.read(id, 'exit');
    const pid = Number(this.read(id, 'pid') ?? NaN);
    const stopped = existsSync(join(this.deps.eventsDir, `${id}.stopped`));
    let status: WorkerInfo['status'] = 'running';
    let endedAt: string | null = null;
    if (stopped) status = 'stopped';
    else if (exitRaw !== null) status = Number(exitRaw.trim()) === 0 && finished ? 'completed' : 'failed';
    else if (Number.isFinite(pid) && !this.alive(pid)) status = 'failed';
    if (status !== 'running') {
      const f = ['exit', 'stopped', 'jsonl'].map((x) => join(this.deps.eventsDir, `${id}.${x}`)).find((p) => existsSync(p));
      try { endedAt = f ? statSync(f).mtime.toISOString() : null; } catch { endedAt = null; }
    }
    const last = this.read(id, 'last');
    // Em falha, o erro vem primeiro: evento de falha do Codex, fim do stderr ou processo que sumiu.
    const errTail = status === 'failed' ? error || (this.read(id, 'err') ?? '').trim().slice(-1200) || (exitRaw === null ? 'O processo do worker terminou sem concluir.' : null) : null;
    return {
      id, provider: 'codex', tier: tierOf(tierS), name: 'codex exec', model: model ?? null, effort: (effort as Effort) ?? null,
      task: clip(this.read(id, 'task') ?? '', 600), status, activity, output: clip((errTail ?? '') || (last ?? lastMessage ?? '').trim()) || null,
      startedAt, endedAt, tokens, cwd: dir ? this.deps.shorten(this.win ? dir.replace(/\//g, '\\') : dir) : null,
    };
  }

  /** Encerra um worker do Codex (grupo de processos). */
  stopWorker(id: string): boolean {
    const pid = Number(this.read(id, 'pid') ?? NaN);
    if (!Number.isFinite(pid) || this.read(id, 'exit') !== null) return false;
    writeFileSync(join(this.deps.eventsDir, `${id}.stopped`), new Date().toISOString());
    const targets = this.win ? [pid] : [-pid, pid];
    for (const target of targets) { try { this.kill(target, 'SIGTERM'); } catch { /* já encerrado */ } }
    const t = setTimeout(() => { for (const target of targets) { try { if (this.alive(pid)) this.kill(target, 'SIGKILL'); } catch { /* ok */ } } this.refresh(); }, 2000);
    t.unref();
    this.refresh();
    return true;
  }

  /** Parar tudo: encerra todos os workers do Codex ainda vivos. Devolve quantos. */
  stopAll(): number {
    let names: string[] = [];
    try { names = readdirSync(this.deps.eventsDir); } catch { return 0; }
    let n = 0;
    for (const f of names) if (/^codex-\d+-\d+\.pid$/.test(f) && this.stopWorker(f.slice(0, -4))) n++;
    return n;
  }

  /** Há worker do Codex vivo? (para o before-quit) */
  hasRunning(): boolean { return this.snapshot().workers.some((w) => w.provider === 'codex' && w.status === 'running'); }

  dispose(): void { this.stopWatching(); }
}

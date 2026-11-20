import type { IPty } from 'node-pty';
import { execFile } from 'node:child_process';

export interface PtySpawnSpec {
  file: string;
  args: string[] | string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

export interface PtyFactory {
  spawn(file: string, args: string[] | string, opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): IPty;
}

export interface TerminalEvents {
  onData(key: string, data: string): void;
  onExit(key: string, info: { exitCode: number; signal: number | null }): void;
}

export interface TerminalOptions {
  /** Intervalo de agrupamento da saída enviada ao renderer. */
  flushMs?: number;
  /** Bytes não confirmados pelo renderer que pausam o PTY / retomam. */
  highWaterMark?: number;
  lowWaterMark?: number;
  /** Tamanho máximo guardado para reanexar a tela. */
  replayBytes?: number;
  /** Tempos da escalada de encerramento. */
  interruptGraceMs?: number;
  termGraceMs?: number;
}

interface Session {
  pty: IPty;
  pid: number;
  pending: string;
  timer: NodeJS.Timeout | null;
  unacked: number;
  paused: boolean;
  replay: string;
  exited: Promise<void>;
  alive: boolean;
  /** O programa ativou bracketed paste (ESC[?2004h) e não desativou depois. */
  bracketedPaste: boolean;
}

/**
 * Gerencia um PTY por chave (agente). Saída em lotes, controle de fluxo baseado em
 * confirmações do renderer e encerramento escalonado. Não interpreta o conteúdo.
 */
export class TerminalManager {
  private readonly sessions = new Map<string, Session>();
  private readonly o: Required<TerminalOptions>;

  constructor(private readonly factory: PtyFactory, private readonly events: TerminalEvents, opts: TerminalOptions = {}) {
    this.o = { flushMs: 16, highWaterMark: 512 * 1024, lowWaterMark: 128 * 1024, replayBytes: 256 * 1024, interruptGraceMs: 1500, termGraceMs: 2000, ...opts };
  }

  has(key: string): boolean { return this.sessions.get(key)?.alive ?? false; }
  pid(key: string): number | null { return this.sessions.get(key)?.pid ?? null; }

  start(key: string, spec: PtySpawnSpec): number {
    if (this.has(key)) throw new Error('Já existe um processo ativo para este agente.');
    const pty = this.factory.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: spec.cols, rows: spec.rows, cwd: spec.cwd, env: spec.env });
    let resolveExit!: () => void;
    const s: Session = { pty, pid: pty.pid, pending: '', timer: null, unacked: 0, paused: false, replay: '', exited: new Promise((r) => { resolveExit = r; }), alive: true, bracketedPaste: false };
    this.sessions.set(key, s);
    pty.onData((d) => {
      trackModes(s, d);
      s.pending += d;
      s.replay = (s.replay + d).slice(-this.o.replayBytes);
      if (!s.timer) s.timer = setTimeout(() => this.flush(key, s), this.o.flushMs);
    });
    pty.onExit(({ exitCode, signal }) => {
      this.flush(key, s);
      s.alive = false;
      resolveExit();
      this.events.onExit(key, { exitCode, signal: signal ?? null });
    });
    return pty.pid;
  }

  private flush(key: string, s: Session): void {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (!s.pending) return;
    const chunk = s.pending;
    s.pending = '';
    s.unacked += chunk.length;
    this.events.onData(key, chunk);
    if (!s.paused && s.unacked > this.o.highWaterMark && s.alive) { s.paused = true; s.pty.pause(); }
  }

  /** Renderer confirma que consumiu `bytes` (após o xterm processar). */
  ack(key: string, bytes: number): void {
    const s = this.sessions.get(key);
    if (!s) return;
    s.unacked = Math.max(0, s.unacked - bytes);
    if (s.paused && s.unacked < this.o.lowWaterMark && s.alive) { s.paused = false; s.pty.resume(); }
  }

  isPaused(key: string): boolean { return this.sessions.get(key)?.paused ?? false; }

  /**
   * O renderer recarregou (ex.: caiu): confirmações pendentes nunca chegarão.
   * Zera a contagem e retoma PTYs pausados para não travar as CLIs.
   */
  resetFlowControl(): void {
    for (const s of this.sessions.values()) {
      s.unacked = 0;
      if (s.paused && s.alive) { s.paused = false; s.pty.resume(); }
    }
  }

  /** Estado do protocolo do terminal: o programa aceita colagem delimitada? */
  bracketedPaste(key: string): boolean { return this.sessions.get(key)?.bracketedPaste ?? false; }

  write(key: string, data: string): void {
    const s = this.sessions.get(key);
    if (s?.alive) s.pty.write(data);
  }

  resize(key: string, cols: number, rows: number): void {
    const s = this.sessions.get(key);
    if (s?.alive) { try { s.pty.resize(cols, rows); } catch { /* processo pode ter acabado de sair */ } }
  }

  replay(key: string): string { return this.sessions.get(key)?.replay ?? ''; }

  /** Ctrl‑C, como o usuário faria no teclado. */
  interrupt(key: string): void { this.write(key, '\x03'); }

  /**
   * Encerramento escalonado: Ctrl‑C ×2 → SIGTERM → SIGKILL (POSIX, grupo de processos)
   * ou kill + taskkill /T (Windows). Resolve quando o processo terminou.
   */
  async stop(key: string): Promise<'not-running' | 'interrupt' | 'term' | 'kill'> {
    const s = this.sessions.get(key);
    if (!s?.alive) return 'not-running';
    const wait = (ms: number) => Promise.race([s.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
    s.pty.write('\x03');
    await new Promise((r) => setTimeout(r, 150));
    if (s.alive) s.pty.write('\x03');
    if (await wait(this.o.interruptGraceMs)) return 'interrupt';
    this.signal(s, 'SIGTERM');
    if (await wait(this.o.termGraceMs)) return 'term';
    this.signal(s, 'SIGKILL');
    await wait(2000);
    return 'kill';
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((k) => this.stop(k)));
  }

  private signal(s: Session, sig: 'SIGTERM' | 'SIGKILL'): void {
    if (process.platform === 'win32') {
      try { s.pty.kill(); } catch { /* já encerrado */ }
      execFile('taskkill', ['/pid', String(s.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
      return;
    }
    // O PTY é líder de sessão: o grupo de processos tem o mesmo id; encerra a árvore.
    try { process.kill(-s.pid, sig); } catch { try { s.pty.kill(sig); } catch { /* já encerrado */ } }
  }
}

/** Atualiza modos privados DEC relevantes a partir da saída do programa (ESC[?…h / ESC[?…l). */
function trackModes(s: { bracketedPaste: boolean }, data: string): void {
  if (!data.includes('\x1b[?')) return;
  for (const m of data.matchAll(/\x1b\[\?([0-9;]+)([hl])/g)) {
    if (m[1]!.split(';').includes('2004')) s.bracketedPaste = m[2] === 'h';
  }
}

/** Monta o comando para o PTY (no Windows, .cmd/.bat precisam de cmd.exe). */
export function ptyCommand(file: string, args: string[], platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { file: string; args: string[] | string } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    for (const a of [file, ...args]) if (/["%^&|<>!\r\n]/.test(a)) throw new Error('Argumento com caractere não permitido para cmd.exe');
    return { file: env['ComSpec'] ?? env['COMSPEC'] ?? 'cmd.exe', args: `/d /s /c "${[file, ...args].map((a) => `"${a}"`).join(' ')}"` };
  }
  return { file, args };
}

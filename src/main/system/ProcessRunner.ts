import { spawn, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { redact } from '@shared/redact';

export interface RunOptions {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  /** Limite de bytes guardados por stream (o resto é descartado). */
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** Recebe a saída já sanitizada, em pedaços. */
  onOutput?: (chunk: string) => void;
  /** Conteúdo para stdin; quando ausente stdin é fechado imediatamente. */
  input?: string;
  /**
   * Devolve stdout/stderr sem sanitização, para leitura interna (ex.: caminhos e SHAs do Git).
   * Nunca registrar em log o resultado de uma execução `raw`.
   */
  raw?: boolean;
}

export interface RunResult {
  exitCode: number | null;
  signal: string | null;
  /** O executável não existe. */
  notFound: boolean;
  /** O sistema negou a execução (EACCES/EPERM). */
  permissionDenied: boolean;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Mensagem de erro de spawn sanitizada, quando houver. */
  spawnError: string | null;
}

export type CommandRunner = (file: string, args: readonly string[], options: RunOptions) => Promise<RunResult>;

const HOME = homedir();
/** Metacaracteres do cmd.exe que nunca devem aparecer em argumentos repassados a .cmd/.bat. */
const CMD_META = /["%^&|<>!\r\n]/;

/**
 * No Windows, .cmd/.bat só rodam via cmd.exe. Os argumentos usados pelo DevFusion
 * são constantes do catálogo ou caminhos validados; qualquer metacaractere é rejeitado
 * em vez de escapado, para não abrir espaço para injeção.
 */
export function buildSpawnSpec(file: string, args: readonly string[], platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { file: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    for (const a of [file, ...args]) if (CMD_META.test(a)) throw new Error('Argumento com caractere não permitido para cmd.exe');
    const line = [file, ...args].map((a) => `"${a}"`).join(' ');
    return { file: env['ComSpec'] ?? env['COMSPEC'] ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  return { file, args: [...args], verbatim: false };
}

export const runCommand: CommandRunner = (file, args, opts) =>
  new Promise((resolve) => {
    const started = Date.now();
    const max = opts.maxOutputBytes ?? 64 * 1024;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    let spec: ReturnType<typeof buildSpawnSpec>;
    try {
      spec = buildSpawnSpec(file, args, process.platform, opts.env);
    } catch (e) {
      resolve(result({ spawnError: (e as Error).message }));
      return;
    }

    const child = spawn(spec.file, spec.args, {
      env: opts.env,
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: spec.verbatim,
      // Grupo próprio no POSIX para encerrar a árvore inteira no timeout/cancelamento.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const append = (which: 'out' | 'err', data: Buffer) => {
      const text = data.toString('utf8');
      if (which === 'out') { if (stdout.length < max) stdout += text.slice(0, max - stdout.length); }
      else if (stderr.length < max) stderr += text.slice(0, max - stderr.length);
      opts.onOutput?.(redact(text, HOME));
    };
    child.stdout?.on('data', (d: Buffer) => append('out', d));
    child.stderr?.on('data', (d: Buffer) => append('err', d));
    child.stdin?.on('error', () => { /* processo pode fechar stdin antes */ });
    if (opts.input !== undefined) child.stdin?.end(opts.input); else child.stdin?.end();

    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; killTree(child.pid); }, opts.timeoutMs) : null;
    const onAbort = () => { cancelled = true; killTree(child.pid); };
    if (opts.signal) { if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        notFound: err.code === 'ENOENT',
        permissionDenied: err.code === 'EACCES' || err.code === 'EPERM',
        spawnError: redact(err.message, HOME),
      });
    });
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));

    function finish(partial: Partial<RunResult>) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result(partial));
    }

    function result(partial: Partial<RunResult>): RunResult {
      return {
        exitCode: null, signal: null, notFound: false, permissionDenied: false, spawnError: null,
        ...partial,
        timedOut, cancelled,
        stdout: opts.raw ? stdout : redact(stdout, HOME), stderr: opts.raw ? stderr : redact(stderr, HOME),
        durationMs: Date.now() - started,
      };
    }
  });

/** Encerra o processo e seus filhos (taskkill /T no Windows, grupo de processos no POSIX). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => { /* melhor esforço */ });
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* já encerrado */ } }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* já encerrado */ } }, 2000).unref();
}

import type { IPty, IPtyForkOptions } from 'node-pty';

export type PtyProbeResult = { ok: true; ms: number } | { ok: false; detail: string };
type Spawn = (file: string, args: string[], opts: IPtyForkOptions) => IPty;

const MARKER = 'devfusion-pty-ok';

/**
 * Abre um processo trivial no pseudo-terminal e confirma a saída. Detecta módulo nativo
 * ausente/quebrado (ex.: `node-pty` fora do asar no app empacotado) antes de abrir um agente.
 * Não executa nada além do shell padrão do sistema com um `echo` fixo.
 */
export async function probePty(opts: { spawn: Spawn | null; platform: NodeJS.Platform; env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<PtyProbeResult> {
  if (!opts.spawn) return { ok: false, detail: 'Módulo de terminal (node-pty) não carregou.' };
  const started = Date.now();
  const [file, args] = opts.platform === 'win32'
    ? [opts.env['ComSpec'] ?? opts.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/c', `echo ${MARKER}`]]
    : ['/bin/sh', ['-c', `printf ${MARKER}`]];
  let pty: IPty;
  try {
    pty = opts.spawn(file, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: opts.cwd, env: opts.env as Record<string, string> });
  } catch (e) {
    return { ok: false, detail: `Falha ao abrir o terminal: ${(e as Error).message.slice(0, 160)}` };
  }
  return new Promise<PtyProbeResult>((resolve) => {
    let out = '';
    let done = false;
    const finish = (r: PtyProbeResult) => { if (done) return; done = true; clearTimeout(timer); try { pty.kill(); } catch { /* já encerrado */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, detail: 'O terminal não respondeu a tempo.' }), opts.timeoutMs ?? 5000);
    pty.onData((d) => { out += d; if (out.includes(MARKER)) finish({ ok: true, ms: Date.now() - started }); });
    pty.onExit(({ exitCode }) => {
      // Dá tempo para a última saída chegar antes de concluir.
      setTimeout(() => finish(out.includes(MARKER) ? { ok: true, ms: Date.now() - started } : { ok: false, detail: `O processo de teste terminou (código ${exitCode}) sem a saída esperada.` }), 100);
    });
  });
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redact } from '@shared/redact';

type Level = 'debug' | 'info' | 'warn' | 'error';
const HOME = homedir();

/** Arquivo de log opcional (configurado no main). Tudo passa por redact() antes de gravar. */
const sink: { dir: string | null; maxBytes: number; keep: number } = { dir: null, maxBytes: 1024 * 1024, keep: 3 };

export function configureLogFile(dir: string, opts: { maxBytes?: number; keep?: number } = {}): string {
  mkdirSync(dir, { recursive: true });
  sink.dir = dir;
  sink.maxBytes = opts.maxBytes ?? sink.maxBytes;
  sink.keep = opts.keep ?? sink.keep;
  return join(dir, 'main.log');
}

/** Rotação simples: main.log → main.1.log → … → main.<keep>.log (o mais antigo é descartado). */
function rotateIfNeeded(file: string): void {
  try { if (statSync(file).size < sink.maxBytes) return; } catch { return; }
  for (let i = sink.keep - 1; i >= 1; i--) {
    const from = join(sink.dir!, `main.${i}.log`);
    if (existsSync(from)) renameSync(from, join(sink.dir!, `main.${i + 1}.log`));
  }
  renameSync(file, join(sink.dir!, 'main.1.log'));
}

function writeFile(line: string): void {
  if (!sink.dir) return;
  const file = join(sink.dir, 'main.log');
  try { rotateIfNeeded(file); appendFileSync(file, line + '\n'); } catch { /* log nunca derruba o app */ }
}

/** Últimas linhas do log atual (já sanitizadas na gravação). */
export function tailLog(lines = 300): string[] {
  if (!sink.dir) return [];
  try { return readFileSync(join(sink.dir, 'main.log'), 'utf8').split('\n').filter(Boolean).slice(-lines); } catch { return []; }
}

/** Logger com sanitização obrigatória: nada chega ao console ou ao arquivo sem passar por redact(). */
export function createLogger(scope: string) {
  const write = (level: Level, msg: string, meta?: unknown) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${redact(msg, HOME)}${meta === undefined ? '' : ' ' + redact(meta, HOME)}`;
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    if (level !== 'debug') writeFile(line);
  };
  return {
    debug: (m: string, meta?: unknown) => write('debug', m, meta),
    info: (m: string, meta?: unknown) => write('info', m, meta),
    warn: (m: string, meta?: unknown) => write('warn', m, meta),
    error: (m: string, meta?: unknown) => write('error', m, meta),
  };
}
export type Logger = ReturnType<typeof createLogger>;

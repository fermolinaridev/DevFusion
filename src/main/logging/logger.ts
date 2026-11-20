import { homedir } from 'node:os';
import { redact } from '@shared/redact';

type Level = 'debug' | 'info' | 'warn' | 'error';
const HOME = homedir();

/** Logger com sanitização obrigatória: nada chega ao console sem passar por redact(). */
export function createLogger(scope: string) {
  const write = (level: Level, msg: string, meta?: unknown) => {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${redact(msg, HOME)}${meta === undefined ? '' : ' ' + redact(meta, HOME)}`;
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  };
  return {
    debug: (m: string, meta?: unknown) => write('debug', m, meta),
    info: (m: string, meta?: unknown) => write('info', m, meta),
    warn: (m: string, meta?: unknown) => write('warn', m, meta),
    error: (m: string, meta?: unknown) => write('error', m, meta),
  };
}
export type Logger = ReturnType<typeof createLogger>;

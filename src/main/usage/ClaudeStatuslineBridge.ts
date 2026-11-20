import { mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { windowLabel, type ProviderUsage, type UsageWindow } from '@shared/usage';
import { clampPercent } from './CodexUsageReader';

/**
 * Script executado pelo Claude Code como comando de statusline (recurso documentado).
 * Recebe o JSON oficial pelo stdin e grava APENAS `rate_limits` (5 h e 7 dias) num arquivo
 * do DevFusion; imprime uma linha curta de uso no rodapé do Claude.
 */
export const STATUSLINE_SCRIPT = `'use strict';
const fs = require('fs');
const out = process.argv[2];
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; if (raw.length > 1e6) raw = raw.slice(-1e6); });
process.stdin.on('end', () => {
  let line = 'DevFusion · uso do plano: aguardando a primeira resposta';
  try {
    const j = JSON.parse(raw);
    const rl = j && j.rate_limits;
    if (rl && typeof rl === 'object') {
      const pick = (w) => (w && typeof w.used_percentage === 'number' ? { used_percentage: w.used_percentage, resets_at: typeof w.resets_at === 'number' ? w.resets_at : null } : undefined);
      const data = { receivedAt: new Date().toISOString(), rate_limits: { five_hour: pick(rl.five_hour), seven_day: pick(rl.seven_day) } };
      if (out && (data.rate_limits.five_hour || data.rate_limits.seven_day)) {
        const tmp = out + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, out);
      }
      const parts = [];
      if (data.rate_limits.five_hour) parts.push('5h ' + Math.round(data.rate_limits.five_hour.used_percentage) + '%');
      if (data.rate_limits.seven_day) parts.push('semana ' + Math.round(data.rate_limits.seven_day.used_percentage) + '%');
      if (parts.length) line = 'DevFusion · uso do plano: ' + parts.join(' · ');
    }
  } catch (e) { /* entrada inesperada: só mostra a linha padrão */ }
  process.stdout.write(line);
});
`;

const WindowSchema = z.object({ used_percentage: z.number(), resets_at: z.number().nullable().optional() });
const FileSchema = z.object({
  receivedAt: z.string(),
  rate_limits: z.object({ five_hour: WindowSchema.optional(), seven_day: WindowSchema.optional() }),
});

const SOURCE = 'Statusline oficial do Claude Code · campos rate_limits (recebidos durante sessões no DevFusion)';

/** Como executar o script: Node externo (preferido) ou o próprio Electron em modo Node. */
export interface ScriptRuntime { executable: string; runAsNodeEnv: boolean }

export function shellQuote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error('Caminho inválido para a statusline');
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class ClaudeStatuslineBridge {
  readonly scriptPath: string;
  readonly dataPath: string;
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly dir: string, private readonly runtime: () => ScriptRuntime | null) {
    this.scriptPath = join(dir, 'devfusion-statusline.cjs');
    this.dataPath = join(dir, 'claude-rate-limits.json');
  }

  /** (Re)grava o script; chamado antes de iniciar o Claude. */
  install(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.scriptPath, STATUSLINE_SCRIPT, { mode: 0o644 });
  }

  /** Argumentos oficiais (`--settings`) que acrescentam a statusline do DevFusion à sessão. */
  settingsArgs(): string[] {
    const rt = this.runtime();
    if (!rt) return [];
    this.install();
    const cmd = `${rt.runAsNodeEnv ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${shellQuote(rt.executable)} ${shellQuote(this.scriptPath)} ${shellQuote(this.dataPath)}`;
    return ['--settings', JSON.stringify({ statusLine: { type: 'command', command: cmd, padding: 0 } })];
  }

  read(): ProviderUsage {
    const base: ProviderUsage = {
      provider: 'claude', status: 'no-data', windows: [], plan: null, updatedAt: null, source: SOURCE,
      note: 'Inicie o Claude no DevFusion e envie uma mensagem: os números chegam pela statusline oficial depois da primeira resposta.', extras: {},
    };
    let raw: string;
    try { raw = readFileSync(this.dataPath, 'utf8'); } catch { return base; }
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return { ...base, status: 'error', note: 'Arquivo de uso do Claude ilegível; será substituído na próxima atualização.' }; }
    const parsed = FileSchema.safeParse(json);
    if (!parsed.success) return { ...base, status: 'error', note: 'Arquivo de uso do Claude em formato inesperado.' };
    const rl = parsed.data.rate_limits;
    const mk = (w: z.infer<typeof WindowSchema> | undefined, minutes: number): UsageWindow | null => w
      ? { label: windowLabel(minutes), usedPercent: clampPercent(w.used_percentage), resetsAt: typeof w.resets_at === 'number' ? new Date(w.resets_at * 1000).toISOString() : null, windowMinutes: minutes }
      : null;
    const windows = [mk(rl.five_hour, 300), mk(rl.seven_day, 10080)].filter((w): w is UsageWindow => w !== null);
    return { ...base, status: windows.length ? 'ok' : 'no-data', windows, updatedAt: parsed.data.receivedAt, note: windows.length ? 'Último valor recebido; atualiza quando o Claude responde numa sessão do DevFusion.' : base.note };
  }

  /** Observa o arquivo (fs.watch + verificação periódica como reserva). */
  watch(onChange: () => void, intervalMs = 15_000): void {
    mkdirSync(this.dir, { recursive: true });
    let last = this.mtime();
    const check = () => { const m = this.mtime(); if (m !== last) { last = m; onChange(); } };
    try { this.watcher = watch(this.dir, () => check()); } catch { this.watcher = null; }
    this.timer = setInterval(check, intervalMs);
    this.timer.unref();
  }

  stop(): void { this.watcher?.close(); if (this.timer) clearInterval(this.timer); }

  private mtime(): number { try { return statSync(this.dataPath).mtimeMs; } catch { return 0; } }
}

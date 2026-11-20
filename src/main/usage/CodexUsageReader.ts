import { spawn } from 'node:child_process';
import { z } from 'zod';
import { windowLabel, type ProviderUsage, type UsageWindow } from '@shared/usage';
import { killTree } from '../system/ProcessRunner';

/**
 * Únicos métodos JSON-RPC que o DevFusion envia ao App Server do Codex.
 * Leitura apenas: `account/rateLimitResetCredit/consume` e qualquer outro método ficam de fora.
 */
export const ALLOWED_METHODS = new Set(['initialize', 'initialized', 'account/rateLimits/read']);

const WindowSchema = z.object({ usedPercent: z.number(), windowDurationMins: z.number().nullable().optional(), resetsAt: z.number().nullable().optional() });
const SnapshotSchema = z.object({
  primary: WindowSchema.nullable().optional(),
  secondary: WindowSchema.nullable().optional(),
  planType: z.string().nullable().optional(),
  rateLimitReachedType: z.string().nullable().optional(),
});
const ResponseSchema = z.object({
  rateLimits: SnapshotSchema,
  ordinaryUsageAllowed: z.boolean().nullable().optional(),
  rateLimitResetCredits: z.object({ availableCount: z.number() }).nullable().optional(),
});

export interface CodexReaderOptions {
  codexPath: () => string | null;
  env: () => NodeJS.ProcessEnv;
  timeoutMs?: number;
  now?: () => Date;
}

const SOURCE = 'App Server oficial do Codex · account/rateLimits/read (somente leitura)';

/** Abre um App Server efêmero, lê os limites do plano e encerra. Não conversa com o modelo. */
export async function readCodexUsage(opts: CodexReaderOptions): Promise<ProviderUsage> {
  const base: ProviderUsage = { provider: 'codex', status: 'unavailable', windows: [], plan: null, updatedAt: null, source: SOURCE, note: null, extras: {} };
  const codex = opts.codexPath();
  if (!codex) return { ...base, note: 'Codex não encontrado.' };

  const child = spawn(codex, ['app-server'], { env: opts.env(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  let nextId = 1;
  let buf = '';
  const pending = new Map<number, (m: { result?: unknown; error?: { message?: string } }) => void>();
  type Reply = { result?: unknown; error?: { message?: string } };
  const send = (method: string, params?: unknown, expectReply = true): Promise<Reply> => {
    if (!ALLOWED_METHODS.has(method)) throw new Error(`Método não permitido: ${method}`);
    if (!expectReply) { child.stdin.write(JSON.stringify({ method }) + '\n'); return Promise.resolve({} as Reply); }
    const id = nextId++;
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    return new Promise<Reply>((resolve) => pending.set(id, resolve));
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line) as { id?: number; method?: string; result?: unknown; error?: { message?: string } };
        if (m.id !== undefined && m.method === undefined) { pending.get(m.id)?.(m); pending.delete(m.id); }
        // Requisições do servidor (ex.: aprovações) não são esperadas aqui e ficam sem resposta.
      } catch { /* linha não-JSON */ }
    }
  });
  child.stdin.on('error', () => undefined);
  const spawnError = new Promise<ProviderUsage>((resolve) => child.on('error', (e: NodeJS.ErrnoException) => resolve({ ...base, status: 'error', note: `Não foi possível iniciar o Codex (${e.code ?? 'erro'}).` })));
  const timeout = new Promise<ProviderUsage>((resolve) => setTimeout(() => resolve({ ...base, status: 'error', note: 'Tempo esgotado ao consultar o Codex.' }), opts.timeoutMs ?? 15_000).unref());

  const work = (async (): Promise<ProviderUsage> => {
    const init = await send('initialize', { clientInfo: { name: 'devfusion', title: 'DevFusion', version: '0.1' } });
    if (init.error) return { ...base, status: 'error', note: 'O App Server do Codex recusou a inicialização.' };
    await send('initialized', undefined, false);
    const r = await send('account/rateLimits/read', null);
    if (r.error) {
      const msg = r.error.message ?? '';
      return { ...base, status: /auth|login|sign/i.test(msg) ? 'unavailable' : 'error', note: /auth|login|sign/i.test(msg) ? 'Faça login no Codex para ver o uso do plano.' : 'O Codex não informou o uso do plano.' };
    }
    const parsed = ResponseSchema.safeParse(r.result);
    if (!parsed.success) return { ...base, status: 'error', note: 'Resposta do Codex em formato inesperado (versão da CLI pode ter mudado).' };
    const { rateLimits, ordinaryUsageAllowed, rateLimitResetCredits } = parsed.data;
    const windows: UsageWindow[] = [rateLimits.primary, rateLimits.secondary]
      .filter((w): w is z.infer<typeof WindowSchema> => Boolean(w))
      .map((w) => ({
        label: windowLabel(w.windowDurationMins ?? null),
        usedPercent: clampPercent(w.usedPercent),
        resetsAt: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : null,
        windowMinutes: w.windowDurationMins ?? null,
      }))
      .sort((a, b) => (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0));
    return {
      ...base,
      status: windows.length ? 'ok' : 'no-data',
      windows,
      plan: rateLimits.planType ?? null,
      updatedAt: (opts.now?.() ?? new Date()).toISOString(),
      note: windows.length ? null : 'O Codex não informou janelas de limite para esta conta.',
      extras: {
        resetCreditsAvailable: rateLimitResetCredits?.availableCount ?? 0,
        ordinaryUsageAllowed: ordinaryUsageAllowed ?? null,
        limitReached: rateLimits.rateLimitReachedType ?? null,
      },
    };
  })();

  try {
    return await Promise.race([work, spawnError, timeout]);
  } catch (e) {
    return { ...base, status: 'error', note: `Falha ao consultar o Codex: ${(e as Error).message.slice(0, 120)}` };
  } finally {
    child.stdin.end();
    setTimeout(() => { if (child.exitCode === null) killTree(child.pid); }, 1500).unref();
  }
}

export function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

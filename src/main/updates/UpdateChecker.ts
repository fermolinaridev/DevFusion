import { z } from 'zod';
import { RELEASES_PAGE_PREFIX, UPDATE_REPO, compareSemver, isPrerelease, parseSemver, type AvailableUpdate, type UpdateStatus } from '@shared/updates';

/**
 * Verificação de atualização "só avisar" (decisão do usuário, Fase 8): lê a lista pública de
 * releases do GitHub, compara versões e informa. Nunca baixa nem instala nada; o usuário abre a
 * página da release, baixa o instalador e confere o SHA-256 publicado.
 */
export const DEFAULT_FEED = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=20`;
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const ReleaseSchema = z.object({
  tag_name: z.string().max(100),
  html_url: z.string().max(500),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().max(40).nullable().optional(),
});

export type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>;

export interface UpdateCheckerOptions {
  currentVersion: string;
  fetchJson: FetchJson;
  feedUrl?: string;
  enabled: () => boolean;
  onChange?: (s: UpdateStatus) => void;
  now?: () => Date;
  timeoutMs?: number;
}

export class UpdateChecker {
  private status: UpdateStatus;
  private inFlight: Promise<UpdateStatus> | null = null;
  private lastAttempt = 0;

  constructor(private readonly opts: UpdateCheckerOptions) {
    this.status = { state: opts.enabled() ? 'idle' : 'disabled', currentVersion: opts.currentVersion, latest: null, checkedAt: null, error: null };
  }

  get(): UpdateStatus {
    if (!this.opts.enabled() && this.status.state !== 'disabled') this.set({ state: 'disabled', latest: null, error: null });
    else if (this.opts.enabled() && this.status.state === 'disabled') this.set({ state: 'idle' });
    return this.status;
  }

  /** URL da release disponível (já validada), ou null. */
  availableUrl(): string | null { return this.status.state === 'available' ? this.status.latest?.url ?? null : null; }

  /** Verificação automática: no máximo uma a cada 24 h e só se o usuário não desligou. */
  maybeCheck(): Promise<UpdateStatus> | null {
    if (!this.opts.enabled()) return null;
    if (Date.now() - this.lastAttempt < MIN_INTERVAL_MS && this.lastAttempt !== 0) return null;
    return this.check();
  }

  /** Verificação pedida pelo usuário (ignora o intervalo, respeita a preferência). */
  check(): Promise<UpdateStatus> {
    if (!this.opts.enabled()) return Promise.resolve(this.get());
    if (this.inFlight) return this.inFlight;
    this.lastAttempt = Date.now();
    this.set({ state: 'checking', error: null });
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run(): Promise<UpdateStatus> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 10_000);
    const checkedAt = (this.opts.now?.() ?? new Date()).toISOString();
    try {
      const raw = await this.opts.fetchJson(this.opts.feedUrl ?? DEFAULT_FEED, ctrl.signal);
      const list = z.array(z.unknown()).max(100).parse(raw);
      const latest = pickLatest(list, this.opts.currentVersion);
      return this.set(latest ? { state: 'available', latest, checkedAt, error: null } : { state: 'up-to-date', latest: null, checkedAt, error: null });
    } catch (e) {
      const msg = ctrl.signal.aborted ? 'Tempo esgotado ao consultar o GitHub.' : e instanceof z.ZodError ? 'Resposta inesperada do GitHub.' : `Não foi possível consultar o GitHub (${String((e as Error).message ?? e).slice(0, 120)}).`;
      return this.set({ state: 'error', checkedAt, error: msg });
    } finally {
      clearTimeout(timer);
    }
  }

  private set(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch };
    this.opts.onChange?.(this.status);
    return this.status;
  }
}

/**
 * Escolhe a maior versão publicada acima da atual. Rascunhos são ignorados; pré-releases só
 * contam quando a versão instalada também é pré-release (quem usa a beta recebe a próxima beta).
 * A URL precisa ser da página de release do repositório oficial e bater com a tag.
 */
export function pickLatest(list: readonly unknown[], current: string): AvailableUpdate | null {
  const acceptPre = isPrerelease(current);
  let best: AvailableUpdate | null = null;
  for (const item of list) {
    const r = ReleaseSchema.safeParse(item);
    if (!r.success || r.data.draft) continue;
    const version = r.data.tag_name.replace(/^v/, '');
    if (!parseSemver(version)) continue;
    const pre = r.data.prerelease || isPrerelease(version);
    if (pre && !acceptPre) continue;
    if (r.data.html_url !== `${RELEASES_PAGE_PREFIX}${encodeURIComponent(r.data.tag_name)}`) continue;
    if (compareSemver(version, current) <= 0) continue;
    if (!best || compareSemver(version, best.version) > 0) best = { version, url: r.data.html_url, publishedAt: r.data.published_at ?? null, prerelease: pre };
  }
  return best;
}

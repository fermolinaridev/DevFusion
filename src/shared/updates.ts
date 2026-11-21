/** Repositório oficial cujas releases o app consulta (só leitura, sem login). */
export const UPDATE_REPO = 'fermolinaridev/DevFusion';
export const RELEASES_PAGE_PREFIX = `https://github.com/${UPDATE_REPO}/releases/tag/`;

export interface AvailableUpdate {
  version: string;
  /** Página da release no GitHub (validada: só o repositório oficial). */
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  latest: AvailableUpdate | null;
  checkedAt: string | null;
  /** Mensagem curta e sanitizada quando `state === 'error'`. */
  error: string | null;
}

interface SemVer { major: number; minor: number; patch: number; pre: Array<string | number> }

export function parseSemver(v: string): SemVer | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,64}))?(?:\+[0-9A-Za-z.-]{1,64})?$/.exec(v.trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

/** Comparação SemVer 2.0 (pré-release < release; identificadores numéricos < alfanuméricos). */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a); const y = parseSemver(b);
  if (!x || !y) throw new Error('Versão inválida');
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]; const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export function isPrerelease(v: string): boolean { return (parseSemver(v)?.pre.length ?? 0) > 0; }

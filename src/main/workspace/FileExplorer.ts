import { promises as fsp, realpathSync, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { ExplorerEntry, GitFileKind, GitFileStatus } from '@shared/git';

export class ExplorerError extends Error {}

const MAX_ENTRIES = 2000;
const HIDDEN = new Set(['.git']);

/**
 * Resolve `rel` dentro de `root` e garante que o caminho real (symlinks resolvidos)
 * continue dentro da raiz. Bloqueia "..", caminhos absolutos e symlinks que escapam.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  if (isAbsolute(rel)) throw new ExplorerError('Caminho absoluto não permitido.');
  const realRoot = realpathSync.native(root);
  const target = join(realRoot, rel);
  let real: string;
  try { real = await fsp.realpath(target); } catch { throw new ExplorerError('Arquivo ou pasta não encontrado.'); }
  const r = relative(realRoot, real);
  if (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) throw new ExplorerError('Fora da pasta do workspace (bloqueado).');
  return real;
}

/** Lista um diretório (um nível), pastas primeiro, com o status Git de cada item. */
export async function listDir(root: string, rel: string, status: GitFileStatus[]): Promise<ExplorerEntry[]> {
  const dir = await resolveInside(root, rel);
  const st = await fsp.stat(dir);
  if (!st.isDirectory()) throw new ExplorerError('Não é uma pasta.');
  const realRoot = realpathSync.native(root);
  const byPath = new Map(status.map((f) => [f.path, f.kind]));
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => !HIDDEN.has(e.name)).slice(0, MAX_ENTRIES);
  const out: ExplorerEntry[] = [];
  for (const e of entries) {
    const childRel = relative(realRoot, join(dir, e.name)).split(sep).join('/');
    let type: ExplorerEntry['type'] = e.isDirectory() ? 'dir' : 'file';
    if (e.isSymbolicLink()) {
      // Symlink só é navegável se o destino ficar dentro da raiz.
      try { const real = await resolveInside(root, childRel); type = (await fsp.stat(real)).isDirectory() ? 'dir' : 'file'; } catch { type = 'symlink'; }
    }
    out.push({ name: e.name, rel: childRel, type, status: statusFor(childRel, type, byPath) });
  }
  return out.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
}

function statusFor(rel: string, type: ExplorerEntry['type'], byPath: Map<string, GitFileKind>): GitFileKind | null {
  if (type !== 'dir') return byPath.get(rel) ?? null;
  // Pasta: indica que algo dentro mudou (o tipo mais "forte").
  const prefix = `${rel}/`;
  let found: GitFileKind | null = null;
  for (const [p, k] of byPath) if (p.startsWith(prefix)) { if (k === 'conflicted') return k; found ??= 'modified'; }
  return found;
}

/** Observa uma pasta (recursivo) e avisa com debounce. Ignora o miolo do .git exceto índice/HEAD. */
export function watchTree(root: string, onChange: () => void, debounceMs = 400): () => void {
  let timer: NodeJS.Timeout | null = null;
  let w: FSWatcher | null = null;
  try {
    w = watch(root, { recursive: true }, (_ev, file) => {
      const f = String(file ?? '');
      if (f.startsWith('.git') && !/^\.git[\\/](index|HEAD)$/.test(f)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
  } catch { w = null; }
  return () => { if (timer) clearTimeout(timer); w?.close(); };
}

import { promises as fsp } from 'node:fs';
import { resolveInside, ExplorerError } from './FileExplorer';

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

export interface OpenedFile { content: string; mtimeMs: number; size: number }
export type SaveResult = { status: 'saved'; mtimeMs: number } | { status: 'conflict'; diskMtimeMs: number };

/** Lê um arquivo de texto dentro da raiz (sem symlinks para fora, sem binários, até 2 MB). */
export async function readTextFile(root: string, rel: string): Promise<OpenedFile> {
  const real = await resolveInside(root, rel);
  const st = await fsp.stat(real);
  if (!st.isFile()) throw new ExplorerError('Não é um arquivo.');
  if (st.size > MAX_EDIT_BYTES) throw new ExplorerError(`Arquivo grande demais para o editor (${Math.round(st.size / 1024)} KB; limite ${MAX_EDIT_BYTES / 1024 / 1024} MB).`);
  const buf = await fsp.readFile(real);
  if (buf.subarray(0, 8000).includes(0)) throw new ExplorerError('Arquivo binário: o editor só abre texto.');
  return { content: buf.toString('utf8'), mtimeMs: st.mtimeMs, size: st.size };
}

/**
 * Salva um arquivo existente. Se ele mudou no disco desde a abertura (`expectedMtimeMs`),
 * devolve `conflict` sem escrever — a não ser que o usuário tenha confirmado `overwrite`.
 */
export async function writeTextFile(root: string, rel: string, content: string, expectedMtimeMs: number, overwrite: boolean): Promise<SaveResult> {
  if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) throw new ExplorerError('Conteúdo acima do limite do editor.');
  const real = await resolveInside(root, rel);
  const st = await fsp.stat(real);
  if (!st.isFile()) throw new ExplorerError('Não é um arquivo.');
  if (!overwrite && Math.abs(st.mtimeMs - expectedMtimeMs) > 1) return { status: 'conflict', diskMtimeMs: st.mtimeMs };
  // Grava no mesmo arquivo (preserva permissões e links); escrita direta, sem criar arquivos novos.
  await fsp.writeFile(real, content, 'utf8');
  return { status: 'saved', mtimeMs: (await fsp.stat(real)).mtimeMs };
}

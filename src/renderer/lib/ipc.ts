import type { IpcResult } from '@shared/ipcContracts';

export class IpcError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** Converte o envelope IpcResult em valor ou exceção tipada. */
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p;
  if (r.ok) return r.data;
  throw new IpcError(r.error.code, r.error.message);
}

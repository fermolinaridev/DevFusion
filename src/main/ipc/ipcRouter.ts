import { IPC_ARG_SCHEMAS, type IpcHandlers, type IpcResult } from '@shared/ipcContracts';
import { IPC_CHANNELS, type IpcChannel } from '@shared/ipcChannels';
import type { Logger } from '../logging/logger';

/** Contexto mínimo de quem chamou; desacoplado do Electron para ser testável. */
export interface IpcCallContext {
  isTrustedSender: boolean;
}

/**
 * Despacha uma chamada IPC: canal em allowlist, remetente confiável e argumento
 * validado pelo schema do canal. Erros internos nunca expõem stack ao renderer.
 */
export function createIpcRouter(handlers: IpcHandlers, log: Logger) {
  return async function dispatch(channel: string, ctx: IpcCallContext, rawArg: unknown): Promise<IpcResult<unknown>> {
    if (!(IPC_CHANNELS as readonly string[]).includes(channel)) {
      log.warn('IPC rejeitado: canal fora da allowlist', { channel });
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Canal desconhecido' } };
    }
    if (!ctx.isTrustedSender) {
      log.warn('IPC rejeitado: remetente não confiável', { channel });
      return { ok: false, error: { code: 'FORBIDDEN_SENDER', message: 'Remetente não autorizado' } };
    }
    const ch = channel as IpcChannel;
    const parsed = IPC_ARG_SCHEMAS[ch].safeParse(rawArg);
    if (!parsed.success) {
      log.warn('IPC rejeitado: argumento inválido', { channel, issues: parsed.error.issues.map((i) => i.message) });
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: parsed.error.issues[0]?.message ?? 'Argumento inválido' } };
    }
    try {
      const handler = handlers[ch] as (arg: unknown) => unknown;
      return { ok: true, data: await handler(parsed.data) };
    } catch (e) {
      log.error('Falha no handler IPC', { channel, error: (e as Error).message });
      return { ok: false, error: { code: 'INTERNAL', message: 'Erro interno' } };
    }
  };
}

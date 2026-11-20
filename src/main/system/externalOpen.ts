import { shell } from 'electron';
import type { Logger } from '../logging/logger';

/**
 * Único ponto do app que abre algo fora dele (navegador, gerenciador de arquivos).
 * Nos testes automatizados (`DEVFUSION_SUPPRESS_EXTERNAL_OPEN=1`, ignorada no app empacotado)
 * a abertura só é registrada: no Linux o `xdg-open` iniciaria um navegador real que herda
 * os pipes do Electron e impede o encerramento do processo.
 */
let suppressed = false;
let logger: Logger | null = null;

export function configureExternalOpen(opts: { suppress: boolean; log: Logger }): void {
  suppressed = opts.suppress;
  logger = opts.log;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (suppressed) { logger?.info('Abertura externa suprimida (teste)', { kind: 'url', url: url.slice(0, 200) }); return; }
  await shell.openExternal(url);
}

/** Devolve '' em caso de sucesso, como `shell.openPath`. */
export async function openLocalPath(path: string): Promise<string> {
  if (suppressed) { logger?.info('Abertura externa suprimida (teste)', { kind: 'path' }); return ''; }
  return shell.openPath(path);
}

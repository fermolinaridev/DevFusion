import { ipcMain, type BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import type { IpcHandlers } from '@shared/ipcContracts';
import type { Logger } from '../logging/logger';
import { isTrustedFrame } from '../security/electronSecurity';
import { createIpcRouter } from './ipcRouter';

export function registerIpc(handlers: IpcHandlers, getWindow: () => BrowserWindow | null, log: Logger): void {
  const dispatch = createIpcRouter(handlers, log);
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, (event, arg: unknown) =>
      dispatch(channel, { isTrustedSender: isTrustedFrame(event.senderFrame, getWindow()) }, arg),
    );
  }
}

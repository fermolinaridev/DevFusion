import type { AppInfo, IpcResult } from '../shared/ipcContracts';
import type { Settings } from '../shared/settings';

export interface DevFusionApi {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  settings: {
    getAll(): Promise<IpcResult<Settings>>;
    /** Aceita `unknown` de propósito: o main valida chave e valor. */
    set(key: string, value: unknown): Promise<IpcResult<Settings>>;
  };
}

declare global {
  interface Window {
    readonly devfusion: DevFusionApi;
  }
}

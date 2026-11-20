import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { DevFusionApi } from './api';

// API mínima: cada função usa um canal fixo. O renderer nunca recebe ipcRenderer
// nem consegue escolher canais. A validação dos argumentos acontece no main.
const api: DevFusionApi = Object.freeze({
  app: Object.freeze({
    getInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  }),
  settings: Object.freeze({
    getAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC.settingsSet, { key, value }),
  }),
});

contextBridge.exposeInMainWorld('devfusion', api);

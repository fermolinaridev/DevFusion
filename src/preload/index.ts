import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, IPC_EVENTS, type IpcEvent } from '@shared/ipcChannels';
import type { DevFusionApi } from './api';

// API mínima: cada função usa um canal fixo. O renderer nunca recebe ipcRenderer
// nem consegue escolher canais. A validação dos argumentos acontece no main.
function subscribe<T>(event: IpcEvent, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(event, listener);
  return () => { ipcRenderer.removeListener(event, listener); };
}

const api: DevFusionApi = Object.freeze({
  app: Object.freeze({
    getInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  }),
  settings: Object.freeze({
    getAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC.settingsSet, { key, value }),
  }),
  doctor: Object.freeze({
    getReport: () => ipcRenderer.invoke(IPC.doctorGetReport),
    run: (checks?: unknown) => ipcRenderer.invoke(IPC.doctorRun, checks === undefined ? undefined : { checks }),
    onReport: (cb: (r: never) => void) => subscribe(IPC_EVENTS.doctorReport, cb),
  }),
  installer: Object.freeze({
    getMethods: (dependency: unknown) => ipcRenderer.invoke(IPC.installerGetMethods, { dependency }),
    getState: () => ipcRenderer.invoke(IPC.installerGetState),
    install: (methodId: unknown) => ipcRenderer.invoke(IPC.installerInstall, { methodId }),
    cancel: () => ipcRenderer.invoke(IPC.installerCancel),
    openSource: (methodId: unknown) => ipcRenderer.invoke(IPC.installerOpenSource, { methodId }),
    onState: (cb: (s: never) => void) => subscribe(IPC_EVENTS.installerState, cb),
  }),
  docs: Object.freeze({
    open: (docId: unknown) => ipcRenderer.invoke(IPC.docsOpen, { docId }),
  }),
  workspace: Object.freeze({
    get: () => ipcRenderer.invoke(IPC.workspaceGet),
    choose: () => ipcRenderer.invoke(IPC.workspaceChoose),
  }),
  agents: Object.freeze({
    list: () => ipcRenderer.invoke(IPC.agentsList),
    start: (agent: unknown, kind: unknown, cols: unknown, rows: unknown) => ipcRenderer.invoke(IPC.agentStart, { agent, kind, cols, rows }),
    interrupt: (agent: unknown) => ipcRenderer.invoke(IPC.agentInterrupt, { agent }),
    stop: (agent: unknown) => ipcRenderer.invoke(IPC.agentStop, { agent }),
    stopAll: () => ipcRenderer.invoke(IPC.agentsStopAll),
    onState: (cb: (i: never) => void) => subscribe(IPC_EVENTS.agentState, cb),
  }),
  terminal: Object.freeze({
    write: (agent: unknown, data: unknown) => ipcRenderer.invoke(IPC.terminalWrite, { agent, data }),
    resize: (agent: unknown, cols: unknown, rows: unknown) => ipcRenderer.invoke(IPC.terminalResize, { agent, cols, rows }),
    ack: (agent: unknown, bytes: unknown) => ipcRenderer.invoke(IPC.terminalAck, { agent, bytes }),
    replay: (agent: unknown) => ipcRenderer.invoke(IPC.terminalReplay, { agent }),
    onData: (cb: (p: never) => void) => subscribe(IPC_EVENTS.terminalData, cb),
  }),
} as DevFusionApi);

contextBridge.exposeInMainWorld('devfusion', api);

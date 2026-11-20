// Allowlist de canais IPC. Sem dependências: é importado também pelo preload (sandbox).
export const IPC = {
  appGetInfo: 'app:get-info',
  settingsGetAll: 'settings:get-all',
  settingsSet: 'settings:set',
  doctorGetReport: 'doctor:get-report',
  doctorRun: 'doctor:run',
  installerGetMethods: 'installer:get-methods',
  installerGetState: 'installer:get-state',
  installerInstall: 'installer:install',
  installerCancel: 'installer:cancel',
  installerOpenSource: 'installer:open-source',
  docsOpen: 'docs:open',
  workspaceGet: 'workspace:get',
  workspaceChoose: 'workspace:choose',
  agentsList: 'agents:list',
  agentStart: 'agent:start',
  agentInterrupt: 'agent:interrupt',
  agentStop: 'agent:stop',
  agentsStopAll: 'agents:stop-all',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalAck: 'terminal:ack',
  terminalReplay: 'terminal:replay',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export const IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC);

/** Eventos enviados do main para o renderer (somente leitura no renderer). */
export const IPC_EVENTS = {
  doctorReport: 'event:doctor-report',
  installerState: 'event:installer-state',
  agentState: 'event:agent-state',
  terminalData: 'event:terminal-data',
} as const;
export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

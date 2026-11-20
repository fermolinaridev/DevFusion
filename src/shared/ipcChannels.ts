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
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export const IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC);

/** Eventos enviados do main para o renderer (somente leitura no renderer). */
export const IPC_EVENTS = {
  doctorReport: 'event:doctor-report',
  installerState: 'event:installer-state',
} as const;
export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

// Allowlist de canais IPC. Sem dependências: é importado também pelo preload (sandbox).
export const IPC = {
  appGetInfo: 'app:get-info',
  settingsGetAll: 'settings:get-all',
  settingsSet: 'settings:set',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export const IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC);

import { z } from 'zod';
import { IPC } from './ipcChannels';
import { SETTINGS_SCHEMA, isSettingKey, type Settings } from './settings';

/** Envelope de resposta: erros viajam como dados, sem stack nem detalhes internos. */
export type IpcErrorCode = 'INVALID_ARGUMENT' | 'FORBIDDEN_SENDER' | 'INTERNAL';
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: IpcErrorCode; message: string } };

export const AppInfoSchema = z.object({
  appVersion: z.string(),
  platform: z.enum(['win32', 'darwin', 'linux', 'other']),
  arch: z.string(),
  versions: z.object({ electron: z.string(), chrome: z.string(), node: z.string() }),
  database: z.object({ schemaVersion: z.number().int().nonnegative(), sqliteVersion: z.string() }),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

const settingSetArgs = z
  .object({ key: z.string(), value: z.unknown() })
  .strict()
  .superRefine((arg, ctx) => {
    if (!isSettingKey(arg.key)) {
      ctx.addIssue({ code: 'custom', message: 'Chave de configuração desconhecida' });
      return;
    }
    const parsed = SETTINGS_SCHEMA[arg.key].safeParse(arg.value);
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: `Valor inválido para ${arg.key}` });
  });

/** Schemas de argumento por canal (validados no main). */
export const IPC_ARG_SCHEMAS = {
  [IPC.appGetInfo]: z.undefined(),
  [IPC.settingsGetAll]: z.undefined(),
  [IPC.settingsSet]: settingSetArgs,
} as const;

export interface IpcHandlers {
  [IPC.appGetInfo]: () => AppInfo;
  [IPC.settingsGetAll]: () => Settings;
  [IPC.settingsSet]: (arg: { key: keyof Settings; value: Settings[keyof Settings] }) => Settings;
}

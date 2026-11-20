import { z } from 'zod';

/**
 * Configurações persistidas no SQLite. Cada chave tem schema e valor padrão;
 * chaves fora deste objeto são rejeitadas. Nunca guardar credenciais aqui.
 */
export const SETTINGS_SCHEMA = {
  theme: z.enum(['dark', 'light', 'system']),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMA)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.hasOwn(SETTINGS_SCHEMA, key);
}

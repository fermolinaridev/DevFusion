import { z } from 'zod';

/** Caminho absoluto (POSIX, unidade Windows ou UNC), sem caracteres de controle. */
export const AbsolutePathSchema = z
  .string()
  .min(2)
  .max(1024)
  .refine((p) => !/[\u0000-\u001f]/.test(p), 'Caminho contém caracteres inválidos')
  .refine((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\'), 'Use um caminho absoluto');

/**
 * Configurações persistidas no SQLite. Cada chave tem schema e valor padrão;
 * chaves fora deste objeto são rejeitadas. Nunca guardar credenciais aqui.
 */
export const SETTINGS_SCHEMA = {
  theme: z.enum(['dark', 'light', 'system']),
  onboardingCompleted: z.boolean(),
  /** Caminhos de executáveis escolhidos pelo usuário (têm prioridade sobre o PATH). */
  cliPaths: z
    .object({ git: AbsolutePathSchema.nullable(), claude: AbsolutePathSchema.nullable(), codex: AbsolutePathSchema.nullable() })
    .strict(),
  /** Último workspace aberto (id da tabela workspaces). */
  lastWorkspaceId: z.string().uuid().nullable(),
  /** Rodadas máximas de revisão por tarefa (proteção contra loops). */
  maxReviewRounds: z.number().int().min(1).max(10),
  /** Tamanho da fonte dos terminais e do editor. */
  terminalFontSize: z.number().int().min(10).max(24),
  /** Dias de retenção do histórico do chat (0 = manter sempre). */
  historyRetentionDays: z.number().int().min(0).max(3650),
  /** Notificações do sistema (só com a janela em segundo plano). */
  notifications: z.object({ agentFailed: z.boolean(), installDone: z.boolean(), usageHigh: z.boolean() }).strict(),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMA)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  onboardingCompleted: false,
  cliPaths: { git: null, claude: null, codex: null },
  lastWorkspaceId: null,
  maxReviewRounds: 3,
  terminalFontSize: 13,
  historyRetentionDays: 0,
  notifications: { agentFailed: true, installDone: true, usageHigh: true },
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.hasOwn(SETTINGS_SCHEMA, key);
}

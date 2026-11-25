import { z } from 'zod';
import type { AgentId } from './agentIds';

/** Limite de gasto semanal: quantos pontos percentuais da cota semanal o usuário aceita gastar. */
export const WeeklyBudgetSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Pontos da cota semanal, por provedor, contados a partir de quando o limite foi ligado. */
  percent: z.number().int().min(1).max(100),
}).strict();
export type WeeklyBudgetSettings = z.infer<typeof WeeklyBudgetSettingsSchema>;
export const DEFAULT_WEEKLY_BUDGET: WeeklyBudgetSettings = { enabled: false, percent: 15 };

/** `reached`: gastou tudo. `margin`: o próximo passo, pelo ritmo recente, passaria do limite. */
export type BudgetStop = 'reached' | 'margin';

export interface ProviderBudget {
  /** Uso semanal quando a contagem começou (null = ainda sem leitura). */
  baseline: number | null;
  /** Último uso semanal informado pela fonte oficial. */
  current: number | null;
  /** Pontos gastos desde o começo (continua contando se a semana reiniciar no meio). */
  spent: number;
  stop: BudgetStop | null;
}

export interface BudgetState {
  enabled: boolean;
  percent: number;
  startedAt: string | null;
  providers: Record<AgentId, ProviderBudget>;
}

export const EMPTY_PROVIDER_BUDGET: ProviderBudget = { baseline: null, current: null, spent: 0, stop: null };

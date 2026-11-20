import type { AgentId } from './agentIds';

/** Uma janela de limite do plano (ex.: 5 horas, 7 dias), como informada pela fonte oficial. */
export interface UsageWindow {
  /** Rótulo derivado da duração informada (ex.: "5 horas", "7 dias"). */
  label: string;
  usedPercent: number;
  /** ISO 8601; null quando a fonte não informa. */
  resetsAt: string | null;
  windowMinutes: number | null;
}

export type UsageStatus = 'ok' | 'no-data' | 'unavailable' | 'error' | 'disabled';

export interface ProviderUsage {
  provider: AgentId;
  status: UsageStatus;
  windows: UsageWindow[];
  plan: string | null;
  /** Quando a fonte entregou os números (não quando o app perguntou). */
  updatedAt: string | null;
  /** De onde vêm os números, para exibir com honestidade. */
  source: string;
  /** Explicação curta quando não há dados ou há erro. */
  note: string | null;
  /** Informações extras exibidas, nunca usadas para agir. */
  extras: {
    resetCreditsAvailable?: number;
    /** Codex: o backend permite uso normal incluído no plano (null = desconhecido). */
    ordinaryUsageAllowed?: boolean | null;
    limitReached?: string | null;
  };
}

export interface UsageReport {
  claude: ProviderUsage;
  codex: ProviderUsage;
}

export function windowLabel(minutes: number | null): string {
  if (minutes === null) return 'janela';
  if (minutes === 300) return '5 horas';
  if (minutes === 10080) return 'Semanal (7 dias)';
  if (minutes % 1440 === 0) return `${minutes / 1440} dia(s)`;
  if (minutes % 60 === 0) return `${minutes / 60} hora(s)`;
  return `${minutes} min`;
}

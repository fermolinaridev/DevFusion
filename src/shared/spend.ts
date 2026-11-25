import { CLAUDE_MODELS, CODEX_MODELS, EFFORTS, type Effort, type OrchestratorSettings, type OrchTier, type SpendLevel } from './orchestrator';

/**
 * Nível de gasto e modo Eco do Dev Orchestrator. Só trocam o modelo e o esforço que o orquestrador
 * recebe por classe de tarefa: quem classifica e dispara continua sendo o agente oficial.
 * Nos níveis prontos, "complexa" e "crítica" nunca saem do modelo forte: tarefa difícil usa modelo
 * bom mesmo no nível mais econômico.
 */
type ClaudeSlot = OrchestratorSettings['leadClaude'];
type CodexSlot = OrchestratorSettings['leadCodex'];
type Roster = OrchestratorSettings['roster'];
type Preset = Pick<OrchestratorSettings, 'leadClaude' | 'leadCodex' | 'roster'>;

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';
const LUNA = 'gpt-6-luna';
const SOL = 'gpt-6.2-sol';
const ASTRA = 'gpt-6.2-astra';
const pair = (claude: ClaudeSlot['model'], codex: CodexSlot['model'], effort: Effort) => ({ claude: { model: claude, effort }, codex: { model: codex, effort } });
const preset = (lead: ReturnType<typeof pair>, roster: Roster): Preset => ({ leadClaude: lead.claude, leadCodex: lead.codex, roster });

/** Níveis prontos. "alto" não está aqui: usa o que o usuário define em Configurações. */
const PRESETS: Record<Exclude<SpendLevel, 'alto'>, Preset> = {
  'ultra-baixo': preset(pair(SONNET, SOL, 'medium'), {
    trivial: pair(HAIKU, LUNA, 'low'), rotina: pair(SONNET, SOL, 'low'), complexa: pair(OPUS, ASTRA, 'medium'), critica: pair(OPUS, ASTRA, 'high'),
  }),
  medio: preset(pair(SONNET, SOL, 'high'), {
    trivial: pair(HAIKU, LUNA, 'medium'), rotina: pair(SONNET, SOL, 'medium'), complexa: pair(OPUS, ASTRA, 'medium'), critica: pair(OPUS, ASTRA, 'high'),
  }),
  'muito-alto': preset(pair(OPUS, ASTRA, 'xhigh'), {
    trivial: pair(SONNET, SOL, 'medium'), rotina: pair(OPUS, ASTRA, 'medium'), complexa: pair(OPUS, ASTRA, 'xhigh'), critica: pair(OPUS, ASTRA, 'max'),
  }),
  ultra: preset(pair(OPUS, ASTRA, 'max'), {
    trivial: pair(SONNET, SOL, 'high'), rotina: pair(OPUS, ASTRA, 'high'), complexa: pair(OPUS, ASTRA, 'max'), critica: pair(OPUS, ASTRA, 'max'),
  }),
};

/** Workers simultâneos com o Eco ligado. */
export const ECO_MAX_PARALLEL = 2;

/** Posição do slot: modelo primeiro, esforço depois (as listas vão do mais leve ao mais forte). */
const rank = (models: readonly string[], s: { model: string; effort: Effort }) => models.indexOf(s.model) * EFFORTS.length + EFFORTS.indexOf(s.effort);
export const claudeRank = (s: ClaudeSlot) => rank(CLAUDE_MODELS, s);
export const codexRank = (s: CodexSlot) => rank(CODEX_MODELS, s);

/** O mais leve dos dois: o Eco nunca aumenta o que já estava configurado. */
const lighterClaude = (a: ClaudeSlot, b: ClaudeSlot) => (claudeRank(a) <= claudeRank(b) ? a : b);
const lighterCodex = (a: CodexSlot, b: CodexSlot) => (codexRank(a) <= codexRank(b) ? a : b);

/** Um degrau a menos de esforço, sem descer abaixo de "médio". */
function stepDown<T extends { effort: Effort }>(s: T): T {
  const i = EFFORTS.indexOf(s.effort);
  return i > EFFORTS.indexOf('medium') ? { ...s, effort: EFFORTS[i - 1]! } : s;
}

function applyEco(p: Preset): Preset {
  const eco = PRESETS['ultra-baixo'].roster;
  const light = (t: OrchTier) => ({ claude: lighterClaude(p.roster[t].claude, eco[t].claude), codex: lighterCodex(p.roster[t].codex, eco[t].codex) });
  return {
    leadClaude: stepDown(p.leadClaude),
    leadCodex: stepDown(p.leadCodex),
    roster: {
      trivial: light('trivial'),
      rotina: light('rotina'),
      complexa: { claude: stepDown(p.roster.complexa.claude), codex: stepDown(p.roster.complexa.codex) },
      // Crítica fica intacta: é onde errar custa mais que os tokens economizados.
      critica: p.roster.critica,
    },
  };
}

/**
 * Configuração que vale de fato, depois do nível de gasto e do Eco.
 * Aplicar uma única vez sobre a configuração salva (o Eco não é idempotente).
 */
export function resolveSpend(o: OrchestratorSettings): OrchestratorSettings {
  const base: Preset = o.spend === 'alto' ? { leadClaude: o.leadClaude, leadCodex: o.leadCodex, roster: o.roster } : PRESETS[o.spend];
  const p = o.eco ? applyEco(base) : base;
  return { ...o, ...p, maxParallel: o.eco ? Math.min(o.maxParallel, ECO_MAX_PARALLEL) : o.maxParallel };
}

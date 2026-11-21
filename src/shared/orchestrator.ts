import { z } from 'zod';
import type { AgentId } from './agentIds';

/**
 * Dev Orchestrator (Fase 9): um agente oficial (Claude Code ou Codex) no papel de gerente de
 * projeto distribui tarefas para workers com modelo e esforço escolhidos pela classe da tarefa.
 * O DevFusion só inicia as CLIs com flags documentadas e mostra os workers.
 */
export const ORCH_TIERS = ['trivial', 'rotina', 'complexa', 'critica'] as const;
export type OrchTier = (typeof ORCH_TIERS)[number];
export const TIER_LABEL: Record<OrchTier, string> = { trivial: 'trivial', rotina: 'rotina', complexa: 'complexa', critica: 'crítica' };
export const TIER_HINT: Record<OrchTier, string> = {
  trivial: 'renomear, ajustar texto, rodar e ler testes, perguntas sobre o código',
  rotina: 'bugfix localizado, teste unitário, revisão de diff pequeno',
  complexa: 'feature em vários arquivos, refatoração, revisão de arquitetura',
  critica: 'segurança, migração de dados, mudança difícil de desfazer (sempre com revisão cruzada)',
};

// Modelos conferidos nesta máquina: `claude --model` aceita o nome completo; os do Codex vêm do
// cache de modelos da CLI (`~/.codex/models_cache.json`, 2026-11-21).
export const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'] as const;
export const CODEX_MODELS = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra'] as const;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_LABEL: Record<Effort, string> = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', max: 'máximo' };
export const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-2': 'Fable 5.2',
  'gpt-6-luna': 'GPT-6-Luna', 'gpt-6.1-terra': 'GPT-6.1-Terra', 'gpt-6.2-sol': 'GPT-6.2-Sol', 'gpt-6.2-astra': 'GPT-6.2-Astra',
};
export const modelLabel = (m: string | null) => (m ? MODEL_LABEL[m] ?? m : 'modelo do orquestrador');

const effort = z.enum(EFFORTS);
const claudeSlot = z.object({ model: z.enum(CLAUDE_MODELS), effort }).strict();
const codexSlot = z.object({ model: z.enum(CODEX_MODELS), effort }).strict();
const tierSlot = z.object({ claude: claudeSlot, codex: codexSlot }).strict();

export const OrchestratorSettingsSchema = z.object({
  /** Layout em três colunas (workers Claude | orquestrador | workers Codex). */
  enabled: z.boolean(),
  /** Qual CLI oficial faz o papel de orquestrador. */
  lead: z.enum(['claude', 'codex']),
  leadClaude: claudeSlot,
  leadCodex: codexSlot,
  roster: z.object({ trivial: tierSlot, rotina: tierSlot, complexa: tierSlot, critica: tierSlot }).strict(),
  /** Workers do Codex rodando ao mesmo tempo (o script recusa acima disso). */
  maxParallel: z.number().int().min(1).max(6),
}).strict();
export type OrchestratorSettings = z.infer<typeof OrchestratorSettingsSchema>;

export const DEFAULT_ORCHESTRATOR: OrchestratorSettings = {
  enabled: false,
  lead: 'claude',
  leadClaude: { model: 'claude-opus-5-5', effort: 'high' },
  leadCodex: { model: 'gpt-6.2-astra', effort: 'high' },
  roster: {
    trivial: { claude: { model: 'claude-sonnet-5-5', effort: 'low' }, codex: { model: 'gpt-6.2-sol', effort: 'low' } },
    rotina: { claude: { model: 'claude-sonnet-5-5', effort: 'medium' }, codex: { model: 'gpt-6.2-sol', effort: 'medium' } },
    complexa: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-6.2-astra', effort: 'high' } },
    critica: { claude: { model: 'claude-opus-5-5', effort: 'xhigh' }, codex: { model: 'gpt-6.2-astra', effort: 'xhigh' } },
  },
  maxParallel: 3,
};

export type WorkerStatus = 'running' | 'completed' | 'failed' | 'stopped';

/** Um worker observado (subagente do Claude ou `codex exec`). Só fatos lidos dos eventos. */
export interface WorkerInfo {
  id: string;
  provider: AgentId;
  /** Classe da tarefa (null = subagente fora do roster, ex.: Explore). */
  tier: OrchTier | null;
  /** Tipo do subagente ou "codex exec". */
  name: string;
  model: string | null;
  effort: Effort | null;
  task: string;
  status: WorkerStatus;
  /** Última ação observada (ex.: comando executado pelo Codex). */
  activity: string | null;
  /** Resposta final (ou erro), truncada. */
  output: string | null;
  startedAt: string;
  endedAt: string | null;
  tokens: { input: number; output: number } | null;
  /** Pasta onde o worker do Codex rodou (home abreviado). */
  cwd: string | null;
}

export interface WorkersSnapshot {
  /** Orquestrador em execução e qual CLI. */
  lead: AgentId | null;
  workers: WorkerInfo[];
}

export const WorkerStopArgsSchema = z.object({ id: z.string().regex(/^codex-\d+-\d+$/) }).strict();

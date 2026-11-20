import type { CliAgentConfig } from './CliAgentAdapter';

/** Codex: CLI oficial; App Server validado na Fase 0, mas desativado por padrão. */
export const CODEX_CONFIG: CliAgentConfig = {
  id: 'codex',
  name: 'Codex',
  tool: 'codex',
  agentArgs: [],
  loginArgs: ['login'],
  capabilities: {
    interactive: true,
    automatable: false,
    structuredEvents: false,
    automationNote: 'Automação desativada por padrão: o App Server funciona com a conta ChatGPT, mas é experimental e depende da sua decisão (Fase 4). Uso pelo terminal oficial.',
  },
};

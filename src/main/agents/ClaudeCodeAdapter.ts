import type { CliAgentConfig } from './CliAgentAdapter';

/** Claude Code: binário oficial não modificado; login pelo próprio usuário (Fase 0). */
export const CLAUDE_CONFIG: CliAgentConfig = {
  id: 'claude',
  name: 'Claude Code',
  tool: 'claude',
  agentArgs: [],
  loginArgs: ['auth', 'login'],
  // `plan`: modo de planejamento (somente leitura) listado em `claude --help`.
  permissionArgs: { 'cli-default': [], 'read-only': ['--permission-mode', 'plan'] },
  capabilities: {
    interactive: true,
    automatable: false,
    structuredEvents: false,
    automationNote: 'Automação bloqueada: os termos da Anthropic não permitem que apps de terceiros ofereçam o login claude.ai. Uso pelo terminal oficial, com encaminhamento manual.',
  },
};

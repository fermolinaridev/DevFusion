export const AGENT_IDS = ['claude', 'codex'] as const;
export type AgentId = (typeof AGENT_IDS)[number];
export const AGENT_NAMES: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex' };

import type { AgentId } from '@shared/agentIds';

/**
 * Integração opcional com o ai-memory (github.com/akitaonrails/ai-memory): inicia o agente por
 * `ai-memory run`, que retoma a mesma "workstream" entre Claude Code e Codex.
 * Flags verificadas no código do ai-memory 3.5 (`RunArgs`): as do wrapper vêm antes do nome do
 * agente; o resto é repassado sem alteração ao agente.
 * - `--executable`: usa exatamente o binário que o System Doctor validou;
 * - `--no-exit-prompt`: sem isso, ao fechar o agente o ai-memory mostra um menu e o processo
 *   não termina — o DevFusion depende do fim do processo para encerrar a sessão.
 */
const HARNESS: Record<AgentId, string> = { claude: 'claude', codex: 'codex' };

export function aiMemoryRunCommand(aiMemoryPath: string, agent: AgentId, agentExe: string, nativeArgs: readonly string[]): { file: string; args: string[]; display: string[] } {
  return {
    file: aiMemoryPath,
    args: ['run', '--no-exit-prompt', '--executable', agentExe, HARNESS[agent], ...nativeArgs],
    display: ['ai-memory', 'run', HARNESS[agent]],
  };
}

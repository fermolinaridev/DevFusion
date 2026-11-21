import type { DocId, InstallableDependency } from '@shared/doctor';
import type { ToolName } from './PlatformDetector';

/** Páginas oficiais (allowlist usada também pelo botão "Ver instruções"). */
export const DOC_URLS: Record<DocId, string> = {
  'claude-setup': 'https://code.claude.com/docs/en/setup',
  'claude-auth': 'https://code.claude.com/docs/en/iam',
  'codex-cli': 'https://developers.openai.com/codex/cli',
  'codex-auth': 'https://developers.openai.com/codex/auth',
  'git-download': 'https://git-scm.com/downloads',
  'node-download': 'https://nodejs.org/en/download',
  'ai-memory': 'https://github.com/akitaonrails/ai-memory#quick-start',
};

export interface CatalogEntry {
  id: string;
  dependency: InstallableDependency;
  platforms: NodeJS.Platform[];
  title: string;
  sourceUrl: string;
  /** Gerenciador de pacotes e argumentos fixos. Null => método só por instrução oficial. */
  command: { tool: ToolName; args: string[] } | null;
  /** Texto do comando quando é só instrução (ex.: script remoto, que nunca é executado pelo app). */
  manualCommand?: string;
  permissions: string;
  requires?: { tool: ToolName; minMajor?: number; reason: string };
  notes: string[];
}

const PERM_BREW = 'Executado com o seu usuário, sem elevação pelo DevFusion. Se o Homebrew pedir senha, a instalação falhará e você poderá rodar o comando no seu terminal.';
const PERM_WINGET = 'O próprio Windows pode pedir permissão (UAC) para o instalador; o DevFusion não solicita elevação.';
const PERM_NPM = 'Instala no diretório global do npm. Se ele exigir administrador (EACCES), a instalação falhará; o DevFusion nunca usa sudo.';
const PERM_MANUAL = 'Não é executado pelo DevFusion: o app apenas abre a página oficial.';
const AI_MEMORY_SETUP_NOTE = 'Depois de instalar, rode `ai-memory setup` no seu terminal: ele cria o serviço local e o token e mostra o plano antes de alterar as configurações do Claude Code e do Codex.';
const REMOTE_SCRIPT_NOTE = 'Scripts baixados da internet não são executados automaticamente pelo DevFusion. Revise a página oficial e rode no seu terminal, se quiser.';

/**
 * Métodos de instalação documentados pelos fornecedores (pesquisados na Fase 0/2).
 * Execução automática somente via gerenciador de pacotes com argumentos fixos.
 */
export const INSTALL_CATALOG: readonly CatalogEntry[] = [
  // ---------------------------------------------------------------- Claude Code (code.claude.com/docs/en/setup)
  {
    id: 'claude-winget', dependency: 'claude', platforms: ['win32'], title: 'WinGet',
    sourceUrl: DOC_URLS['claude-setup'], command: { tool: 'winget', args: ['install', 'Anthropic.ClaudeCode'] },
    permissions: PERM_WINGET, notes: ['Instalações via WinGet não se atualizam sozinhas.', 'Se o WinGet pedir para aceitar termos da fonte, a instalação falhará aqui; rode o comando no seu terminal para ler e aceitar.'],
  },
  {
    id: 'claude-brew', dependency: 'claude', platforms: ['darwin', 'linux'], title: 'Homebrew',
    sourceUrl: DOC_URLS['claude-setup'], command: { tool: 'brew', args: ['install', '--cask', 'claude-code'] },
    permissions: PERM_BREW, notes: ['Instalações via Homebrew não se atualizam sozinhas.'],
  },
  {
    id: 'claude-npm', dependency: 'claude', platforms: ['win32', 'darwin', 'linux'], title: 'npm',
    sourceUrl: DOC_URLS['claude-setup'], command: { tool: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'] },
    permissions: PERM_NPM, requires: { tool: 'node', minMajor: 22, reason: 'O pacote npm do Claude Code requer Node.js 22 ou mais recente.' },
    notes: ['Não use sudo com este comando.'],
  },
  {
    id: 'claude-script-posix', dependency: 'claude', platforms: ['darwin', 'linux'], title: 'Instalador nativo (script oficial)',
    sourceUrl: DOC_URLS['claude-setup'], command: null, manualCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    permissions: PERM_MANUAL, notes: ['Método recomendado pela Anthropic; atualiza sozinho em segundo plano.', REMOTE_SCRIPT_NOTE],
  },
  {
    id: 'claude-script-windows', dependency: 'claude', platforms: ['win32'], title: 'Instalador nativo (PowerShell)',
    sourceUrl: DOC_URLS['claude-setup'], command: null, manualCommand: 'irm https://claude.ai/install.ps1 | iex',
    permissions: PERM_MANUAL, notes: ['Método recomendado pela Anthropic; atualiza sozinho em segundo plano.', REMOTE_SCRIPT_NOTE],
  },
  // ---------------------------------------------------------------- Codex (github.com/openai/codex, developers.openai.com/codex)
  {
    id: 'codex-npm', dependency: 'codex', platforms: ['win32', 'darwin', 'linux'], title: 'npm',
    sourceUrl: DOC_URLS['codex-cli'], command: { tool: 'npm', args: ['install', '-g', '@openai/codex'] },
    permissions: PERM_NPM, requires: { tool: 'node', reason: 'A instalação via npm precisa de Node.js.' }, notes: [],
  },
  {
    id: 'codex-brew', dependency: 'codex', platforms: ['darwin'], title: 'Homebrew',
    sourceUrl: DOC_URLS['codex-cli'], command: { tool: 'brew', args: ['install', '--cask', 'codex'] },
    permissions: PERM_BREW, notes: [],
  },
  {
    id: 'codex-script-posix', dependency: 'codex', platforms: ['darwin', 'linux'], title: 'Instalador oficial (script)',
    sourceUrl: DOC_URLS['codex-cli'], command: null, manualCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    permissions: PERM_MANUAL, notes: [REMOTE_SCRIPT_NOTE],
  },
  {
    id: 'codex-script-windows', dependency: 'codex', platforms: ['win32'], title: 'Instalador oficial (PowerShell)',
    sourceUrl: DOC_URLS['codex-cli'], command: null, manualCommand: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
    permissions: PERM_MANUAL, notes: [REMOTE_SCRIPT_NOTE],
  },
  // ---------------------------------------------------------------- Git (git-scm.com/downloads)
  {
    id: 'git-winget', dependency: 'git', platforms: ['win32'], title: 'WinGet',
    sourceUrl: 'https://git-scm.com/downloads/win', command: { tool: 'winget', args: ['install', '--id', 'Git.Git', '-e', '--source', 'winget'] },
    permissions: PERM_WINGET, notes: ['Após instalar, pode ser necessário reiniciar o DevFusion para o PATH ser atualizado.'],
  },
  {
    id: 'git-brew', dependency: 'git', platforms: ['darwin'], title: 'Homebrew',
    sourceUrl: 'https://git-scm.com/downloads/mac', command: { tool: 'brew', args: ['install', 'git'] },
    permissions: PERM_BREW, notes: [],
  },
  {
    id: 'git-manual', dependency: 'git', platforms: ['win32', 'darwin', 'linux'], title: 'Página oficial do Git',
    sourceUrl: DOC_URLS['git-download'], command: null,
    permissions: PERM_MANUAL, notes: ['No Linux, use o gerenciador de pacotes da sua distribuição (exige administrador; o DevFusion não eleva privilégios).'],
  },
  // ---------------------------------------------------------------- Node.js
  {
    id: 'node-brew', dependency: 'node', platforms: ['darwin', 'linux'], title: 'Homebrew',
    sourceUrl: 'https://formulae.brew.sh/formula/node', command: { tool: 'brew', args: ['install', 'node'] },
    permissions: PERM_BREW, notes: [],
  },
  {
    id: 'node-manual', dependency: 'node', platforms: ['win32', 'darwin', 'linux'], title: 'Página oficial do Node.js',
    sourceUrl: DOC_URLS['node-download'], command: null,
    permissions: PERM_MANUAL, notes: [],
  },
  // ---------------------------------------------------------------- ai-memory (github.com/akitaonrails/ai-memory) — opcional
  {
    id: 'ai-memory-brew', dependency: 'ai-memory', platforms: ['darwin', 'linux'], title: 'Homebrew (tap oficial do projeto)',
    sourceUrl: DOC_URLS['ai-memory'], command: { tool: 'brew', args: ['install', 'akitaonrails/tap/ai-memory'] },
    permissions: PERM_BREW, notes: [AI_MEMORY_SETUP_NOTE],
  },
  {
    id: 'ai-memory-script-posix', dependency: 'ai-memory', platforms: ['darwin', 'linux'], title: 'Instalador oficial (script)',
    sourceUrl: DOC_URLS['ai-memory'], command: null, manualCommand: 'curl -fsSL https://github.com/akitaonrails/ai-memory/releases/latest/download/install.sh | sh',
    permissions: PERM_MANUAL, notes: ['O script confere o SHA-256 da release antes de instalar em ~/.local/bin.', REMOTE_SCRIPT_NOTE, AI_MEMORY_SETUP_NOTE],
  },
  {
    id: 'ai-memory-script-windows', dependency: 'ai-memory', platforms: ['win32'], title: 'Instalador oficial (PowerShell)',
    sourceUrl: DOC_URLS['ai-memory'], command: null, manualCommand: 'irm https://github.com/akitaonrails/ai-memory/releases/latest/download/install.ps1 | iex',
    permissions: PERM_MANUAL, notes: ['Suporte nativo ao Windows é experimental no ai-memory (WSL2 é o recomendado pelo projeto).', REMOTE_SCRIPT_NOTE, AI_MEMORY_SETUP_NOTE],
  },
];

export function commandDisplay(entry: CatalogEntry): string | null {
  if (entry.command) return [entry.command.tool, ...entry.command.args].join(' ');
  return entry.manualCommand ?? null;
}

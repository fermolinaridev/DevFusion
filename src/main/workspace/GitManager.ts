import type { CommandRunner } from '../system/ProcessRunner';

/** Arquivos que nunca entram em conteúdo enviado a um agente. */
export const SENSITIVE_PATHSPECS = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/id_rsa*', '**/id_ed25519*', '**/.npmrc', '**/.netrc', '**/*credentials*', '**/*secret*',
];
const SENSITIVE_RE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519).*|\.npmrc|\.netrc|.*credentials.*|.*secret.*)$/i;

/** Padrões comuns de segredo; um acerto gera aviso (o usuário decide). */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/, 'chave de API (sk-…)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token do GitHub'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'token do Slack'],
  [/\b(password|passwd|senha|api[_-]?key|secret)\s*[:=]\s*['"][^'"\s]{6,}['"]/i, 'atribuição de senha/segredo'],
];

export interface ReviewSnapshot {
  isRepo: boolean;
  text: string;
  warnings: string[];
}

/** Leitura do estado do repositório para revisão. Nunca altera o repositório. */
export class GitManager {
  constructor(private readonly run: CommandRunner, private readonly gitPath: () => string | null, private readonly env: () => NodeJS.ProcessEnv, private readonly maxChars = 40_000) {}

  /**
   * Snapshot para revisão. Sem `base`: alterações preparadas e não preparadas da pasta.
   * Com `base` (worktree): tudo que mudou desde o commit base (commits do branch + não commitado).
   */
  async reviewSnapshot(workspace: string, base?: string): Promise<ReviewSnapshot> {
    const git = this.gitPath();
    if (!git) return { isRepo: false, text: '', warnings: ['Git não encontrado: a revisão vai sem diff; o revisor deve olhar os arquivos diretamente.'] };
    const g = (args: string[]) => this.run(git, ['-C', workspace, ...args], { env: this.env(), timeoutMs: 15_000, maxOutputBytes: 2 * 1024 * 1024 });
    const inside = await g(['rev-parse', '--is-inside-work-tree']);
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return { isRepo: false, text: '', warnings: ['O workspace não é um repositório Git: a revisão vai sem diff.'] };

    const exclude = SENSITIVE_PATHSPECS.map((p) => `:(exclude,glob)${p}`);
    const [status, staged, unstaged] = await Promise.all([
      g(['status', '--porcelain=v1', '--untracked-files=all']),
      base ? g(['diff', '--no-color', '--no-ext-diff', base, '--', '.', ...exclude]) : g(['diff', '--cached', '--no-color', '--no-ext-diff', '--', '.', ...exclude]),
      base ? Promise.resolve({ stdout: '' }) : g(['diff', '--no-color', '--no-ext-diff', '--', '.', ...exclude]),
    ]);
    const warnings: string[] = [];
    const statusLines = status.stdout.split('\n').filter(Boolean);
    const omitted = statusLines.map((l) => l.slice(3)).filter((f) => SENSITIVE_RE.test(f));
    if (omitted.length) warnings.push(`Arquivos sensíveis omitidos do diff: ${omitted.join(', ')}.`);
    const untracked = statusLines.filter((l) => l.startsWith('??')).length;
    if (untracked) warnings.push(`${untracked} arquivo(s) novo(s) não rastreado(s) aparecem só pelo nome; o revisor deve abri-los no workspace.`);

    let diff = base
      ? (staged.stdout ? `# Alterações desde a base ${base.slice(0, 10)} (commits do branch + não commitado)\n${staged.stdout}` : '')
      : [staged.stdout && `# Alterações preparadas (staged)\n${staged.stdout}`, unstaged.stdout && `# Alterações não preparadas\n${unstaged.stdout}`].filter(Boolean).join('\n');
    if (!diff && (base || statusLines.length === 0)) warnings.push('Nenhuma alteração detectada no Git.');
    if (diff.length > this.maxChars) {
      diff = `${diff.slice(0, this.maxChars)}\n… [diff truncado em ${this.maxChars} caracteres]`;
      warnings.push(`Diff grande: truncado em ${this.maxChars} caracteres.`);
    }
    const found = SECRET_PATTERNS.filter(([re]) => re.test(diff)).map(([, label]) => label);
    // A saída dos processos já passa por redact(): chaves/tokens/e-mails viram marcadores.
    if (/<api-key>|<jwt>|<redigido>/.test(diff)) found.push('chave de API ou token já mascarado');
    if (found.length) warnings.push(`Possível segredo no diff (${[...new Set(found)].join(', ')}). Revise antes de enviar a outro provedor.`);
    if (/<email>|<uuid>/.test(diff)) warnings.push('E-mails e UUIDs do diff foram mascarados (<email>, <uuid>) por privacidade.');

    const text = [`Status do Git:\n${statusLines.filter((l) => !SENSITIVE_RE.test(l.slice(3))).join('\n') || '(limpo)'}`, diff ? `Diff:\n\`\`\`diff\n${diff}\n\`\`\`` : ''].filter(Boolean).join('\n\n');
    return { isRepo: true, text, warnings };
  }
}

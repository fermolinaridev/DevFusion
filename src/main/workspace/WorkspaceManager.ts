import { constants, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, parse } from 'node:path';
import type { WorkspaceInfo } from '@shared/agents';
import type { WorkspaceRepository } from '../database/repositories/WorkspaceRepository';
import type { PlatformDetector } from '../system/PlatformDetector';
import type { CommandRunner } from '../system/ProcessRunner';

export class WorkspaceError extends Error {}

/**
 * Valida e mantém o workspace atual. Nunca inicializa repositório Git nem altera arquivos:
 * apenas lê o estado (é repositório? qual branch?).
 */
export class WorkspaceManager {
  private current: { id: string; path: string; name: string } | null = null;

  constructor(private readonly repo: WorkspaceRepository, private readonly detector: PlatformDetector, private readonly run: CommandRunner, private readonly gitPath: () => string | null) {}

  currentPath(): string | null { return this.current?.path ?? null; }
  currentId(): string | null { return this.current?.id ?? null; }

  /** Valida o caminho escolhido e torna-o atual. Lança WorkspaceError com mensagem para o usuário. */
  async open(rawPath: string): Promise<WorkspaceInfo> {
    const real = await validateWorkspacePath(rawPath);
    const row = this.repo.upsert(real, basename(real) || real);
    this.repo.touch(row.id);
    this.current = { id: row.id, path: row.path, name: row.name };
    return this.info();
  }

  /** Restaura pelo id salvo; se o caminho não for mais válido, não abre nada. */
  async restore(id: string | null): Promise<WorkspaceInfo | null> {
    if (!id) return null;
    const row = this.repo.byId(id);
    if (!row) return null;
    try { return await this.open(row.path); } catch { this.current = null; return null; }
  }

  async info(): Promise<WorkspaceInfo> {
    if (!this.current) throw new WorkspaceError('Nenhum workspace aberto.');
    return { id: this.current.id, name: this.current.name, displayPath: this.detector.shortenHome(this.current.path), git: await this.gitState(this.current.path) };
  }

  private async gitState(path: string): Promise<WorkspaceInfo['git']> {
    const git = this.gitPath();
    if (!git) return { isRepo: false, branch: null };
    const env = this.detector.childEnv();
    const inside = await this.run(git, ['-C', path, 'rev-parse', '--is-inside-work-tree'], { env, timeoutMs: 5000 });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return { isRepo: false, branch: null };
    // symbolic-ref funciona também em repositório sem commits; falha só com HEAD destacado.
    const branch = await this.run(git, ['-C', path, 'symbolic-ref', '--short', '-q', 'HEAD'], { env, timeoutMs: 5000 });
    if (branch.exitCode === 0 && branch.stdout.trim()) return { isRepo: true, branch: branch.stdout.trim() };
    return { isRepo: true, branch: '(HEAD destacado)' };
  }
}

/** Caminho real (symlinks resolvidos), diretório existente, leitura e escrita, não é raiz do disco. */
export async function validateWorkspacePath(rawPath: string): Promise<string> {
  let real: string;
  try { real = await fsp.realpath(rawPath); } catch { throw new WorkspaceError('A pasta não existe ou não pode ser acessada.'); }
  const st = await fsp.stat(real);
  if (!st.isDirectory()) throw new WorkspaceError('O caminho escolhido não é uma pasta.');
  if (parse(real).root === real) throw new WorkspaceError('Escolha uma pasta de projeto, não a raiz do disco.');
  if (real === homedir()) throw new WorkspaceError('Escolha uma pasta de projeto, não a pasta pessoal inteira.');
  try { await fsp.access(real, constants.R_OK | constants.W_OK); } catch { throw new WorkspaceError('Sem permissão de leitura e escrita nesta pasta.'); }
  return real;
}

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '@shared/agents';
import type { GitFileKind, GitFileStatus, MergeCheck, RepoStatus, WorktreeCreatePreview, WorktreeInfo } from '@shared/git';
import type { WorktreeRepository, WorktreeRow } from '../database/repositories/WorktreeRepository';
import type { CommandRunner, RunResult } from '../system/ProcessRunner';
import { promises as fsp } from 'node:fs';
import { relative as relPath, sep } from 'node:path';
import { resolveInside } from './FileExplorer';
import { SENSITIVE_PATHSPECS } from './GitManager';

export class GitOpError extends Error {}

export interface WorktreeManagerDeps {
  run: CommandRunner;
  gitPath: () => string | null;
  env: () => NodeJS.ProcessEnv;
  repo: WorktreeRepository;
  /** Pasta do app onde os worktrees são criados (fora do projeto). */
  worktreesDir: string;
  shorten: (p: string) => string;
  audit: (action: string, target: string, metadata: Record<string, unknown>) => void;
}

type Ws = { id: string; path: string };
const EXCLUDE = SENSITIVE_PATHSPECS.map((p) => `:(exclude,glob)${p}`);

/**
 * Worktrees por tarefa/agente. Toda mutação passa por aqui e é auditada; quem pede
 * confirmação ao usuário é o chamador (diálogo nativo no main).
 */
export class WorktreeManager {
  constructor(private readonly d: WorktreeManagerDeps) {}

  private async git(cwd: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
    const git = this.d.gitPath();
    if (!git) throw new GitOpError('Git não encontrado. Configure o caminho no System Doctor.');
    return this.d.run(git, ['-C', cwd, ...args], { env: { ...this.d.env(), GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }, timeoutMs, raw: true, maxOutputBytes: 4 * 1024 * 1024 });
  }

  private async must(cwd: string, args: string[], what: string): Promise<string> {
    const r = await this.git(cwd, args);
    if (r.exitCode !== 0) throw new GitOpError(`${what}: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ').slice(0, 300) || `código ${r.exitCode}`}`);
    return r.stdout;
  }

  // ---------------------------------------------------------------- leitura

  async status(path: string): Promise<RepoStatus> {
    const empty: RepoStatus = { isRepo: false, hasCommits: false, branch: null, headSha: null, branches: [], clean: true, files: [] };
    if (!this.d.gitPath()) return empty;
    const inside = await this.git(path, ['rev-parse', '--is-inside-work-tree']);
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return empty;
    const [head, branch, branches, st] = await Promise.all([
      this.git(path, ['rev-parse', '--short', 'HEAD']),
      this.git(path, ['symbolic-ref', '--short', '-q', 'HEAD']),
      this.git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      this.git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ]);
    const files = parsePorcelainZ(st.stdout);
    return {
      isRepo: true,
      hasCommits: head.exitCode === 0,
      branch: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
      headSha: head.exitCode === 0 ? head.stdout.trim() : null,
      branches: branches.stdout.split('\n').map((b) => b.trim()).filter(Boolean),
      clean: files.length === 0,
      files,
    };
  }

  async previewCreate(ws: Ws, name: string, baseRef: string): Promise<WorktreeCreatePreview> {
    const st = await this.status(ws.path);
    if (!st.isRepo) throw new GitOpError('O workspace não é um repositório Git. O DevFusion não inicializa repositórios por conta própria.');
    if (!st.hasCommits) throw new GitOpError('O repositório ainda não tem commits; faça o primeiro commit antes de criar worktrees.');
    const sha = await this.resolveCommit(ws.path, baseRef);
    const suffix = randomBytes(2).toString('hex');
    const branch = `devfusion/${name}-${suffix}`;
    const path = join(this.d.worktreesDir, ws.id, `${name}-${suffix}`);
    return {
      branch, displayPath: this.d.shorten(path), baseRef, baseSha: sha, rootUncommitted: st.files.length,
      commands: [`git worktree add -b ${branch} ${this.d.shorten(path)} ${sha.slice(0, 10)}`],
    };
  }

  async create(ws: Ws, plan: WorktreeCreatePreview, meta: { name: string; agent: AgentId | null; taskId: string | null }): Promise<WorktreeInfo> {
    const exists = await this.git(ws.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${plan.branch}`]);
    if (exists.exitCode === 0) throw new GitOpError(`O branch ${plan.branch} já existe.`);
    const path = join(this.d.worktreesDir, ws.id, plan.branch.slice('devfusion/'.length));
    mkdirSync(join(this.d.worktreesDir, ws.id), { recursive: true });
    await this.must(ws.path, ['worktree', 'add', '-b', plan.branch, path, plan.baseSha], 'Falha ao criar o worktree');
    const now = new Date().toISOString();
    const row: WorktreeRow = {
      id: randomUUID(), workspace_id: ws.id, name: meta.name, path: realpathSync(path), branch: plan.branch, base_ref: plan.baseRef, base_sha: plan.baseSha,
      agent: meta.agent, task_id: meta.taskId, status: 'active', merged_sha: null, pre_merge_sha: null, created_at: now, updated_at: now,
    };
    this.d.repo.insert(row);
    this.d.audit('worktree.create', row.id, { branch: row.branch, base: row.base_sha.slice(0, 12), taskId: row.task_id });
    return this.info(ws, row);
  }

  async list(ws: Ws): Promise<WorktreeInfo[]> {
    return Promise.all(this.d.repo.list(ws.id).map((r) => this.info(ws, r)));
  }

  async get(ws: Ws, id: string): Promise<WorktreeInfo> { return this.info(ws, this.row(ws, id)); }

  /** Caminho de um worktree ativo do workspace (para iniciar agentes nele). */
  activePath(ws: Ws, id: string): string {
    const r = this.row(ws, id);
    if (r.status === 'removed') throw new GitOpError('Este worktree foi removido.');
    return r.path;
  }

  baseOf(ws: Ws, id: string): { path: string; baseSha: string } {
    const r = this.row(ws, id);
    return { path: r.path, baseSha: r.base_sha };
  }

  async files(ws: Ws, id: string): Promise<GitFileStatus[]> {
    const r = this.row(ws, id);
    const [diff, st] = await Promise.all([
      this.git(r.path, ['diff', '--name-status', '-z', r.base_sha]),
      this.git(r.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ]);
    const map = new Map<string, GitFileStatus>();
    const parts = diff.stdout.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i]!;
      if (code.startsWith('R') || code.startsWith('C')) { const to = parts[i + 2]!; map.set(to, { path: to, kind: 'renamed', code: 'R' }); i += 2; continue; }
      const path = parts[++i]!;
      map.set(path, { path, kind: kindOf(code === 'A' ? 'A ' : code === 'D' ? 'D ' : 'M '), code });
    }
    for (const f of parsePorcelainZ(st.stdout)) if (f.kind === 'untracked' || f.kind === 'conflicted') map.set(f.path, f);
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async commit(ws: Ws, id: string, message: string): Promise<string> {
    const r = this.activeRow(ws, id);
    await this.must(r.path, ['add', '-A', '--', '.', ...EXCLUDE], 'Falha ao preparar arquivos');
    const staged = await this.git(r.path, ['diff', '--cached', '--quiet']);
    if (staged.exitCode === 0) throw new GitOpError('Nada para commitar (arquivos sensíveis como .env nunca são adicionados pelo app).');
    // Hooks do repositório (pre-commit etc.) rodam normalmente: o app não contorna regras do projeto.
    const c = await this.git(r.path, ['commit', '-m', message], 180_000);
    if (c.exitCode !== 0) throw new GitOpError(`Falha no commit: ${(c.stderr || c.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);
    const sha = (await this.must(r.path, ['rev-parse', 'HEAD'], 'Falha ao ler o commit')).trim();
    this.d.audit('worktree.commit', id, { sha: sha.slice(0, 12) });
    return sha;
  }

  /** Diff de um arquivo para exibição local (somente leitura). Arquivo novo: conteúdo como adição. */
  async fileDiff(root: string, rel: string, base: string | null): Promise<string> {
    const real = await resolveInside(root, rel);
    const relNorm = relPath(realpathSync(root), real).split(sep).join('/');
    const tracked = await this.git(root, ['ls-files', '--error-unmatch', '--', relNorm]);
    if (tracked.exitCode !== 0) {
      const st = await fsp.stat(real);
      if (st.size > 200_000) return `(arquivo novo com ${Math.round(st.size / 1024)} KB: grande demais para exibir)`;
      const content = await fsp.readFile(real, 'utf8');
      return `Arquivo novo (não rastreado): ${relNorm}\n` + content.split('\n').map((l) => `+${l}`).join('\n');
    }
    const d = await this.git(root, ['diff', '--no-color', '--no-ext-diff', base ?? 'HEAD', '--', relNorm]);
    const text = d.stdout.length > 200_000 ? `${d.stdout.slice(0, 200_000)}\n… [truncado]` : d.stdout;
    return text || 'Sem alterações neste arquivo.';
  }

  // ---------------------------------------------------------------- integração

  async checkMerge(ws: Ws, id: string): Promise<MergeCheck> {
    const r = this.row(ws, id);
    const root = await this.status(ws.path);
    const info = await this.info(ws, r);
    const blockers: string[] = [];
    if (r.status !== 'active') blockers.push('Este worktree não está ativo.');
    if (!info.present) blockers.push('A pasta do worktree não existe mais.');
    if (!root.branch) blockers.push('A raiz está em HEAD destacado; faça checkout de um branch para integrar.');
    if (!root.clean) blockers.push(`A raiz tem ${root.files.length} arquivo(s) com alterações não commitadas; faça commit ou guarde antes de integrar.`);
    if (info.uncommitted > 0) blockers.push(`O worktree tem ${info.uncommitted} arquivo(s) não commitado(s); faça commit antes de integrar.`);
    if (info.ahead === 0) blockers.push('Não há commits novos no worktree para integrar.');
    let conflicts: string[] = [];
    if (root.branch && info.present && info.ahead > 0) {
      const mt = await this.git(ws.path, ['merge-tree', '--write-tree', '--name-only', '--no-messages', root.branch, r.branch]);
      if (mt.exitCode === 1) conflicts = mt.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
      else if (mt.exitCode !== 0) blockers.push('Não foi possível verificar conflitos (git merge-tree falhou).');
    }
    return { targetBranch: root.branch, conflicts, blockers, canMerge: blockers.length === 0 && conflicts.length === 0 };
  }

  async merge(ws: Ws, id: string): Promise<WorktreeInfo> {
    const check = await this.checkMerge(ws, id);
    if (!check.canMerge) throw new GitOpError([...check.blockers, ...(check.conflicts.length ? [`Conflitos em: ${check.conflicts.join(', ')}`] : [])].join(' '));
    const r = this.row(ws, id);
    const pre = (await this.must(ws.path, ['rev-parse', 'HEAD'], 'Falha ao ler HEAD')).trim();
    const m = await this.git(ws.path, ['merge', '--no-ff', '--no-edit', '-m', `Integra ${r.branch} (DevFusion)`, r.branch], 120_000);
    if (m.exitCode !== 0) {
      await this.git(ws.path, ['merge', '--abort']);
      throw new GitOpError('O merge encontrou problemas e foi abortado; a raiz voltou ao estado anterior.');
    }
    const merged = (await this.must(ws.path, ['rev-parse', 'HEAD'], 'Falha ao ler o merge')).trim();
    this.d.repo.update(id, { status: 'merged', merged_sha: merged, pre_merge_sha: pre });
    this.d.repo.recordSnapshot(randomUUID(), r.task_id, check.targetBranch!, pre, null);
    this.d.audit('worktree.merge', id, { target: check.targetBranch, pre: pre.slice(0, 12), merged: merged.slice(0, 12) });
    return this.info(ws, this.row(ws, id));
  }

  /** Desfaz a integração com `git revert -m 1` (novo commit; histórico preservado). */
  async revert(ws: Ws, id: string): Promise<WorktreeInfo> {
    const r = this.row(ws, id);
    if (r.status !== 'merged' || !r.merged_sha) throw new GitOpError('Só é possível desfazer uma integração feita pelo DevFusion.');
    const root = await this.status(ws.path);
    if (!root.clean) throw new GitOpError('A raiz tem alterações não commitadas; faça commit ou guarde antes de desfazer.');
    const anc = await this.git(ws.path, ['merge-base', '--is-ancestor', r.merged_sha, 'HEAD']);
    if (anc.exitCode !== 0) throw new GitOpError('O commit de integração não está no branch atual da raiz.');
    const rv = await this.git(ws.path, ['revert', '-m', '1', '--no-edit', r.merged_sha], 120_000);
    if (rv.exitCode !== 0) {
      await this.git(ws.path, ['revert', '--abort']);
      throw new GitOpError('O revert encontrou conflitos e foi abortado; nada mudou.');
    }
    const sha = (await this.must(ws.path, ['rev-parse', 'HEAD'], 'Falha ao ler o revert')).trim();
    this.d.repo.update(id, { status: 'reverted' });
    this.d.audit('worktree.revert', id, { merged: r.merged_sha.slice(0, 12), revert: sha.slice(0, 12) });
    return this.info(ws, this.row(ws, id));
  }

  /** O que seria perdido ao remover (para a confirmação). */
  async removalImpact(ws: Ws, id: string): Promise<{ uncommitted: number; unmergedCommits: number; branch: string }> {
    const r = this.row(ws, id);
    const info = await this.info(ws, r);
    const root = await this.status(ws.path);
    const unmerged = root.branch ? await this.git(ws.path, ['rev-list', '--count', `${root.branch}..${r.branch}`]) : null;
    return { uncommitted: info.uncommitted, unmergedCommits: unmerged?.exitCode === 0 ? Number(unmerged.stdout.trim()) : info.ahead, branch: r.branch };
  }

  /** Remove o worktree; `confirmedLoss` precisa ser true se houver algo a perder (o chamador confirmou). */
  async remove(ws: Ws, id: string, deleteBranch: boolean, confirmedLoss: boolean): Promise<void> {
    const r = this.row(ws, id);
    const impact = await this.removalImpact(ws, id);
    const losing = impact.uncommitted > 0 || (deleteBranch && impact.unmergedCommits > 0);
    if (losing && !confirmedLoss) throw new GitOpError('Remoção com perda de trabalho exige confirmação explícita.');
    const info = await this.info(ws, r);
    if (info.present) await this.must(ws.path, ['worktree', 'remove', ...(impact.uncommitted > 0 ? ['--force'] : []), r.path], 'Falha ao remover o worktree');
    else await this.git(ws.path, ['worktree', 'prune']);
    if (deleteBranch) await this.must(ws.path, ['branch', impact.unmergedCommits > 0 ? '-D' : '-d', r.branch], 'Falha ao apagar o branch');
    this.d.repo.update(id, { status: 'removed' });
    this.d.audit('worktree.remove', id, { branch: r.branch, deleteBranch, discardedFiles: impact.uncommitted, discardedCommits: deleteBranch ? impact.unmergedCommits : 0 });
  }

  // ---------------------------------------------------------------- internos

  private async resolveCommit(cwd: string, ref: string): Promise<string> {
    const r = await this.git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
    if (r.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(r.stdout.trim())) throw new GitOpError(`Referência "${ref}" não encontrada no repositório.`);
    return r.stdout.trim();
  }

  private row(ws: Ws, id: string): WorktreeRow {
    const r = this.d.repo.byId(id);
    if (!r || r.workspace_id !== ws.id) throw new GitOpError('Worktree não encontrado neste workspace.');
    return r;
  }

  private activeRow(ws: Ws, id: string): WorktreeRow {
    const r = this.row(ws, id);
    if (r.status !== 'active') throw new GitOpError('Este worktree não está ativo.');
    return r;
  }

  private async info(ws: Ws, r: WorktreeRow): Promise<WorktreeInfo> {
    const listed = await this.git(ws.path, ['worktree', 'list', '--porcelain']);
    const paths = listed.stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => safeReal(l.slice(9)));
    const present = r.status !== 'removed' && paths.includes(r.path);
    const rootBranch = (await this.git(ws.path, ['symbolic-ref', '--short', '-q', 'HEAD'])).stdout.trim();
    const count = async (range: string) => { const c = await this.git(ws.path, ['rev-list', '--count', range]); return c.exitCode === 0 ? Number(c.stdout.trim()) : 0; };
    const [ahead, behind, uncommitted] = await Promise.all([
      count(`${r.base_sha}..${r.branch}`),
      rootBranch ? count(`${r.branch}..${rootBranch}`) : Promise.resolve(0),
      present ? this.git(r.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).then((s) => parsePorcelainZ(s.stdout).length) : Promise.resolve(0),
    ]);
    return {
      id: r.id, name: r.name, displayPath: this.d.shorten(r.path), branch: r.branch, baseRef: r.base_ref, baseSha: r.base_sha.slice(0, 10),
      agent: r.agent, taskId: r.task_id, status: r.status, ahead, behind, uncommitted, present, createdAt: r.created_at, mergedSha: r.merged_sha?.slice(0, 10) ?? null,
    };
  }
}

function safeReal(p: string): string { try { return realpathSync(p); } catch { return p; } }

export function kindOf(xy: string): GitFileKind {
  if (xy === '??') return 'untracked';
  if (['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(xy)) return 'conflicted';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('A')) return 'added';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('M') || xy.includes('T')) return 'modified';
  return 'other';
}

/** `git status --porcelain=v1 -z`: "XY caminho\0", renomeações trazem o caminho antigo em seguida. */
export function parsePorcelainZ(out: string): GitFileStatus[] {
  const parts = out.split('\0');
  const files: GitFileStatus[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    files.push({ path: entry.slice(3), kind: kindOf(xy), code: xy });
    if (xy[0] === 'R' || xy[0] === 'C') i++;
  }
  return files;
}

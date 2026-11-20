import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase } from '../../src/main/database/Database';
import { WorkspaceRepository } from '../../src/main/database/repositories/WorkspaceRepository';
import { WorktreeRepository } from '../../src/main/database/repositories/WorktreeRepository';
import { runCommand } from '../../src/main/system/ProcessRunner';
import { ExplorerError, listDir, resolveInside } from '../../src/main/workspace/FileExplorer';
import { GitOpError, WorktreeManager, parsePorcelainZ } from '../../src/main/workspace/WorktreeManager';

const GIT = process.platform === 'win32' ? 'git' : execFileSync('which', ['git']).toString().trim();
let base: string; let root: string; let wtDir: string; let ws: { id: string; path: string }; let wm: WorktreeManager; let audit: ReturnType<typeof vi.fn<(a: string, t: string, m: Record<string, unknown>) => void>>;
const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-wt-')));
  root = join(base, 'repo'); wtDir = join(base, 'app-worktrees'); mkdirSync(root);
  g(root, 'init', '-q', '-b', 'main'); g(root, 'config', 'user.email', 't@t'); g(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'a.txt'), 'linha 1\n'); writeFileSync(join(root, '.env'), 'SEGREDO=1\n');
  g(root, 'add', '.'); g(root, 'commit', '-q', '-m', 'init');
  const db = openDatabase(':memory:'); migrate(db);
  ws = { id: new WorkspaceRepository(db).upsert(root, 'repo').id, path: root };
  audit = vi.fn();
  wm = new WorktreeManager({ run: runCommand, gitPath: () => GIT, env: () => ({ PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: process.env['HOME'] }), repo: new WorktreeRepository(db), worktreesDir: wtDir, shorten: (p) => p, audit });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

async function newWt(name = 'feat') {
  const plan = await wm.previewCreate(ws, name, 'main');
  return { plan, wt: await wm.create(ws, plan, { name, agent: 'claude', taskId: null }) };
}

describe.skipIf(process.platform === 'win32')('WorktreeManager (Git real)', () => {
  it('cria branch + worktree a partir da referência explícita, fora do projeto, e avisa alterações na raiz', async () => {
    writeFileSync(join(root, 'a.txt'), 'mudança não commitada\n');
    const plan = await wm.previewCreate(ws, 'feat', 'main');
    expect(plan).toMatchObject({ baseRef: 'main', rootUncommitted: 1 });
    expect(plan.branch).toMatch(/^devfusion\/feat-[0-9a-f]{4}$/);
    const wt = await wm.create(ws, plan, { name: 'feat', agent: 'claude', taskId: null });
    expect(wt).toMatchObject({ status: 'active', present: true, ahead: 0, uncommitted: 0 });
    const path = wm.activePath(ws, wt.id);
    expect(path.startsWith(realpathSync(wtDir))).toBe(true);
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('linha 1\n'); // mudança da raiz não foi copiada
    expect(g(root, 'branch', '--list', plan.branch)).toContain(plan.branch);
    expect(audit).toHaveBeenCalledWith('worktree.create', wt.id, expect.objectContaining({ branch: plan.branch }));
    await expect(wm.previewCreate(ws, 'x', 'nao-existe')).rejects.toThrow(/não encontrada/);
  });

  it('recusa repositório sem commits e pasta que não é repositório (sem git init)', async () => {
    const empty = join(base, 'vazio'); mkdirSync(empty); g(empty, 'init', '-q');
    await expect(wm.previewCreate({ id: ws.id, path: empty }, 'x', 'HEAD')).rejects.toThrow(/primeiro commit/);
    const plain = join(base, 'plain'); mkdirSync(plain);
    await expect(wm.previewCreate({ id: ws.id, path: plain }, 'x', 'HEAD')).rejects.toThrow(/não inicializa/);
    expect(existsSync(join(plain, '.git'))).toBe(false);
  });

  it('arquivos alterados, commit sem .env, diff de arquivo e conflitos previstos sem tocar no disco', async () => {
    const { wt } = await newWt();
    const p = wm.activePath(ws, wt.id);
    writeFileSync(join(p, 'a.txt'), 'linha 1\nlinha 2 do agente\n'); writeFileSync(join(p, 'novo.ts'), 'x'); writeFileSync(join(p, '.env'), 'SEGREDO=vazado\n');
    expect((await wm.files(ws, wt.id)).map((f) => `${f.kind}:${f.path}`)).toEqual(['modified:.env', 'modified:a.txt', 'untracked:novo.ts']);
    const sha = await wm.commit(ws, wt.id, 'feat: linha 2');
    expect(g(p, 'show', '--name-only', '--format=', sha).split('\n').sort()).toEqual(['a.txt', 'novo.ts']); // .env não entrou
    expect((await wm.get(ws, wt.id))).toMatchObject({ ahead: 1, uncommitted: 1 });
    expect(await wm.fileDiff(p, 'a.txt', wm.baseOf(ws, wt.id).baseSha)).toContain('+linha 2 do agente');

    // Raiz muda a mesma linha → conflito previsto; repositório intacto.
    writeFileSync(join(root, 'a.txt'), 'linha 1\nlinha 2 da raiz\n'); g(root, 'commit', '-q', '-am', 'raiz');
    const head = g(root, 'rev-parse', 'HEAD');
    g(p, 'checkout', '-q', '--', '.env');
    const check = await wm.checkMerge(ws, wt.id);
    expect(check).toMatchObject({ targetBranch: 'main', conflicts: ['a.txt'], canMerge: false });
    expect(g(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(g(root, 'status', '--porcelain')).toBe('');
    await expect(wm.merge(ws, wt.id)).rejects.toThrow(/Conflitos em: a\.txt/);
  });

  it('bloqueios de integração: raiz suja, worktree com não commitado, nada a integrar', async () => {
    const { wt } = await newWt();
    expect((await wm.checkMerge(ws, wt.id)).blockers).toContain('Não há commits novos no worktree para integrar.');
    const p = wm.activePath(ws, wt.id);
    writeFileSync(join(p, 'b.txt'), 'b'); await wm.commit(ws, wt.id, 'b'); writeFileSync(join(p, 'c.txt'), 'c');
    writeFileSync(join(root, 'sujo.txt'), 'x');
    const check = await wm.checkMerge(ws, wt.id);
    expect(check.canMerge).toBe(false);
    expect(check.blockers.join(' ')).toMatch(/raiz tem 1 arquivo/);
    expect(check.blockers.join(' ')).toMatch(/worktree tem 1 arquivo/);
  });

  it('integra com --no-ff, registra snapshot e desfaz com revert preservando histórico', async () => {
    const { wt } = await newWt();
    const p = wm.activePath(ws, wt.id);
    writeFileSync(join(p, 'b.txt'), 'nova feature\n'); await wm.commit(ws, wt.id, 'feat: b');
    const before = g(root, 'rev-parse', 'HEAD');
    const merged = await wm.merge(ws, wt.id);
    expect(merged.status).toBe('merged');
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('nova feature\n');
    expect(g(root, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3); // merge commit (2 pais)
    const reverted = await wm.revert(ws, wt.id);
    expect(reverted.status).toBe('reverted');
    expect(existsSync(join(root, 'b.txt'))).toBe(false);
    expect(g(root, 'merge-base', '--is-ancestor', before, 'HEAD')).toBe(''); // histórico preservado (sem reset)
    expect(g(root, 'log', '--oneline').split('\n')).toHaveLength(4); // init, feat, merge, revert
    expect(audit.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['worktree.merge', 'worktree.revert']));
  });

  it('remoção: exige confirmação quando há perda; com confirmação descarta só o worktree', async () => {
    const { wt } = await newWt();
    const p = wm.activePath(ws, wt.id);
    writeFileSync(join(p, 'b.txt'), 'b'); await wm.commit(ws, wt.id, 'b'); writeFileSync(join(p, 'rascunho.txt'), 'r');
    expect(await wm.removalImpact(ws, wt.id)).toMatchObject({ uncommitted: 1, unmergedCommits: 1 });
    await expect(wm.remove(ws, wt.id, true, false)).rejects.toThrow(/confirmação/);
    expect(existsSync(p)).toBe(true);
    await wm.remove(ws, wt.id, true, true);
    expect(existsSync(p)).toBe(false);
    expect(g(root, 'branch', '--list', 'devfusion/*')).toBe('');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('linha 1\n');
    expect(await wm.list(ws)).toEqual([]);
    await expect(wm.commit(ws, wt.id, 'x')).rejects.toThrow(GitOpError);
  });
});

describe.skipIf(process.platform === 'win32')('FileExplorer', () => {
  it('lista com status Git, esconde .git e bloqueia traversal e symlinks para fora', async () => {
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'x.ts'), 'x');
    writeFileSync(join(root, 'a.txt'), 'mudou\n');
    const outside = join(base, 'fora'); mkdirSync(outside); writeFileSync(join(outside, 'segredo.txt'), 's');
    symlinkSync(outside, join(root, 'link-fora'));
    const st = await wm.status(root);
    const entries = await listDir(root, '', st.files);
    expect(entries.map((e) => `${e.type}:${e.name}:${e.status ?? '-'}`)).toEqual(['dir:src:modified', 'file:.env:-', 'file:a.txt:modified', 'symlink:link-fora:untracked']);
    await expect(resolveInside(root, '../fora/segredo.txt')).rejects.toThrow(ExplorerError);
    await expect(resolveInside(root, 'link-fora/segredo.txt')).rejects.toThrow(/Fora da pasta/);
    await expect(resolveInside(root, '/etc/passwd')).rejects.toThrow(/absoluto/);
    await expect(listDir(root, 'link-fora', [])).rejects.toThrow(/Fora da pasta/);
    await expect(wm.fileDiff(root, '../fora/segredo.txt', null)).rejects.toThrow(ExplorerError);
  });

  it('parsePorcelainZ entende renomeação, conflito e não rastreado', () => {
    expect(parsePorcelainZ('R  novo.ts\0velho.ts\0UU conf.ts\0?? n.txt\0 M m.ts\0')).toEqual([
      { path: 'novo.ts', kind: 'renamed', code: 'R ' }, { path: 'conf.ts', kind: 'conflicted', code: 'UU' },
      { path: 'n.txt', kind: 'untracked', code: '??' }, { path: 'm.ts', kind: 'modified', code: ' M' },
    ]);
  });
});

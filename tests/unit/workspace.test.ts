import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../src/main/database/Database';
import { SessionRepository } from '../../src/main/database/repositories/SessionRepository';
import { WorkspaceRepository } from '../../src/main/database/repositories/WorkspaceRepository';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { runCommand } from '../../src/main/system/ProcessRunner';
import { WorkspaceManager, validateWorkspacePath } from '../../src/main/workspace/WorkspaceManager';

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'devfusion-wsm-')); });
afterEach(() => rmSync(base, { recursive: true, force: true }));

function manager() {
  const db = openDatabase(':memory:'); migrate(db);
  const repo = new WorkspaceRepository(db);
  const git = execFileSync('which', ['git']).toString().trim();
  return { db, repo, wm: new WorkspaceManager(repo, new PlatformDetector(), runCommand, () => git) };
}

describe.skipIf(process.platform === 'win32')('workspace', () => {
  it('valida pasta: inexistente, arquivo, raiz, home, symlink resolvido', async () => {
    await expect(validateWorkspacePath(join(base, 'nao-existe'))).rejects.toThrow(/não existe/);
    writeFileSync(join(base, 'arquivo'), 'x');
    await expect(validateWorkspacePath(join(base, 'arquivo'))).rejects.toThrow(/não é uma pasta/);
    await expect(validateWorkspacePath('/')).rejects.toThrow(/raiz/);
    await expect(validateWorkspacePath(homedir())).rejects.toThrow(/pessoal/);
    mkdirSync(join(base, 'real'));
    symlinkSync(join(base, 'real'), join(base, 'atalho'));
    expect(await validateWorkspacePath(join(base, 'atalho'))).toBe(realpathSync(join(base, 'real')));
  });

  it('abre, persiste, restaura e lê estado Git sem inicializar repositório', async () => {
    const { wm, repo } = manager();
    const plain = join(base, 'plain'); mkdirSync(plain);
    const info = await wm.open(plain);
    expect(info.git).toEqual({ isRepo: false, branch: null });
    expect(() => execFileSync('git', ['-C', plain, 'rev-parse'], { stdio: 'ignore' })).toThrow(); // continua sem .git
    expect(repo.byId(info.id)?.path).toBe(realpathSync(plain));

    const repoDir = join(base, 'repo'); mkdirSync(repoDir);
    execFileSync('git', ['init', '-q', '-b', 'principal', repoDir]);
    expect((await wm.open(repoDir)).git).toEqual({ isRepo: true, branch: 'principal' });

    expect((await wm.restore(info.id))?.name).toBe('plain');
    rmSync(plain, { recursive: true });
    expect(await wm.restore(info.id)).toBeNull();
    expect(await wm.restore('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('sessões ativas de execução anterior viram desconectadas', () => {
    const { db, repo } = manager();
    const w = repo.upsert(base, 'x');
    const s = new SessionRepository(db);
    s.create('s1', w.id, 'claude', 'running');
    s.create('s2', w.id, 'codex', 'completed');
    expect(s.markStaleAsDisconnected()).toBe(1);
    expect(s.countByState('disconnected')).toBe(1);
    expect(s.countByState('completed')).toBe(1);
  });
});

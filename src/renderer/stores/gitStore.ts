import { create } from 'zustand';
import type { AgentId } from '@shared/agents';
import type { GitFileStatus, MergeCheck, RepoStatus, WorktreeInfo } from '@shared/git';
import { unwrap } from '../lib/ipc';

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

interface GitState {
  root: RepoStatus | null;
  worktrees: WorktreeInfo[];
  /** Incrementa a cada mudança no disco (Explorer recarrega). */
  fsTick: number;
  init(): () => void;
  reload(): Promise<void>;
  create(name: string, baseRef: string, agent: AgentId | null): Promise<Result<WorktreeInfo | null>>;
  files(id: string): Promise<Result<GitFileStatus[]>>;
  commit(id: string, message: string): Promise<Result<string>>;
  checkMerge(id: string): Promise<Result<MergeCheck>>;
  merge(id: string): Promise<Result<WorktreeInfo | null>>;
  revert(id: string): Promise<Result<WorktreeInfo | null>>;
  remove(id: string, deleteBranch: boolean): Promise<Result<boolean>>;
  openFolder(id: string): Promise<Result<boolean>>;
}

export const useGitStore = create<GitState>((set, get) => ({
  root: null,
  worktrees: [],
  fsTick: 0,
  init() {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offFs = window.devfusion.git.onFsChanged(() => {
      set((s) => ({ fsTick: s.fsTick + 1 }));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().reload(), 300);
    });
    const offWt = window.devfusion.worktrees.onChanged(() => void get().reload());
    const offWs = window.devfusion.workspace.onChanged(() => void get().reload());
    void get().reload();
    return () => { offFs(); offWt(); offWs(); if (timer) clearTimeout(timer); };
  },
  async reload() {
    const [root, worktrees] = await Promise.all([unwrap(window.devfusion.git.status({ kind: 'root' })), unwrap(window.devfusion.worktrees.list())]);
    set({ root, worktrees });
  },
  create: (name, baseRef, agent) => unwrap(window.devfusion.worktrees.create(name, baseRef, agent)),
  files: (id) => unwrap(window.devfusion.worktrees.files(id)),
  commit: (id, message) => unwrap(window.devfusion.worktrees.commit(id, message)),
  checkMerge: (id) => unwrap(window.devfusion.worktrees.checkMerge(id)),
  merge: (id) => unwrap(window.devfusion.worktrees.merge(id)),
  revert: (id) => unwrap(window.devfusion.worktrees.revert(id)),
  remove: (id, deleteBranch) => unwrap(window.devfusion.worktrees.remove(id, deleteBranch)),
  openFolder: (id) => unwrap(window.devfusion.worktrees.openFolder(id)),
}));

import { create } from 'zustand';
import type { WorkersSnapshot } from '@shared/orchestrator';
import { unwrap } from '../lib/ipc';

interface WorkersStoreState {
  snapshot: WorkersSnapshot;
  init(): () => void;
  stop(id: string): Promise<void>;
}

export const useWorkersStore = create<WorkersStoreState>((set) => ({
  snapshot: { lead: null, workers: [] },
  init() {
    const off = window.devfusion.workers.onChanged((snapshot) => set({ snapshot }));
    void unwrap(window.devfusion.workers.list()).then((snapshot) => set({ snapshot }));
    return off;
  },
  async stop(id) { await unwrap(window.devfusion.workers.stop(id)); },
}));

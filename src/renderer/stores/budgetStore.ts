import { create } from 'zustand';
import type { BudgetState } from '@shared/budget';
import { unwrap } from '../lib/ipc';

interface BudgetStoreState {
  state: BudgetState | null;
  init(): () => void;
  restart(): Promise<void>;
}

export const useBudgetStore = create<BudgetStoreState>((set) => ({
  state: null,
  init() {
    const off = window.devfusion.budget.onChanged((state) => set({ state }));
    void unwrap(window.devfusion.budget.get()).then((state) => set((s) => ({ state: s.state ?? state })));
    return off;
  },
  async restart() { set({ state: await unwrap(window.devfusion.budget.restart()) }); },
}));

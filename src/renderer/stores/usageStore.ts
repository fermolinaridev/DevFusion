import { create } from 'zustand';
import type { UsageReport } from '@shared/usage';
import { unwrap } from '../lib/ipc';

interface UsageState {
  report: UsageReport | null;
  refreshing: boolean;
  init(): () => void;
  refresh(): Promise<void>;
}

export const useUsageStore = create<UsageState>((set) => ({
  report: null,
  refreshing: false,
  init() {
    const off = window.devfusion.usage.onChanged((report) => set({ report }));
    void unwrap(window.devfusion.usage.get()).then((report) => set((s) => ({ report: s.report ?? report })));
    return off;
  },
  async refresh() {
    set({ refreshing: true });
    try { set({ report: await unwrap(window.devfusion.usage.refresh()) }); } finally { set({ refreshing: false }); }
  },
}));

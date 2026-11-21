import { create } from 'zustand';
import type { UpdateStatus } from '@shared/updates';
import { unwrap } from '../lib/ipc';

interface UpdateStoreState {
  status: UpdateStatus | null;
  init(): () => void;
  check(): Promise<void>;
  openRelease(): Promise<void>;
}

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  status: null,
  init() {
    const off = window.devfusion.updates.onChanged((status) => set({ status }));
    void unwrap(window.devfusion.updates.get()).then((status) => set((s) => ({ status: s.status ?? status })));
    return off;
  },
  async check() { set({ status: await unwrap(window.devfusion.updates.check()) }); },
  async openRelease() { await unwrap(window.devfusion.updates.openRelease()); },
}));

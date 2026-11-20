import { create } from 'zustand';
import type { AppInfo } from '@shared/ipcContracts';
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings';
import { unwrap } from '../lib/ipc';

export type NavView = 'explorer' | 'agents' | 'tasks' | 'git' | 'sessions' | 'settings';

interface AppState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  info: AppInfo | null;
  settings: Settings;
  view: NavView;
  load(): Promise<void>;
  setTheme(theme: Settings['theme']): Promise<void>;
  setView(view: NavView): void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'loading',
  error: null,
  info: null,
  settings: DEFAULT_SETTINGS,
  view: 'agents',
  async load() {
    try {
      const [info, settings] = await Promise.all([unwrap(window.devfusion.app.getInfo()), unwrap(window.devfusion.settings.getAll())]);
      set({ info, settings, status: 'ready', error: null });
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },
  async setTheme(theme) {
    try {
      const settings = await unwrap(window.devfusion.settings.set('theme', theme));
      set({ settings, error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  setView(view) { set({ view }); },
}));

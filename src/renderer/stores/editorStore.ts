import { create } from 'zustand';
import type { GitLocation } from '@shared/git';
import { unwrap } from '../lib/ipc';

export interface EditorTab {
  key: string;
  location: GitLocation;
  locationLabel: string;
  rel: string;
  name: string;
  content: string;
  saved: string;
  mtimeMs: number;
}

type SaveOutcome = 'saved' | 'conflict' | 'error';

interface EditorState {
  tabs: EditorTab[];
  /** 'agents' = painéis dos agentes; senão a chave da aba de arquivo. */
  active: string;
  error: string | null;
  open(location: GitLocation, locationLabel: string, rel: string): Promise<void>;
  activate(key: string): void;
  close(key: string): void;
  change(key: string, content: string): void;
  save(key: string, overwrite?: boolean): Promise<SaveOutcome>;
  reload(key: string): Promise<void>;
}

const keyOf = (loc: GitLocation, rel: string) => `${loc.kind === 'root' ? 'root' : loc.id}:${rel}`;

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  active: 'agents',
  error: null,
  async open(location, locationLabel, rel) {
    const key = keyOf(location, rel);
    if (get().tabs.some((t) => t.key === key)) { set({ active: key, error: null }); return; }
    const r = await unwrap(window.devfusion.editor.read(location, rel));
    if (!r.ok) { set({ error: r.reason }); return; }
    const tab: EditorTab = { key, location, locationLabel, rel, name: rel.split('/').pop() ?? rel, content: r.value.content, saved: r.value.content, mtimeMs: r.value.mtimeMs };
    set((s) => ({ tabs: [...s.tabs, tab], active: key, error: null }));
  },
  activate(key) { set({ active: key }); },
  close(key) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.key !== key);
      return { tabs, active: s.active === key ? (tabs.at(-1)?.key ?? 'agents') : s.active };
    });
  },
  change(key, content) { set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, content } : t)) })); },
  async save(key, overwrite = false) {
    const tab = get().tabs.find((t) => t.key === key);
    if (!tab) return 'error';
    const r = await unwrap(window.devfusion.editor.write(tab.location, tab.rel, tab.content, tab.mtimeMs, overwrite));
    if (!r.ok) { set({ error: r.reason }); return 'error'; }
    if (r.value.status === 'conflict') return 'conflict';
    const mtimeMs = r.value.mtimeMs;
    set((s) => ({ error: null, tabs: s.tabs.map((t) => (t.key === key ? { ...t, saved: t.content, mtimeMs } : t)) }));
    return 'saved';
  },
  async reload(key) {
    const tab = get().tabs.find((t) => t.key === key);
    if (!tab) return;
    const r = await unwrap(window.devfusion.editor.read(tab.location, tab.rel));
    if (!r.ok) { set({ error: r.reason }); return; }
    set((s) => ({ error: null, tabs: s.tabs.map((t) => (t.key === key ? { ...t, content: r.value.content, saved: r.value.content, mtimeMs: r.value.mtimeMs } : t)) }));
  },
}));

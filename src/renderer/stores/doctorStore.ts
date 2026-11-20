import { create } from 'zustand';
import type { CheckId, DocId, DoctorReport, InstallMethod, InstallState, InstallableDependency } from '@shared/doctor';
import { unwrap } from '../lib/ipc';

interface DoctorState {
  report: DoctorReport | null;
  install: InstallState | null;
  methods: Partial<Record<InstallableDependency, InstallMethod[]>>;
  error: string | null;
  init(): () => void;
  run(checks?: CheckId[]): Promise<void>;
  loadMethods(dep: InstallableDependency): Promise<void>;
  startInstall(methodId: string): Promise<void>;
  cancelInstall(): Promise<void>;
  openDocs(docId: DocId): Promise<void>;
  openSource(methodId: string): Promise<void>;
}

export const useDoctorStore = create<DoctorState>((set) => ({
  report: null,
  install: null,
  methods: {},
  error: null,
  init() {
    const offReport = window.devfusion.doctor.onReport((report) => set({ report }));
    const offInstall = window.devfusion.installer.onState((install) => set({ install }));
    void unwrap(window.devfusion.doctor.getReport()).then((report) => set((s) => ({ report: s.report && s.report.runId >= report.runId ? s.report : report }))).catch((e: Error) => set({ error: e.message }));
    void unwrap(window.devfusion.installer.getState()).then((install) => set({ install })).catch(() => undefined);
    return () => { offReport(); offInstall(); };
  },
  async run(checks) {
    try { set({ report: await unwrap(window.devfusion.doctor.run(checks)), error: null }); }
    catch (e) { set({ error: (e as Error).message }); }
  },
  async loadMethods(dep) {
    try { const list = await unwrap(window.devfusion.installer.getMethods(dep)); set((s) => ({ methods: { ...s.methods, [dep]: list } })); }
    catch (e) { set({ error: (e as Error).message }); }
  },
  async startInstall(methodId) {
    try { set({ install: await unwrap(window.devfusion.installer.install(methodId)) }); }
    catch (e) { set({ error: (e as Error).message }); }
  },
  async cancelInstall() { await window.devfusion.installer.cancel(); },
  async openDocs(docId) { await window.devfusion.docs.open(docId); },
  async openSource(methodId) { await window.devfusion.installer.openSource(methodId); },
}));

export function resultOf(report: DoctorReport | null, id: CheckId) {
  return report?.results.find((r) => r.id === id) ?? null;
}

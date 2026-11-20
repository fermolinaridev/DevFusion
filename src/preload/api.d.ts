import type { CheckId, DocId, DoctorReport, InstallMethod, InstallState, InstallableDependency } from '../shared/doctor';
import type { AppInfo, IpcResult } from '../shared/ipcContracts';
import type { Settings } from '../shared/settings';

export interface DevFusionApi {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  settings: {
    getAll(): Promise<IpcResult<Settings>>;
    /** Aceita `unknown` de propósito: o main valida chave e valor. */
    set(key: string, value: unknown): Promise<IpcResult<Settings>>;
  };
  doctor: {
    getReport(): Promise<IpcResult<DoctorReport>>;
    run(checks?: CheckId[]): Promise<IpcResult<DoctorReport>>;
    /** Retorna função para cancelar a inscrição. */
    onReport(cb: (report: DoctorReport) => void): () => void;
  };
  installer: {
    getMethods(dependency: InstallableDependency): Promise<IpcResult<InstallMethod[]>>;
    getState(): Promise<IpcResult<InstallState>>;
    install(methodId: string): Promise<IpcResult<InstallState>>;
    cancel(): Promise<IpcResult<boolean>>;
    openSource(methodId: string): Promise<IpcResult<boolean>>;
    onState(cb: (state: InstallState) => void): () => void;
  };
  docs: {
    open(docId: DocId): Promise<IpcResult<boolean>>;
  };
}

declare global {
  interface Window {
    readonly devfusion: DevFusionApi;
  }
}

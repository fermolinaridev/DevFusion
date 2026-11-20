import { app, BrowserWindow, dialog, shell } from 'electron';
import { statfs } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { InstallMethod } from '@shared/doctor';
import { IPC, IPC_EVENTS, type IpcEvent } from '@shared/ipcChannels';
import type { AppInfo, IpcHandlers } from '@shared/ipcContracts';
import { migrate, openDatabase, sqliteVersion, type Db } from './database/Database';
import { AuditLogRepository } from './database/repositories/AuditLogRepository';
import { DependencyRepository } from './database/repositories/DependencyRepository';
import { SettingsRepository } from './database/repositories/SettingsRepository';
import { registerIpc } from './ipc/registerIpc';
import { createLogger } from './logging/logger';
import { hardenSession, hardenWindow, rendererEntry, secureWebPreferences } from './security/electronSecurity';
import { defaultConnectivityTargets, tlsProbe } from './system/checks';
import { DependencyInstaller } from './system/DependencyInstaller';
import { DOC_URLS, INSTALL_CATALOG } from './system/InstallCatalog';
import { PlatformDetector } from './system/PlatformDetector';
import { runCommand } from './system/ProcessRunner';
import { SystemDoctor } from './system/SystemDoctor';

const log = createLogger('main');
/** Espaço livre mínimo no volume de dados (política do DevFusion). */
const MIN_FREE_DISK_BYTES = Number(process.env['DEVFUSION_MIN_FREE_DISK_BYTES'] ?? 1024 ** 3);

// Diretório de dados alternativo (usado pelos testes E2E para isolamento).
const userDataOverride = process.env['DEVFUSION_USER_DATA_DIR'];
if (userDataOverride && isAbsolute(userDataOverride)) app.setPath('userData', userDataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let db: Db | null = null;

  const send = (event: IpcEvent, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
  };

  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    hardenSession(log);

    const userData = app.getPath('userData');
    const dbFile = join(userData, 'devfusion.sqlite');
    db = openDatabase(dbFile);
    const schemaVersion = migrate(db);
    log.info(`Banco pronto (schema v${schemaVersion})`, { file: dbFile });
    const audit = new AuditLogRepository(db);
    const settings = new SettingsRepository(db, audit, (key) => log.warn('Configuração inválida ignorada; usando padrão', { key }));
    const dependencies = new DependencyRepository(db);
    const sqlite = sqliteVersion(db);

    const detector = new PlatformDetector();
    const connectivityTargets = defaultConnectivityTargets(process.env);
    const doctor = new SystemDoctor({
      context: () => ({
        detector,
        run: runCommand,
        cliPaths: settings.getAll().cliPaths,
        userDataDir: userData,
        workspacePath: null,
        minFreeDiskBytes: MIN_FREE_DISK_BYTES,
        freeDiskBytes: async (dir) => { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); },
        connect: tlsProbe,
        connectivityTargets,
      }),
      persist: (results) => dependencies.saveAll(results),
      onReport: (report) => send(IPC_EVENTS.doctorReport, report),
    });

    const installer = new DependencyInstaller({
      detector,
      run: runCommand,
      confirm: (method) => confirmInstall(mainWindow, method),
      revalidate: (checks) => doctor.run(checks),
      audit: (action, target, metadata) => audit.record(action, target, metadata),
      onState: (state) => send(IPC_EVENTS.installerState, state),
    });

    const openAllowed = async (url: string) => {
      const allowed = new Set<string>([...Object.values(DOC_URLS), ...INSTALL_CATALOG.map((e) => e.sourceUrl)]);
      if (!allowed.has(url)) return false;
      await shell.openExternal(url);
      return true;
    };

    const handlers: IpcHandlers = {
      [IPC.appGetInfo]: (): AppInfo => ({
        appVersion: app.getVersion(),
        platform: (['win32', 'darwin', 'linux'] as const).find((p) => p === process.platform) ?? 'other',
        arch: process.arch,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        database: { schemaVersion, sqliteVersion: sqlite },
      }),
      [IPC.settingsGetAll]: () => settings.getAll(),
      [IPC.settingsSet]: ({ key, value }) => {
        const next = settings.set(key, value as never);
        // Caminho de CLI alterado: revalida as ferramentas afetadas.
        if (key === 'cliPaths') void doctor.run(['git', 'claude', 'codex']);
        return next;
      },
      [IPC.doctorGetReport]: () => doctor.getReport(),
      [IPC.doctorRun]: (arg) => doctor.run(arg?.checks),
      [IPC.installerGetMethods]: ({ dependency }) => installer.methods(dependency),
      [IPC.installerGetState]: () => installer.getState(),
      [IPC.installerInstall]: ({ methodId }) => installer.install(methodId),
      [IPC.installerCancel]: () => installer.cancel(),
      [IPC.installerOpenSource]: async ({ methodId }) => {
        const entry = INSTALL_CATALOG.find((e) => e.id === methodId);
        return entry ? openAllowed(entry.sourceUrl) : false;
      },
      [IPC.docsOpen]: ({ docId }) => openAllowed(DOC_URLS[docId]),
    };
    registerIpc(handlers, () => mainWindow, log);

    mainWindow = createMainWindow();
    mainWindow.on('closed', () => { mainWindow = null; });

    // System Doctor em toda inicialização, sem bloquear a janela.
    void doctor.run().then((r) => log.info('Diagnóstico concluído', { mode: r.summary.mode, ready: r.summary.readyAgents }));
  }).catch((e: unknown) => {
    log.error('Falha na inicialização', e);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { try { db?.close(); } catch { /* já fechado */ } });
}

/** Confirmação final da instalação em diálogo nativo do main (não pode ser forjada pelo renderer). */
async function confirmInstall(win: BrowserWindow | null, method: InstallMethod): Promise<boolean> {
  const detail = [
    `Comando: ${method.commandDisplay ?? '—'}`,
    `Origem oficial: ${method.sourceUrl}`,
    `Permissões: ${method.permissions}`,
    `Versão: ${method.versionNote}`,
    ...method.notes.map((n) => `• ${n}`),
  ].join('\n\n');
  const opts: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Confirmar instalação',
    message: `Instalar ${method.dependency} via ${method.title}?`,
    detail,
    buttons: ['Cancelar', 'Instalar'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return response === 1;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'DevFusion',
    backgroundColor: '#0f1115',
    webPreferences: secureWebPreferences(join(__dirname, '../preload/index.js')),
  });
  hardenWindow(win, log);
  win.once('ready-to-show', () => win.show());
  const entry = rendererEntry();
  if (entry.kind === 'url') void win.loadURL(entry.url);
  else void win.loadFile(entry.file);
  return win;
}

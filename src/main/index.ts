import { app, BrowserWindow } from 'electron';
import { isAbsolute, join } from 'node:path';
import { IPC } from '@shared/ipcChannels';
import type { AppInfo, IpcHandlers } from '@shared/ipcContracts';
import { migrate, openDatabase, sqliteVersion, type Db } from './database/Database';
import { AuditLogRepository } from './database/repositories/AuditLogRepository';
import { SettingsRepository } from './database/repositories/SettingsRepository';
import { registerIpc } from './ipc/registerIpc';
import { createLogger } from './logging/logger';
import { hardenSession, hardenWindow, rendererEntry, secureWebPreferences } from './security/electronSecurity';

const log = createLogger('main');

// Diretório de dados alternativo (usado pelos testes E2E para isolamento).
const userDataOverride = process.env['DEVFUSION_USER_DATA_DIR'];
if (userDataOverride && isAbsolute(userDataOverride)) app.setPath('userData', userDataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let db: Db | null = null;

  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    hardenSession(log);

    const dbFile = join(app.getPath('userData'), 'devfusion.sqlite');
    db = openDatabase(dbFile);
    const schemaVersion = migrate(db);
    log.info(`Banco pronto (schema v${schemaVersion})`, { file: dbFile });
    const audit = new AuditLogRepository(db);
    const settings = new SettingsRepository(db, audit, (key) => log.warn('Configuração inválida ignorada; usando padrão', { key }));
    const sqlite = sqliteVersion(db);

    const handlers: IpcHandlers = {
      [IPC.appGetInfo]: (): AppInfo => ({
        appVersion: app.getVersion(),
        platform: (['win32', 'darwin', 'linux'] as const).find((p) => p === process.platform) ?? 'other',
        arch: process.arch,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        database: { schemaVersion, sqliteVersion: sqlite },
      }),
      [IPC.settingsGetAll]: () => settings.getAll(),
      [IPC.settingsSet]: ({ key, value }) => settings.set(key, value as never),
    };
    registerIpc(handlers, () => mainWindow, log);

    mainWindow = createMainWindow();
    mainWindow.on('closed', () => { mainWindow = null; });
  }).catch((e: unknown) => {
    log.error('Falha na inicialização', e);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { try { db?.close(); } catch { /* já fechado */ } });
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

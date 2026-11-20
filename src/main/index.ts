import { app, BrowserWindow, dialog, shell } from 'electron';
import * as nodePty from 'node-pty';
import { statfs } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { InstallMethod } from '@shared/doctor';
import { IPC, IPC_EVENTS, type IpcEvent } from '@shared/ipcChannels';
import type { AppInfo, IpcHandlers } from '@shared/ipcContracts';
import { AgentService } from './agents/AgentService';
import { ApprovalRepository } from './database/repositories/ApprovalRepository';
import { MessageRepository } from './database/repositories/MessageRepository';
import { TaskRepository } from './database/repositories/TaskRepository';
import { LoopGuard } from './orchestrator/LoopGuard';
import { BusError, MessageBus } from './orchestrator/MessageBus';
import { TaskError, TaskScheduler } from './orchestrator/TaskScheduler';
import { GitManager } from './workspace/GitManager';
import { migrate, openDatabase, sqliteVersion, type Db } from './database/Database';
import { AuditLogRepository } from './database/repositories/AuditLogRepository';
import { DependencyRepository } from './database/repositories/DependencyRepository';
import { SessionRepository } from './database/repositories/SessionRepository';
import { SettingsRepository } from './database/repositories/SettingsRepository';
import { WorkspaceRepository } from './database/repositories/WorkspaceRepository';
import { registerIpc } from './ipc/registerIpc';
import { createLogger } from './logging/logger';
import { hardenSession, hardenWindow, rendererEntry, secureWebPreferences } from './security/electronSecurity';
import { defaultConnectivityTargets, tlsProbe } from './system/checks';
import { DependencyInstaller } from './system/DependencyInstaller';
import { DOC_URLS, INSTALL_CATALOG } from './system/InstallCatalog';
import { PlatformDetector } from './system/PlatformDetector';
import { runCommand } from './system/ProcessRunner';
import { SystemDoctor } from './system/SystemDoctor';
import { WorkspaceError, WorkspaceManager } from './workspace/WorkspaceManager';

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
  let agents: AgentService | null = null;
  let quitting = false;

  const send = (event: IpcEvent, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
  };

  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
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

    const sessions = new SessionRepository(db);
    const stale = sessions.markStaleAsDisconnected();
    if (stale > 0) log.info('Sessões da execução anterior marcadas como desconectadas', { count: stale });

    const detector = new PlatformDetector();
    const workspace = new WorkspaceManager(new WorkspaceRepository(db), detector, runCommand, () => detector.locate('git', settings.getAll().cliPaths.git).found?.path ?? null);
    const connectivityTargets = defaultConnectivityTargets(process.env);
    const doctor = new SystemDoctor({
      context: () => ({
        detector,
        run: runCommand,
        cliPaths: settings.getAll().cliPaths,
        userDataDir: userData,
        workspacePath: workspace.currentPath(),
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

    const agentService = new AgentService({
      detector,
      ptyFactory: nodePty,
      configuredPaths: () => { const p = settings.getAll().cliPaths; return { claude: p.claude, codex: p.codex }; },
      doctorResult: (id) => doctor.getReport().results.find((r) => r.id === id) ?? null,
      workspacePath: () => workspace.currentPath(),
      revalidate: (checks) => doctor.run(checks),
      emitState: (info) => send(IPC_EVENTS.agentState, info),
      emitData: (agent, data) => send(IPC_EVENTS.terminalData, { agent, data }),
      // Log sanitizado (redact) para diagnosticar encerramentos inesperados das CLIs.
      onExitDiagnostics: (d) => log.info(`Agente ${d.agent} encerrou`, d),
      onSessionCreated: (id, agent, kind) => {
        const wsId = workspace.currentId();
        if (kind === 'agent' && wsId) sessions.create(id, wsId, agent, 'running');
        audit.record('agent.start', agent, { kind });
      },
      onSessionEnded: (id, status, kind) => {
        if (kind === 'agent') { try { sessions.setState(id, status); } catch { /* sessão sem registro */ } }
      },
    });
    agents = agentService;

    const gitPath = () => detector.locate('git', settings.getAll().cliPaths.git).found?.path ?? null;
    const guard = new LoopGuard();
    const bus = new MessageBus({
      repo: new MessageRepository(db),
      guard,
      workspaceId: () => workspace.currentId(),
      isRunning: (a) => agentService.isRunning(a),
      deliver: (a, text) => agentService.adapter(a).sendMessage(text),
      emit: (msg) => send(IPC_EVENTS.chatMessage, msg),
    });
    const git = new GitManager(runCommand, gitPath, () => detector.childEnv());
    const tasks = new TaskScheduler({
      repo: new TaskRepository(db),
      approvals: new ApprovalRepository(db),
      bus,
      guard,
      workspace: () => { const id = workspace.currentId(); const path = workspace.currentPath(); return id && path ? { id, path } : null; },
      maxRounds: () => settings.getAll().maxReviewRounds,
      snapshot: (path) => git.reviewSnapshot(path),
      audit: (action, target, metadata) => audit.record(action, target, metadata),
      emit: (task) => send(IPC_EVENTS.taskUpdated, task),
    });
    /** Erros esperados (regras de negócio) viram mensagem para o usuário; o resto é erro interno. */
    const expected = <T>(fn: () => T): { ok: true; value: T } | { ok: false; reason: string } => {
      try { return { ok: true, value: fn() }; }
      catch (e) { if (e instanceof BusError || e instanceof TaskError) return { ok: false, reason: e.message }; throw e; }
    };
    const expectedAsync = async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> => {
      try { return { ok: true, value: await fn() }; }
      catch (e) { if (e instanceof BusError || e instanceof TaskError) return { ok: false, reason: e.message }; throw e; }
    };
    await workspace.restore(settings.getAll().lastWorkspaceId);

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
      [IPC.workspaceGet]: async () => (workspace.currentPath() ? workspace.info() : null),
      [IPC.workspaceChoose]: async () => {
        const opts: Electron.OpenDialogOptions = { title: 'Escolher workspace', properties: ['openDirectory', 'createDirectory'] };
        const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
        const chosen = r.filePaths[0];
        if (r.canceled || !chosen) return { ok: true, value: null };
        if (agentService.list().some((a) => a.status === 'running')) return { ok: false, reason: 'Encerre os agentes antes de trocar de workspace.' };
        try {
          const info = await workspace.open(chosen);
          settings.set('lastWorkspaceId', info.id);
          send(IPC_EVENTS.workspaceChanged, info);
          audit.record('workspace.open', info.id, {});
          void doctor.run(['workspace']);
          return { ok: true, value: info };
        } catch (e) {
          if (e instanceof WorkspaceError) return { ok: false, reason: e.message };
          throw e;
        }
      },
      [IPC.agentsList]: () => agentService.list(),
      [IPC.agentStart]: async ({ agent, kind, cols, rows, permission }) => {
        try { return { ok: true, value: await agentService.start(agent, kind, cols, rows, permission) }; }
        catch (e) { return { ok: false, reason: (e as Error).message }; }
      },
      [IPC.agentInterrupt]: async ({ agent }) => { await agentService.adapter(agent).interrupt(); },
      [IPC.agentStop]: ({ agent }) => agentService.stop(agent),
      [IPC.agentsStopAll]: async () => { audit.record('agents.stop-all', null, {}); return agentService.stopAll(); },
      [IPC.terminalWrite]: ({ agent, data }) => agentService.terminals.write(agent, data),
      [IPC.terminalResize]: ({ agent, cols, rows }) => agentService.terminals.resize(agent, cols, rows),
      [IPC.terminalAck]: ({ agent, bytes }) => agentService.terminals.ack(agent, bytes),
      [IPC.terminalReplay]: ({ agent }) => agentService.terminals.replay(agent),
      [IPC.chatList]: (arg) => bus.history(arg?.limit ?? 200),
      [IPC.chatSend]: ({ to, content }) => expectedAsync(() => bus.send({ kind: 'message', sender: 'user', to, content })),
      [IPC.chatForward]: ({ from, to, content }) => expectedAsync(() => bus.send({ kind: 'forward', sender: from, to, content })),
      [IPC.tasksList]: () => tasks.list(),
      [IPC.tasksCreate]: (input) => expected(() => tasks.create(input)),
      [IPC.tasksPreview]: ({ taskId, action, notes }) => expectedAsync(() => tasks.preview(taskId, action, notes)),
      [IPC.tasksSend]: ({ taskId, action, content }) => expectedAsync(() => tasks.send(taskId, action, content)),
      [IPC.tasksDecide]: ({ taskId, decision, note }) => expected(() => tasks.decide(taskId, decision, note)),
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
  // Nenhum processo de agente pode sobreviver ao app (sem órfãos).
  app.on('before-quit', (event) => {
    if (quitting || !agents || !agents.list().some((a) => a.status === 'running')) return;
    event.preventDefault();
    quitting = true;
    void agents.stopAll().finally(() => app.quit());
  });
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

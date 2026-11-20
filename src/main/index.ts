import { app, BrowserWindow, dialog, shell } from 'electron';
import type { GitLocation, RepoStatus } from '@shared/git';
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
import { WorktreeRepository } from './database/repositories/WorktreeRepository';
import { ExplorerError, listDir, watchTree } from './workspace/FileExplorer';
import { GitOpError, WorktreeManager } from './workspace/WorktreeManager';
import { ClaudeStatuslineBridge } from './usage/ClaudeStatuslineBridge';
import { readCodexUsage } from './usage/CodexUsageReader';
import { UsageService } from './usage/UsageService';
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
  let usage: UsageService | null = null;
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

    // Uso dos planos (decisão do usuário): Codex por leitura no App Server; Claude pela statusline oficial.
    const claudeUsage = new ClaudeStatuslineBridge(join(userData, 'usage'), () => {
      const node = detector.locate('node').found?.path;
      if (node) return { executable: node, runAsNodeEnv: false };
      // Sem Node externo, o próprio Electron roda o script (POSIX). No Windows, sem Node, não há statusline.
      return process.platform === 'win32' ? null : { executable: process.execPath, runAsNodeEnv: true };
    });
    const agentService = new AgentService({
      extraAgentArgs: { claude: () => claudeUsage.settingsArgs() },
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
    const usageService = new UsageService({
      readCodex: () => readCodexUsage({ codexPath: () => detector.locate('codex', settings.getAll().cliPaths.codex).found?.path ?? null, env: () => detector.childEnv() }),
      claude: claudeUsage,
      emit: (report) => send(IPC_EVENTS.usage, report),
    });
    usage = usageService;

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
    const worktrees = new WorktreeManager({
      run: runCommand, gitPath, env: () => detector.childEnv(), repo: new WorktreeRepository(db),
      worktreesDir: join(userData, 'worktrees'), shorten: (p) => detector.shortenHome(p),
      audit: (action, target, metadata) => audit.record(action, target, metadata),
    });
    const wsRef = () => { const id = workspace.currentId(); const path = workspace.currentPath(); return id && path ? { id, path } : null; };
    const requireWs = () => { const w = wsRef(); if (!w) throw new GitOpError('Selecione um workspace.'); return w; };
    const locationPath = (loc: GitLocation) => (loc.kind === 'root' ? requireWs().path : worktrees.activePath(requireWs(), loc.id));
    // Monitoramento: raiz + worktrees ativos; avisa o renderer para atualizar Explorer/Git.
    let stopWatchers: Array<() => void> = [];
    const rewatch = async () => {
      stopWatchers.forEach((f) => f());
      stopWatchers = [];
      const w = wsRef();
      if (!w) return;
      const notify = () => send(IPC_EVENTS.fsChanged, {});
      stopWatchers.push(watchTree(w.path, notify));
      for (const wt of await worktrees.list(w)) if (wt.present && wt.status !== 'removed') stopWatchers.push(watchTree(worktrees.activePath(w, wt.id), notify));
    };
    const worktreesChanged = async () => { await rewatch(); send(IPC_EVENTS.worktreesChanged, {}); };
    const tasks = new TaskScheduler({
      repo: new TaskRepository(db),
      approvals: new ApprovalRepository(db),
      bus,
      guard,
      workspace: () => { const id = workspace.currentId(); const path = workspace.currentPath(); return id && path ? { id, path } : null; },
      maxRounds: () => settings.getAll().maxReviewRounds,
      snapshot: (task) => {
        const ws = requireWs();
        if (task.worktreeId) { const b = worktrees.baseOf(ws, task.worktreeId); return git.reviewSnapshot(b.path, b.baseSha); }
        return git.reviewSnapshot(ws.path);
      },
      agentCwd: (a) => agentService.adapter(a).runningCwd(),
      worktreePath: (id) => { try { return worktrees.activePath(requireWs(), id); } catch { return null; } },
      audit: (action, target, metadata) => audit.record(action, target, metadata),
      emit: (task) => send(IPC_EVENTS.taskUpdated, task),
    });
    /** Erros esperados (regras de negócio) viram mensagem para o usuário; o resto é erro interno. */
    const expected = <T>(fn: () => T): { ok: true; value: T } | { ok: false; reason: string } => {
      try { return { ok: true, value: fn() }; }
      catch (e) { if (e instanceof BusError || e instanceof TaskError || e instanceof GitOpError || e instanceof ExplorerError) return { ok: false, reason: e.message }; throw e; }
    };
    const expectedAsync = async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> => {
      try { return { ok: true, value: await fn() }; }
      catch (e) { if (e instanceof BusError || e instanceof TaskError || e instanceof GitOpError || e instanceof ExplorerError) return { ok: false, reason: e.message }; throw e; }
    };
    await workspace.restore(settings.getAll().lastWorkspaceId);
    await rewatch();

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
          await worktreesChanged();
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
      [IPC.agentStart]: async ({ agent, kind, cols, rows, permission, worktreeId }) => {
        try {
          let at: { path: string; id: string; name: string } | undefined;
          if (worktreeId) { const ws = requireWs(); const info = await worktrees.get(ws, worktreeId); if (!info.present || info.status === 'removed') throw new GitOpError('Este worktree não está disponível.'); at = { path: worktrees.activePath(ws, worktreeId), id: worktreeId, name: info.name }; }
          return { ok: true, value: await agentService.start(agent, kind, cols, rows, permission, at) };
        }
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
      [IPC.tasksCreate]: ({ worktree, ...input }) => expectedAsync(async () => {
        if (!worktree) return tasks.create(input);
        // Modo paralelo: confirma o worktree antes de criar a tarefa.
        const ws = requireWs();
        const name = slugify(input.title);
        const plan = await worktrees.previewCreate(ws, name, (await worktrees.status(ws.path)).branch ?? 'HEAD');
        if (!(await confirmWorktreeCreate(mainWindow, plan))) return null;
        const task = tasks.create(input);
        const wt = await worktrees.create(ws, plan, { name, agent: input.developer, taskId: task.id });
        await worktreesChanged();
        return tasks.attachWorktree(task.id, wt.id);
      }),
      [IPC.tasksPreview]: ({ taskId, action, notes }) => expectedAsync(() => tasks.preview(taskId, action, notes)),
      [IPC.tasksSend]: ({ taskId, action, content }) => expectedAsync(() => tasks.send(taskId, action, content)),
      [IPC.tasksDecide]: ({ taskId, decision, note }) => expected(() => tasks.decide(taskId, decision, note)),
      [IPC.usageGet]: () => usageService.report(),
      [IPC.usageRefresh]: () => usageService.refresh(),
      [IPC.gitStatus]: async ({ location }): Promise<RepoStatus> => {
        try { return await worktrees.status(locationPath(location)); }
        catch { return { isRepo: false, hasCommits: false, branch: null, headSha: null, branches: [], clean: true, files: [] }; }
      },
      [IPC.explorerList]: ({ location, rel }) => expectedAsync(async () => { const p = locationPath(location); return listDir(p, rel, (await worktrees.status(p)).files); }),
      [IPC.explorerDiff]: ({ location, rel }) => expectedAsync(() => worktrees.fileDiff(locationPath(location), rel, location.kind === 'worktree' ? worktrees.baseOf(requireWs(), location.id).baseSha : null)),
      [IPC.worktreesList]: async () => { const ws = wsRef(); return ws ? worktrees.list(ws) : []; },
      [IPC.worktreesCreate]: ({ name, baseRef, agent }) => expectedAsync(async () => {
        const ws = requireWs();
        const plan = await worktrees.previewCreate(ws, name, baseRef);
        if (!(await confirmWorktreeCreate(mainWindow, plan))) return null;
        const wt = await worktrees.create(ws, plan, { name, agent, taskId: null });
        await worktreesChanged();
        return wt;
      }),
      [IPC.worktreesFiles]: ({ id }) => expectedAsync(() => worktrees.files(requireWs(), id)),
      [IPC.worktreesCommit]: ({ id, message }) => expectedAsync(async () => { const sha = await worktrees.commit(requireWs(), id, message); send(IPC_EVENTS.worktreesChanged, {}); return sha; }),
      [IPC.worktreesCheckMerge]: ({ id }) => expectedAsync(() => worktrees.checkMerge(requireWs(), id)),
      [IPC.worktreesMerge]: ({ id }) => expectedAsync(async () => {
        const ws = requireWs();
        const check = await worktrees.checkMerge(ws, id);
        if (!check.canMerge) throw new GitOpError([...check.blockers, ...(check.conflicts.length ? [`Conflitos previstos em: ${check.conflicts.join(', ')}.`] : [])].join(' '));
        const info = await worktrees.get(ws, id);
        const ok = await confirmNative(mainWindow, 'Integrar worktree', `Integrar ${info.branch} em ${check.targetBranch}?`, [
          `${info.ahead} commit(s) serão integrados com merge --no-ff na raiz do workspace.`,
          'Nenhum conflito previsto (verificado com git merge-tree, sem alterar nada).',
          'Depois você pode desfazer com "Desfazer integração" (git revert, histórico preservado). Nada é enviado ao remoto.',
        ], 'Integrar');
        if (!ok) return null;
        const r = await worktrees.merge(ws, id);
        await worktreesChanged();
        return r;
      }),
      [IPC.worktreesRevert]: ({ id }) => expectedAsync(async () => {
        const ws = requireWs();
        const info = await worktrees.get(ws, id);
        const ok = await confirmNative(mainWindow, 'Desfazer integração', `Desfazer a integração de ${info.branch}?`, [
          `Cria um commit novo que reverte o merge ${info.mergedSha ?? ''} (git revert -m 1).`,
          'O histórico não é reescrito. Se houver conflito, a operação é abortada sem mudanças.',
        ], 'Desfazer integração');
        if (!ok) return null;
        const r = await worktrees.revert(ws, id);
        await worktreesChanged();
        return r;
      }),
      [IPC.worktreesRemove]: ({ id, deleteBranch }) => expectedAsync(async () => {
        const ws = requireWs();
        const impact = await worktrees.removalImpact(ws, id);
        const losses = [
          impact.uncommitted > 0 ? `${impact.uncommitted} arquivo(s) com alterações NÃO commitadas serão DESCARTADOS.` : 'Não há alterações não commitadas.',
          deleteBranch ? (impact.unmergedCommits > 0 ? `O branch ${impact.branch} será APAGADO com ${impact.unmergedCommits} commit(s) não integrados (perda definitiva).` : `O branch ${impact.branch} será apagado (já integrado).`) : `O branch ${impact.branch} será mantido.`,
        ];
        const ok = await confirmNative(mainWindow, 'Remover worktree', `Remover o worktree de ${impact.branch}?`, losses, 'Remover');
        if (!ok) return false;
        await worktrees.remove(ws, id, deleteBranch, true);
        await worktreesChanged();
        return true;
      }),
      [IPC.worktreesOpenFolder]: ({ id }) => expectedAsync(async () => {
        const err = await shell.openPath(worktrees.activePath(requireWs(), id));
        if (err) throw new GitOpError(err);
        return true;
      }),
    };
    registerIpc(handlers, () => mainWindow, log);

    mainWindow = createMainWindow();
    mainWindow.on('closed', () => { mainWindow = null; });

    usageService.start();

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
  app.on('will-quit', () => { usage?.stop(); try { db?.close(); } catch { /* já fechado */ } });
}

/** Confirmação final da instalação em diálogo nativo do main (não pode ser forjada pelo renderer). */
/** Confirmação genérica em diálogo nativo do main (não pode ser forjada pelo renderer). */
async function confirmNative(win: BrowserWindow | null, title: string, message: string, details: string[], okLabel: string): Promise<boolean> {
  const opts: Electron.MessageBoxOptions = { type: 'question', title, message, detail: details.join('\n\n'), buttons: ['Cancelar', okLabel], defaultId: 0, cancelId: 0, noLink: true };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return response === 1;
}

function confirmWorktreeCreate(win: BrowserWindow | null, plan: import('@shared/git').WorktreeCreatePreview): Promise<boolean> {
  return confirmNative(win, 'Criar worktree', `Criar o branch ${plan.branch} num worktree?`, [
    `Base: ${plan.baseRef} (${plan.baseSha.slice(0, 10)}).`,
    `Pasta: ${plan.displayPath} (fora do projeto, gerenciada pelo DevFusion).`,
    plan.rootUncommitted > 0 ? `ATENÇÃO: a raiz tem ${plan.rootUncommitted} arquivo(s) com alterações não commitadas; elas NÃO vão para o worktree.` : 'A raiz está limpa.',
    `Comando: ${plan.commands.join(' ; ')}`,
    'Worktree reduz colisões entre agentes, mas não é sandbox de segurança.',
  ], 'Criar');
}

/** "Login seguro com 2FA" → "login-seguro-com-2fa" (limite de 30). */
function slugify(title: string): string {
  const s = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
  return s.length >= 2 ? s : 'tarefa';
}

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

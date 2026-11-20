import { app, session, type BrowserWindow, type WebFrameMain, type WebPreferences } from 'electron';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../logging/logger';
import { openExternalUrl } from '../system/externalOpen';

export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    spellcheck: false,
    devTools: !app.isPackaged,
  };
}

/** Origem permitida do renderer: servidor de dev do Vite ou o index.html empacotado. */
export function rendererEntry(): { kind: 'url'; url: string } | { kind: 'file'; file: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) return { kind: 'url', url: devUrl };
  return { kind: 'file', file: join(__dirname, '../renderer/index.html') };
}

export function isAllowedRendererUrl(rawUrl: string): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  const entry = rendererEntry();
  if (entry.kind === 'url') return url.origin === new URL(entry.url).origin;
  return url.protocol === 'file:' && samePath(fileUrlToPath(url), entry.file);
}

function fileUrlToPath(url: URL): string | null {
  try { return normalize(fileURLToPath(url)); } catch { return null; }
}

function samePath(a: string | null, b: string): boolean {
  if (a === null) return false;
  const nb = normalize(b);
  return process.platform === 'win32' ? a.toLowerCase() === nb.toLowerCase() : a === nb;
}

/** Só o frame principal da janela do app, carregado da origem esperada, é confiável. */
export function isTrustedFrame(frame: WebFrameMain | null | undefined, win: BrowserWindow | null): boolean {
  if (!frame || !win || win.isDestroyed()) return false;
  if (frame !== win.webContents.mainFrame) return false;
  return isAllowedRendererUrl(frame.url);
}

/** Endurece sessão e webContents: sem navegação, popups, webviews ou permissões. */
export function hardenSession(log: Logger): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => { log.warn('Permissão negada', { permission }); cb(false); });
  ses.setPermissionCheckHandler(() => false);
  // Nenhuma requisição de rede a partir do renderer além da própria origem do app.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith('devtools://') || isAllowedRendererUrl(details.url) || isSameAppResource(details.url);
    if (!ok) log.warn('Requisição bloqueada', { url: details.url.slice(0, 200) });
    cb({ cancel: !ok });
  });
}

function isSameAppResource(rawUrl: string): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  const entry = rendererEntry();
  if (entry.kind === 'url') {
    const dev = new URL(entry.url);
    return url.origin === dev.origin || (url.protocol === 'ws:' && url.host === dev.host);
  }
  if (url.protocol !== 'file:') return false;
  const target = fileUrlToPath(url);
  if (target === null) return false;
  const rendererDir = normalize(dirname(entry.file)) + sep;
  return process.platform === 'win32' ? target.toLowerCase().startsWith(rendererDir.toLowerCase()) : target.startsWith(rendererDir);
}

export function hardenWindow(win: BrowserWindow, log: Logger): void {
  const wc = win.webContents;
  wc.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) { event.preventDefault(); log.warn('Navegação bloqueada', { url: url.slice(0, 200) }); }
  });
  wc.on('will-redirect', (event, url) => { if (!isAllowedRendererUrl(url)) event.preventDefault(); });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    // Links externos (https) abrem no navegador do sistema; nada abre dentro do app.
    if (/^https:\/\//i.test(url)) void openExternalUrl(url).catch((e: unknown) => log.warn('Falha ao abrir link externo', e));
    return { action: 'deny' };
  });
}

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Lança pela raiz do projeto (como `electron .`): o Electron lê package.json → main e versão.
const APP_ROOT = resolve(__dirname, '../..');
const APP_VERSION = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version;

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  // Ambiente mínimo: sem credenciais/API keys herdadas do shell de teste.
  const env: Record<string, string> = { DEVFUSION_USER_DATA_DIR: userDataDir, PATH: process.env['PATH'] ?? '' };
  for (const k of ['HOME', 'USER', 'TMPDIR', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP']) {
    const v = process.env[k]; if (v) env[k] = v;
  }
  const app = await electron.launch({ args: [APP_ROOT], env });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="status-bar"]');
  return { app, page };
}

let dir: string;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-')); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test('janela abre com preferências web seguras', async () => {
  const { app } = await launch(dir);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() existe em runtime mas não está nos tipos públicos do Electron 45.
    // Os testes seguintes verificam as mesmas garantias pelo comportamento do renderer.
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> };
    const p = wc.getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity, webviewTag: p.webviewTag };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false });
  await app.close();
});

test('renderer não tem acesso a Node e só vê a API mínima', async () => {
  const { app, page } = await launch(dir);
  const probe = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const api = w['devfusion'] as Record<string, Record<string, unknown>>;
    return {
      require: typeof w['require'], process: typeof w['process'], ipcRenderer: typeof w['ipcRenderer'], electron: typeof w['electron'],
      apiKeys: Object.keys(api).sort(), appKeys: Object.keys(api['app']!).sort(), settingsKeys: Object.keys(api['settings']!).sort(),
      frozen: Object.isFrozen(api),
    };
  });
  expect(probe).toEqual({ require: 'undefined', process: 'undefined', ipcRenderer: 'undefined', electron: 'undefined', apiKeys: ['app', 'settings'], appKeys: ['getInfo'], settingsKeys: ['getAll', 'set'], frozen: true });
  await app.close();
});

test('CSP de produção está presente e bloqueia script inline e rede externa', async () => {
  const { app, page } = await launch(dir);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'none'");
  const blocked = await page.evaluate(async () => {
    const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s);
    let fetchBlocked = false;
    try { await fetch('https://example.com'); } catch { fetchBlocked = true; }
    return { inlineRan: (window as unknown as { __inline?: number }).__inline === 1, fetchBlocked };
  });
  expect(blocked).toEqual({ inlineRan: false, fetchBlocked: true });
  await app.close();
});

test('IPC rejeita argumentos inválidos vindos do renderer', async () => {
  const { app, page } = await launch(dir);
  const results = await page.evaluate(async () => Promise.all([
    window.devfusion.settings.set('theme', 'roxo'),
    window.devfusion.settings.set('naoExiste', 1),
    window.devfusion.settings.set('__proto__', 'dark'),
  ]));
  for (const r of results) expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  await app.close();
});

test('navegação e popups são bloqueados', async () => {
  const { app, page } = await launch(dir);
  const before = page.url();
  await page.evaluate(() => { window.location.href = 'https://example.com'; });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  const popup = await page.evaluate(() => window.open('https://example.com') === null);
  expect(popup).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await app.close();
});

test('layout inicial mostra estados reais, sem dados simulados', async () => {
  const { app, page } = await launch(dir);
  await expect(page.getByTestId('workspace-name')).toHaveText('nenhum selecionado');
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão não iniciada');
  await expect(page.getByTestId('agent-status-codex')).toHaveText('sessão não iniciada');
  await expect(page.getByTestId('chat-empty')).toHaveText('Nenhuma mensagem.');
  await expect(page.getByRole('button', { name: 'Parar tudo' })).toBeDisabled();
  await expect(page.getByTestId('status-db')).toContainText(`DevFusion ${APP_VERSION} ·`);
  await expect(page.getByTestId('status-db')).toContainText('Banco v1');
  await app.close();
});

test('tema escolhido persiste no SQLite entre reinícios', async () => {
  let { app, page } = await launch(dir);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByTestId('theme-light').check();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await app.close();

  ({ app, page } = await launch(dir));
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await expect(page.getByTestId('theme-light')).toBeChecked();
  await app.close();
});

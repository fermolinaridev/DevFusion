import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { APP_ROOT, launch, passOnboarding, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex', { ignoreSigint: true, ignoreSigterm: true }));
  ws = join(realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-ws-'))), 'proj'); mkdirSync(ws);
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

async function startBoth(page: import('@playwright/test').Page, app: import('@playwright/test').ElectronApplication) {
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('start-claude').click();
  await page.getByTestId('start-codex').click();
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('claude falso');
  await expect(page.locator('[data-testid="terminal-codex"] .xterm-rows')).toContainText('codex falso');
  return (await page.evaluate(async () => (await window.devfusion.agents.list()).ok ? (await window.devfusion.agents.list() as { ok: true; data: Array<{ pid: number }> }).data.map((a) => a.pid) : [])) as number[];
}

test('renderer que cai é recarregado; agentes continuam vivos e terminais reanexados', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  const pids = await startBoth(page, app);
  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('antes da queda');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('eco: antes da queda');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer());
  // O Playwright não acompanha a página depois da queda; inspecionamos a janela recarregada pelo main.
  const inWindow = (js: string) => app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(code), js);
  await expect.poll(() => inWindow(`!!document.querySelector('[data-testid="status-bar"]')`).catch(() => false), { timeout: 20_000 }).toBe(true);
  expect(pids.every(alive)).toBe(true);
  await expect.poll(() => inWindow(`document.querySelector('[data-testid="agent-status-claude"]')?.textContent`)).toBe('sessão ativa');
  // Terminal reanexado pelo buffer e entrada funcionando (controle de fluxo zerado).
  await expect.poll(() => inWindow(`document.querySelector('[data-testid="terminal-claude"] .xterm-rows')?.textContent ?? ''`), { timeout: 10_000 }).toContain('eco: antes da queda');
  await inWindow(`window.devfusion.terminal.write('claude', 'depois da queda\\r')`);
  await expect.poll(() => inWindow(`document.querySelector('[data-testid="terminal-claude"] .xterm-rows')?.textContent ?? ''`), { timeout: 10_000 }).toContain('eco: depois da queda');
  const log = readFileSync(join(dir, 'logs', 'main.log'), 'utf8');
  expect(log).toContain('Renderer encerrado inesperadamente');
  await app.close().catch(() => undefined);
});

test('processo main morto à força (SIGKILL) não deixa agentes órfãos', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  const pids = await startBoth(page, app);
  expect(pids).toHaveLength(2);
  app.process().kill('SIGKILL');
  // Codex falso ignora SIGINT e SIGTERM; ainda assim morre quando o terminal (PTY) fecha.
  await expect.poll(() => pids.filter(alive).length, { timeout: 15_000 }).toBe(0);
});

test('banco ilegível: o app explica, não apaga o arquivo e registra no log', async () => {
  writeFileSync(join(dir, 'devfusion.sqlite'), 'corrompido '.repeat(500));
  const before = readFileSync(join(dir, 'devfusion.sqlite'));
  const electron = require('electron') as unknown as string; // caminho do binário
  const child = spawn(electron, [APP_ROOT], { env: { ...process.env, DEVFUSION_USER_DATA_DIR: dir, DEVFUSION_TOOL_PATH: tools.dir } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  await expect.poll(() => out, { timeout: 20_000 }).toContain('Banco de dados ilegível');
  child.kill('SIGKILL');
  expect(readFileSync(join(dir, 'devfusion.sqlite')).equals(before)).toBe(true);
  expect(readdirSync(dir).filter((f) => f.includes('ilegivel'))).toEqual([]); // nada movido sem o usuário escolher
});

test('exportar diagnóstico: arquivo sanitizado com versões, Doctor e log', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  const out = join(dir, 'diag.json');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, out);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByTestId('diagnostics-export').click();
  await expect(page.getByTestId('diagnostics-msg')).toContainText('Diagnóstico salvo');
  const raw = readFileSync(out, 'utf8');
  const d = JSON.parse(raw) as { format: string; app: { version: string }; doctor: unknown[]; log: string[] };
  expect(d.format).toBe('devfusion-diagnostics/1');
  expect(d.doctor.length).toBeGreaterThan(5);
  expect(d.log.some((l) => l.includes('iniciando'))).toBe(true);
  expect(raw).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  expect(raw).not.toContain(process.env['HOME']!);
  await app.close();
});

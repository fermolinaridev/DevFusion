import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubConfirmDialog, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex'));
  ws = join(realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-ws-'))), 'site'); mkdirSync(ws);
  const g = (...a: string[]) => execFileSync('git', ['-C', ws, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(ws, 'index.ts'), 'export const titulo = "antigo";\n'); writeFileSync(join(ws, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  g('add', '.'); g('commit', '-q', '-m', 'init');
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

async function open(page: Page, app: Parameters<typeof stubOpenDialog>[0]) {
  await passOnboarding(page);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByTestId('cli-path-git').fill(execFileSync('which', ['git']).toString().trim());
  await page.getByTestId('cli-path-git-save').click();
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await expect(page.getByTestId('workspace-name')).toHaveText('site');
}

test('editor Monaco: carrega sob demanda, edita, salva, detecta alteração externa e recusa binário', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused/.test(m.text())) errors.push(m.text()); });
  await open(page, app);
  const before = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /monaco/.test(r.name)).length);
  expect(before).toBe(0); // nada do Monaco carregado antes de abrir um arquivo

  await page.getByRole('button', { name: 'Explorer' }).click();
  await page.getByTestId('explorer-item-index.ts').click();
  await expect(page.locator('[data-testid="monaco-host"] .monaco-editor')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="monaco-host"] .view-lines')).toContainText('export const titulo = "antigo";');
  // Os terminais continuam montados (só ficam invisíveis).
  await expect(page.getByTestId('agent-pane-claude')).toBeAttached();

  await page.locator('[data-testid="monaco-host"] .view-lines').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type('export const titulo = "novo";');
  await expect(page.getByTestId('editor-dirty')).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0);
  expect(readFileSync(join(ws, 'index.ts'), 'utf8')).toBe('export const titulo = "novo";');

  // Alteração externa (ex.: um agente) → salvar abre o conflito, nada é sobrescrito sem escolha.
  writeFileSync(join(ws, 'index.ts'), 'export const titulo = "do agente";\n');
  await page.locator('[data-testid="monaco-host"] .view-lines').click();
  await page.keyboard.type(' // meu');
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-conflict')).toBeVisible();
  expect(readFileSync(join(ws, 'index.ts'), 'utf8')).toBe('export const titulo = "do agente";\n');
  await page.getByTestId('editor-overwrite').click();
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0);
  expect(readFileSync(join(ws, 'index.ts'), 'utf8')).toContain('// meu');

  // Binário recusado.
  await page.getByTestId('explorer-item-logo.png').click();
  await expect(page.getByTestId('editor-error')).toContainText('binário');

  // Voltar aos agentes pela aba.
  await page.getByTestId('tab-agents').click();
  await expect(page.getByTestId('agent-pane-codex')).toBeVisible();
  expect(errors.filter((e) => /Content Security Policy|Refused|Worker/i.test(e))).toEqual([]);
  await app.close();
});

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('dashboard, histórico (busca, exportar, apagar), modos de conversa e atalhos', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await open(page, app);

  // Dashboard é a vista inicial, com dados reais.
  await page.keyboard.press(`${MOD}+1`);
  await expect(page.getByTestId('dashboard-view')).toBeVisible();
  await expect(page.getByTestId('dash-recent')).toContainText('site (atual)');
  await expect(page.getByTestId('dash-agent-claude')).toContainText('sem sessão');

  // Modo debate: mesmo texto para os dois, com modelo; nada é submetido.
  await page.getByTestId('start-claude').click();
  await page.getByTestId('start-codex').click();
  await expect(page.locator('[data-testid="terminal-codex"] .xterm-rows')).toContainText('codex falso');
  await page.getByTestId('chat-mode').selectOption('debate');
  await expect(page.getByTestId('chat-target')).toBeDisabled();
  await expect(page.locator('#chat-mode option[value="autonomous"]')).toBeDisabled();
  await page.keyboard.press(`${MOD}+K`);
  await expect(page.getByTestId('chat-input')).toBeFocused();
  await page.keyboard.type('qual banco usar?');
  await expect(page.getByTestId('chat-mode-preview')).toContainText('Modo debate');
  await page.getByTestId('chat-send').click();
  for (const a of ['claude', 'codex']) await expect(page.locator(`[data-testid="terminal-${a}"] .xterm-rows`)).toContainText('Modo debate (DevFusion)');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).not.toContainText('eco:');

  // Histórico: busca, exportar (diálogo nativo simulado) e apagar com confirmação.
  await page.keyboard.press(`${MOD}+7`);
  await expect(page.getByTestId('sessions-view')).toBeVisible();
  await page.getByTestId('history-query').fill('banco');
  await page.getByTestId('history-search').click();
  await expect(page.getByTestId('history-results')).toContainText('qual banco usar?');
  await expect(page.getByTestId('session-list')).toContainText('Claude Code');
  const exportPath = join(dir, 'export.json');
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, exportPath);
  await page.getByTestId('history-export').click();
  await expect(page.getByTestId('history-msg')).toContainText('Exportado');
  const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as { format: string; messages: Array<{ content: string }> };
  expect(exported.format).toBe('devfusion-history/1');
  expect(exported.messages.some((m) => m.content.includes('qual banco usar?'))).toBe(true);
  await stubConfirmDialog(app, 0);
  await page.getByTestId('history-delete').click();
  await expect(page.getByTestId('history-overview')).toContainText('1 mensagem');
  await stubConfirmDialog(app, 1);
  await page.getByTestId('history-delete').click();
  await expect(page.getByTestId('history-msg')).toContainText('Apagados: 1 mensagem');
  await expect(page.getByTestId('chat-message')).toHaveCount(0);

  // Atalhos: ajuda e foco no terminal; tamanho da fonte aplicado ao terminal.
  await page.keyboard.press(`${MOD}+Shift+/`);
  await expect(page.getByTestId('shortcuts-help')).toContainText('Parar tudo');
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${MOD}+8`);
  await page.getByTestId('font-size').fill('18');
  await expect.poll(() => page.locator('[data-testid="terminal-claude"] .xterm-rows').evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');
  await page.keyboard.press(`${MOD}+Shift+.`);
  await expect(page.getByTestId('agent-status-claude')).toHaveText(/encerrada/);
  await app.close();
});

test('reabrir projeto recente pelo Dashboard', async () => {
  const outro = join(ws, '..', 'outro'); mkdirSync(outro);
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await open(page, app);
  await stubOpenDialog(app, outro);
  await page.getByTestId('workspace-choose').click();
  await expect(page.getByTestId('workspace-name')).toHaveText('outro');
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByTestId('dash-open-site').click();
  await expect(page.getByTestId('workspace-name')).toHaveText('site');
  rmSync(outro, { recursive: true, force: true });
  await page.getByRole('button', { name: 'Explorer' }).click();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('dash-recent')).toContainText('pasta não encontrada');
  await app.close();
});

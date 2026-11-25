import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubOpenDialog } from './launch';

let dir: string; let tools: FakeToolDir; let ws: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  ws = join(mkdtempSync(join(tmpdir(), 'devfusion-ws-')), 'proj'); mkdirSync(ws);
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); });

/** Simula o arquivo que a statusline oficial do Claude grava. */
function claudeWeek(percent: number): void {
  writeFileSync(join(dir, 'usage', 'claude-rate-limits.json'), JSON.stringify({
    receivedAt: new Date().toISOString(),
    rate_limits: { five_hour: { used_percentage: 1, resets_at: Math.floor(Date.now() / 1000) + 3600 }, seven_day: { used_percentage: percent, resets_at: 1_900_000_000 } },
  }));
}

test('limite semanal: barra abaixo dos terminais mostra 8% → 23%, para no limite e recomeça', async () => {
  let { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  const bar = page.getByTestId('budget-bar');
  await expect(bar).toBeVisible();
  const pane = (await page.getByTestId('agent-pane-claude').boundingBox())!;
  expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(pane.y + pane.height - 1);
  await expect(page.getByTestId('budget-claude')).toHaveCount(0);

  claudeWeek(8);
  await page.getByTestId('budget-enabled').check();
  await expect(page.getByTestId('budget-percent')).toHaveValue('15');
  await expect(page.getByTestId('budget-claude-text')).toHaveText('0% de 15% · semana 8% → 23%', { timeout: 20_000 });
  await expect(page.getByTestId('budget-codex-text')).toHaveText('aguardando leitura');
  claudeWeek(10);
  await expect(page.getByTestId('budget-claude-text')).toHaveText('2% de 15% · semana 10% → 23%', { timeout: 20_000 });
  if (process.env['DEVFUSION_SHOT']) await page.screenshot({ path: process.env['DEVFUSION_SHOT'] });
  claudeWeek(23);
  await expect(page.getByTestId('budget-claude-stop')).toHaveText('parado: atingiu o limite', { timeout: 20_000 });
  await app.close();

  // Continua parado ao reabrir; aumentar o limite libera; Recomeçar conta do uso atual.
  ({ app, page } = await launch(dir, { toolDir: tools.dir }));
  await passOnboarding(page);
  await expect(page.getByTestId('budget-claude-stop')).toBeVisible();
  await page.getByTestId('budget-percent').fill('40');
  await page.getByTestId('budget-percent').press('Enter');
  await expect(page.getByTestId('budget-claude-stop')).toHaveCount(0);
  await page.getByTestId('budget-restart').click();
  await expect(page.getByTestId('budget-claude-text')).toHaveText('0% de 40% · semana 23% → 63%');
  await app.close();
});

test('limite semanal: a sessão do agente é encerrada e não reinicia enquanto o limite valer', async () => {
  test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex'));
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  claudeWeek(8);
  await page.getByTestId('budget-enabled').check();
  await expect(page.getByTestId('budget-claude-text')).toContainText('semana 8%', { timeout: 20_000 });
  await page.getByTestId('start-claude').click();
  await page.getByTestId('start-codex').click();
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão ativa');
  await expect(page.getByTestId('agent-status-codex')).toHaveText('sessão ativa');
  claudeWeek(23);
  await expect(page.getByTestId('agent-status-claude')).toContainText('sessão encerrada', { timeout: 30_000 });
  await expect(page.getByTestId('agent-status-codex')).toHaveText('sessão ativa');
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-error-claude')).toContainText('Limite semanal de 15% atingido');
  await page.getByTestId('budget-restart').click();
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão ativa');
  await page.getByTestId('stop-all').click();
  await expect(page.getByTestId('mode-direct')).toBeEnabled({ timeout: 15_000 });
  await app.close();
});

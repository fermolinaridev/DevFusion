import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  ws = join(mkdtempSync(join(tmpdir(), 'devfusion-ws-')), 'proj'); mkdirSync(ws);
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

const now = () => Math.floor(Date.now() / 1000);

test('painel de uso: Codex pelo App Server (só leitura) e Claude pela statusline oficial', async () => {
  const log = join(tools.dir, 'rpc.log');
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', {
    ...SPECS.interactiveAgent('codex'),
    'app-server': { jsonrpc: { logFile: log, results: { 'account/rateLimits/read': {
      rateLimits: { primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: now() + 2 * 3600 + 600 }, secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: now() + 3 * 86400 }, planType: 'plus' },
      ordinaryUsageAllowed: true, rateLimitResetCredits: { availableCount: 1 },
    } } } },
  });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await page.getByRole('button', { name: 'Uso dos planos' }).click();

  const codex = page.getByTestId('usage-codex');
  await expect(codex).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('usage-codex-300-percent')).toHaveText('37% usado');
  await expect(page.getByTestId('usage-codex-10080-percent')).toHaveText('12% usado');
  await expect(codex).toContainText('reinicia em 2 h');
  await expect(codex).toContainText('plano plus');
  await expect(page.getByTestId('usage-codex-reset-credits')).toContainText('o DevFusion só exibe');
  await expect(page.getByTestId('status-usage')).toContainText('Codex 37%');

  // Claude: sem sessão ainda → sem dados, com explicação.
  await expect(page.getByTestId('usage-claude')).toHaveAttribute('data-status', 'no-data');
  await expect(page.getByTestId('usage-claude-note')).toContainText('depois da primeira resposta');

  // Sessão do Claude recebe a statusline do DevFusion pela flag oficial --settings.
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('start-claude').click();
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('claude falso');
  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('args');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('--settings');
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('statusLine');
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão ativa');

  // O Claude Code roda o comando da statusline; aqui simulamos o arquivo que o script grava.
  writeFileSync(join(dir, 'usage', 'claude-rate-limits.json'), JSON.stringify({
    receivedAt: new Date().toISOString(),
    rate_limits: { five_hour: { used_percentage: 64.4, resets_at: now() + 3600 }, seven_day: { used_percentage: 91, resets_at: now() + 5 * 86400 } },
  }));
  await expect(page.getByTestId('usage-claude')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('usage-claude-300-percent')).toHaveText('64.4% usado');
  await expect(page.getByTestId('usage-claude-10080-percent')).toHaveText('91% usado');
  await expect(page.getByTestId('usage-claude-updated')).toContainText('agora há pouco');
  await expect(page.getByTestId('status-usage')).toContainText('Claude 64.4%');

  // Atualizar consulta de novo; o App Server só recebeu métodos de leitura.
  await page.getByTestId('usage-refresh').click();
  await expect(page.getByTestId('usage-refresh')).toHaveText('Atualizar');
  const methods = readFileSync(log, 'utf8').trim().split('\n');
  expect(new Set(methods)).toEqual(new Set(['initialize', 'initialized', 'account/rateLimits/read']));
  expect(methods.filter((m) => m === 'account/rateLimits/read').length).toBeGreaterThanOrEqual(2);
  await app.close();
});

test('Codex sem login: card explica e não inventa números', async () => {
  tools.add('codex', { ...SPECS.codex(false), 'app-server': { jsonrpc: { results: {}, errors: { 'account/rateLimits/read': 'authentication required' } } } });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await page.getByRole('button', { name: 'Uso dos planos' }).click();
  await expect(page.getByTestId('usage-codex')).toHaveAttribute('data-status', 'unavailable');
  await expect(page.getByTestId('usage-codex-note')).toContainText('Faça login no Codex');
  await expect(page.getByTestId('usage-codex').getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByTestId('status-usage')).toContainText('Codex —');
  await app.close();
});

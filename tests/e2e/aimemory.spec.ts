import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubConfirmDialog, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string; let runLog: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex'));
  runLog = join(dir, 'ai-memory-run.json');
  ws = join(realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-ws-'))), 'proj'); mkdirSync(ws);
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

const termText = (page: import('@playwright/test').Page, agent: string) => page.locator(`[data-testid="terminal-${agent}"] .xterm-rows`);

test('ai-memory: Doctor detecta, ligar exige confirmação nativa e o agente inicia por `ai-memory run`', async () => {
  tools.add('ai-memory', {
    '--version': { stdout: 'ai-memory 3.5.1\n' },
    'status --json': { stdout: '{"server":"ok"}\n' },
    run: { wrapRun: { logFile: runLog } },
  });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await expect(page.getByTestId('ai-memory-check')).toContainText('ai-memory 3.5.1 — Instalado; servidor local respondendo.');

  // Recusar no diálogo nativo não liga nada.
  await stubConfirmDialog(app, 0);
  await page.getByTestId('ai-memory-run-agents').click();
  await expect(page.getByTestId('ai-memory-run-agents')).not.toBeChecked();

  // Sem a integração, o agente inicia direto (nenhum `ai-memory run`).
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('start-codex').click();
  await expect(termText(page, 'codex')).toContainText('codex falso');
  expect(existsSync(runLog)).toBe(false);
  await page.getByTestId('stop-all').click();
  await expect(page.getByTestId('agent-status-codex')).not.toHaveText('sessão ativa');

  // Aceitar liga; a próxima sessão passa pelo wrapper com o binário validado e os args nativos.
  await stubConfirmDialog(app, 1);
  await page.getByTestId('ai-memory-run-agents').check();
  await expect(page.getByTestId('ai-memory-run-agents')).toBeChecked();
  await page.getByTestId('start-claude').click();
  await expect(termText(page, 'claude')).toContainText('claude falso');
  const argv = JSON.parse(readFileSync(runLog, 'utf8')) as string[];
  expect(argv.slice(0, 3)).toEqual(['run', '--no-exit-prompt', '--executable']);
  expect(argv[3]).toBe(join(tools.dir, 'claude'));
  expect(argv[4]).toBe('claude');
  expect(argv).toContain('--settings'); // statusline de uso continua chegando ao Claude

  // Entrada e saída passam pelo wrapper; Parar tudo encerra (sem menu de saída do ai-memory).
  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('via memoria');
  await page.keyboard.press('Enter');
  await expect(termText(page, 'claude')).toContainText('eco: via memoria');
  await page.getByTestId('stop-all').click();
  await expect(page.getByTestId('agent-status-claude')).not.toHaveText('sessão ativa', { timeout: 15_000 });
  await app.close();
});

test('ai-memory ligado mas ausente: o agente não inicia e o erro explica o que fazer', async () => {
  tools.add('ai-memory', { '--version': { stdout: 'ai-memory 3.5.1\n' }, 'status --json': { stdout: '{}\n' }, run: { wrapRun: { logFile: runLog } } });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await expect(page.getByTestId('ai-memory-check')).toContainText('servidor local respondendo');
  await stubConfirmDialog(app, 1);
  await page.getByTestId('ai-memory-run-agents').check();
  await expect(page.getByTestId('ai-memory-run-agents')).toBeChecked();
  rmSync(join(tools.dir, 'ai-memory'));
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-error-claude')).toContainText('ai-memory não foi encontrado');
  expect(existsSync(runLog)).toBe(false);
  await app.close();
});

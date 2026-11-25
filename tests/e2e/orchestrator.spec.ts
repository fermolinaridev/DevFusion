import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { addFakeCodexWithExec } from '../helpers/fakeCodexExec';
import { launch, passOnboarding, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string; let argvLog: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  argvLog = join(dir, 'lead-argv.json');
  tools = new FakeToolDir();
  // '*': sessão interativa também com as flags do orquestrador (--model, --agents…), registrando o argv.
  tools.add('claude', { ...SPECS.interactiveAgent('claude'), '*': { interactive: { banner: 'claude falso', argvLog } } });
  addFakeCodexWithExec(tools, argvLog);
  ws = join(realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-ws-'))), 'proj'); mkdirSync(ws);
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

const termText = (page: import('@playwright/test').Page, agent: string) => page.locator(`[data-testid="terminal-${agent}"] .xterm-rows`);

/** Simula o Bash do orquestrador chamando o script do worker do Codex. */
function runWorker(tier: string, task: string): Promise<number | null> {
  const script = join(dir, 'orchestrator', 'devfusion-codex-worker.sh');
  return new Promise((resolve) => spawn('/bin/sh', [script, tier, ws, task], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } }).on('exit', (c) => resolve(c)));
}
let hookSeq = 0;
/** Evento no formato real dos hooks oficiais do Claude Code (o comando do hook tem teste unitário). */
function hook(payload: object): void {
  writeFileSync(join(dir, 'orchestrator', 'events', `c-${Math.floor(Date.now() / 1000)}-${90000 + hookSeq++}.json`), JSON.stringify(payload));
}

test('Dev Orchestrator: três colunas, líder com modelo/roster oficiais, workers à esquerda e à direita, Parar tudo encerra tudo', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();

  await page.getByTestId('mode-orchestrator').click();
  await expect(page.getByTestId('workers-claude')).toBeVisible();
  await expect(page.getByTestId('workers-codex')).toBeVisible();
  await expect(page.getByTestId('orchestrator-model')).toHaveText('Opus 5.5 · esforço alto');

  await page.getByTestId('orchestrator-start').click();
  await expect(termText(page, 'claude')).toContainText('claude falso');
  await expect(page.getByTestId('mode-direct')).toBeDisabled(); // não troca de modo com sessão aberta
  const argv = JSON.parse(readFileSync(argvLog, 'utf8')) as string[];
  expect(argv.slice(0, 5)).toEqual(['--model', 'claude-opus-5-5', '--effort', 'high', '--agents']);
  expect(JSON.parse(argv[5]!)['claude-trivial']).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
  expect(argv[argv.indexOf('--append-system-prompt') + 1]).toMatch(/^# DevFusion — Dev Orchestrator/);
  expect(Object.keys((JSON.parse(argv[argv.indexOf('--settings') + 1]!) as { hooks: object }).hooks)).toContain('SubagentStart');

  // Subagente do roster disparado pelo orquestrador (eventos dos hooks oficiais).
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { description: 'Rodar testes', prompt: 'npm test', subagent_type: 'claude-trivial' } });
  hook({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'claude-trivial' });
  const claudeCard = page.getByTestId('worker-claude-a1');
  await expect(claudeCard.getByTestId('worker-model')).toHaveText('Sonnet 5.5 · esforço baixo');
  await expect(claudeCard.getByTestId('worker-status')).toHaveText('trabalhando');
  await expect(claudeCard.getByTestId('worker-task')).toHaveText('Rodar testes: npm test');

  // Worker do Codex pelo script gerado (o mesmo comando que o orquestrador recebe nas instruções).
  expect(await runWorker('complexa', 'revisar o diff')).toBe(0);
  const codexCard = page.locator('[data-testid^="worker-codex-"]').first();
  await expect(codexCard.getByTestId('worker-status')).toHaveText('concluído');
  await expect(codexCard.getByTestId('worker-model')).toHaveText('GPT-6.2-Astra · esforço alto');
  await codexCard.locator('summary').click();
  await expect(codexCard.getByTestId('worker-output')).toHaveText('feito: revisar o diff');
  await expect(page.getByTestId('workers-count-codex')).toHaveText('0 trabalhando · 1 no total');

  // Worker longo + Parar tudo: orquestrador, subagente e worker do Codex encerrados.
  const long = runWorker('rotina', 'dormir');
  await expect(page.getByTestId('workers-count-codex')).toHaveText('1 trabalhando · 2 no total');
  await page.getByTestId('stop-all').click();
  expect(await long).not.toBe(0);
  await expect(page.getByTestId('workers-count-codex')).toHaveText('0 trabalhando · 2 no total');
  await expect(page.locator('[data-testid^="worker-codex-"]').first().getByTestId('worker-status')).toHaveText('interrompido');
  await expect(claudeCard.getByTestId('worker-status')).toHaveText('interrompido', { timeout: 15_000 });
  await expect(page.getByTestId('mode-direct')).toBeEnabled({ timeout: 15_000 });

  // De volta ao modo lado a lado: os dois terminais diretos.
  await page.getByTestId('mode-direct').click();
  await expect(page.getByTestId('agent-pane-claude')).toBeVisible();
  await expect(page.getByTestId('agent-pane-codex')).toBeVisible();
  await app.close();
});

test('Dev Orchestrator com Codex como líder: -m/-c oficiais e coluna do Claude explica a ausência de workers', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('mode-orchestrator').click();
  await page.getByTestId('orchestrator-lead').selectOption('codex');
  await expect(page.getByTestId('orchestrator-model')).toHaveText('GPT-6.2-Astra · esforço alto');
  await page.getByTestId('orchestrator-start').click();
  await expect(termText(page, 'codex')).toContainText('codex falso');
  const argv = JSON.parse(readFileSync(argvLog, 'utf8')) as string[];
  expect(argv.slice(0, 4)).toEqual(['-m', 'gpt-6.2-astra', '-c', 'model_reasoning_effort=high']);
  expect(argv[5]).toMatch(/^developer_instructions="# DevFusion — Dev Orchestrator/);
  await expect(page.getByTestId('workers-claude')).toContainText('workers do Claude ficam desligados');
  await page.getByTestId('stop-all').click();
  await expect(page.getByTestId('mode-direct')).toBeEnabled({ timeout: 15_000 });
  await app.close();
});

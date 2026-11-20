import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubConfirmDialog, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string;
const g = (...a: string[]) => execFileSync('git', ['-C', ws, ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex'));
  ws = join(realpathSync(mkdtempSync(join(tmpdir(), 'devfusion-ws-'))), 'loja'); mkdirSync(ws);
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(ws, 'app.ts'), 'export const versao = 1;\n'); mkdirSync(join(ws, 'src')); writeFileSync(join(ws, 'src', 'util.ts'), 'export {};\n');
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
  await expect(page.getByTestId('workspace-name')).toHaveText('loja');
  await page.getByRole('button', { name: 'Git' }).click();
}
const card = (page: Page, name: string) => page.getByTestId(`worktree-${name}`);

test('worktree: recusa não cria nada; criar, agente dentro, commit, integrar, desfazer e remover', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await open(page, app);

  await page.getByTestId('worktree-name').fill('feat');
  await stubConfirmDialog(app, 0);
  await page.getByTestId('worktree-create').click();
  await expect(page.getByTestId('worktree-form-msg')).toHaveText('Criação cancelada.');
  expect(g('branch', '--list', 'devfusion/*')).toBe('');

  await stubConfirmDialog(app, 1);
  await page.getByTestId('worktree-create').click();
  await expect(card(page, 'feat')).toHaveAttribute('data-status', 'active');
  await expect(page.getByTestId('worktree-feat-summary')).toContainText('base main');
  const branch = g('branch', '--list', 'devfusion/feat-*').replace('+', '').trim();
  expect(branch).toMatch(/^devfusion\/feat-[0-9a-f]{4}$/);

  // Agente iniciado dentro do worktree.
  await page.getByTestId('location-claude').selectOption({ label: 'feat' });
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-location-claude')).toHaveText('worktree feat');
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('claude falso');
  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('env');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="terminal-claude"] .xterm-rows')).toContainText('/worktrees/');
  const wtPath = execFileSync('git', ['-C', ws, 'worktree', 'list', '--porcelain']).toString().split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).find((p) => p !== ws)!;
  expect(wtPath.startsWith(realpathSync(dir))).toBe(true); // pasta do app, fora do projeto

  // "Agente" altera arquivos; commit pela UI; diff do arquivo.
  writeFileSync(join(wtPath, 'app.ts'), 'export const versao = 2;\n');
  await page.getByTestId('wt-files-feat').click();
  await expect(page.getByTestId('wt-filelist-feat')).toContainText('app.ts');
  await page.getByTestId('wt-filelist-feat').getByText('app.ts').click();
  await expect(page.getByTestId('diff-text')).toContainText('+export const versao = 2;');
  await page.keyboard.press('Escape');
  await page.getByTestId('wt-commit-msg-feat').fill('versão 2');
  await page.getByTestId('wt-commit-feat').click();
  await expect(page.getByTestId('wt-msg-feat')).toContainText('Commit');
  await expect(page.getByTestId('worktree-feat-summary')).toContainText('1 commit(s) · 0 não commitado(s)');

  // Integrar: verificação sem conflitos, confirmação nativa, merge.
  await page.getByTestId('wt-check-feat').click();
  await expect(page.getByTestId('wt-check-result-feat')).toContainText('Sem conflitos previstos');
  await stubConfirmDialog(app, 1);
  await page.getByTestId('wt-merge-feat').click();
  await expect(card(page, 'feat')).toHaveAttribute('data-status', 'merged');
  expect(readFileSync(join(ws, 'app.ts'), 'utf8')).toBe('export const versao = 2;\n');

  // Desfazer integração (revert) mantendo o histórico.
  await page.getByTestId('wt-revert-feat').click();
  await expect(card(page, 'feat')).toHaveAttribute('data-status', 'reverted');
  expect(readFileSync(join(ws, 'app.ts'), 'utf8')).toBe('export const versao = 1;\n');
  expect(g('log', '--oneline').split('\n')).toHaveLength(4);

  // Remover (com o agente parado).
  await page.getByTestId('stop-claude').click();
  await expect(page.getByTestId('agent-status-claude')).toHaveText(/encerrada/);
  await page.getByTestId('wt-remove-feat').click();
  await expect(card(page, 'feat')).toHaveCount(0);
  expect(existsSync(wtPath)).toBe(false);
  await app.close();
});

test('conflito previsto bloqueia a integração sem alterar o repositório', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await open(page, app);
  await stubConfirmDialog(app, 1);
  await page.getByTestId('worktree-name').fill('conflito');
  await page.getByTestId('worktree-create').click();
  await expect(card(page, 'conflito')).toBeVisible();
  const wtPath = execFileSync('git', ['-C', ws, 'worktree', 'list', '--porcelain']).toString().split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).find((p) => p !== ws)!;
  writeFileSync(join(wtPath, 'app.ts'), 'export const versao = "worktree";\n');
  execFileSync('git', ['-C', wtPath, 'commit', '-qam', 'wt']);
  writeFileSync(join(ws, 'app.ts'), 'export const versao = "raiz";\n'); g('commit', '-qam', 'raiz');
  const head = g('rev-parse', 'HEAD');
  await page.getByTestId('wt-check-conflito').click();
  await expect(page.getByTestId('wt-conflicts-conflito')).toContainText('app.ts');
  await expect(page.getByTestId('wt-merge-conflito')).toBeDisabled();
  expect(g('rev-parse', 'HEAD')).toBe(head);
  expect(g('status', '--porcelain')).toBe('');
  await app.close();
});

test('tarefa em worktree: exige o desenvolvedor dentro dele e a revisão usa o diff do branch', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await open(page, app);
  await page.getByTestId('start-codex').click();
  await page.getByRole('button', { name: 'Tarefas' }).click();
  await page.getByTestId('task-new').click();
  await page.getByTestId('task-title').fill('Versão três');
  await page.getByTestId('task-worktree').check();
  await stubConfirmDialog(app, 1);
  await page.getByTestId('task-create').click();
  await expect(page.getByTestId('task-worktree-info')).toContainText('versao-tres');

  // Claude na raiz → envio recusado.
  await page.getByTestId('start-claude').click();
  await page.getByTestId('task-send-dev').click();
  await expect(page.getByTestId('task-action-error')).toContainText('no worktree desta tarefa');
  await page.getByTestId('stop-claude').click();
  await expect(page.getByTestId('agent-status-claude')).toHaveText(/encerrada/);
  await page.getByTestId('location-claude').selectOption({ label: 'versao-tres' });
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-location-claude')).toHaveText('worktree versao-tres');
  await page.getByTestId('task-send-dev').click();
  await page.getByTestId('outbound-confirm').click();
  await expect(page.getByTestId('task-detail')).toHaveAttribute('data-status', 'in_progress');

  const wtPath = execFileSync('git', ['-C', ws, 'worktree', 'list', '--porcelain']).toString().split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).find((p) => p !== ws)!;
  writeFileSync(join(wtPath, 'app.ts'), 'export const versao = 3;\n');
  writeFileSync(join(ws, 'raiz-nao-entra.txt'), 'x'); // alteração na raiz não deve aparecer na revisão
  await page.getByTestId('task-request-review').click();
  await expect(page.getByTestId('outbound-text')).toHaveValue(/\+export const versao = 3;/);
  await expect(page.getByTestId('outbound-text')).not.toHaveValue(/raiz-nao-entra/);
  await app.close();
});

test('Explorer: árvore com status Git, pastas sob demanda e diff do arquivo', async () => {
  writeFileSync(join(ws, 'app.ts'), 'export const versao = 9;\n');
  writeFileSync(join(ws, 'src', 'novo.ts'), 'export const novo = true;\n');
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await open(page, app);
  await page.getByRole('button', { name: 'Explorer' }).click();
  await expect(page.getByTestId('explorer-status-app.ts')).toHaveText('M');
  await expect(page.getByTestId('explorer-status-src')).toHaveText('M');
  await page.getByTestId('explorer-item-src').click();
  await expect(page.getByTestId('explorer-status-src/novo.ts')).toHaveText('U');
  await page.getByTestId('explorer-item-src/novo.ts').click();
  await expect(page.getByTestId('diff-text')).toContainText('+export const novo = true;');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('explorer-tree')).not.toContainText('.git');
  // Monitoramento: arquivo novo aparece sem recarregar.
  writeFileSync(join(ws, 'apareceu.md'), '# oi\n');
  await expect(page.getByTestId('explorer-item-apareceu.md')).toBeVisible({ timeout: 10_000 });
  await app.close();
});

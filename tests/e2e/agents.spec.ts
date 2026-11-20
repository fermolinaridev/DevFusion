import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  ws = join(mkdtempSync(join(tmpdir(), 'devfusion-ws-')), 'meu-projeto');
  mkdirSync(ws);
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

const termText = (page: Page, agent: string) => page.locator(`[data-testid="terminal-${agent}"] .xterm-rows`);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('dois agentes em terminais independentes, Parar tudo e nenhum órfão ao sair', async () => {
  tools.add('git', SPECS.git());
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex', { ignoreSigint: true, ignoreSigterm: true }));
  const cspErrors: string[] = [];
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text()); });
  await passOnboarding(page);

  await expect(page.getByTestId('start-claude')).toBeDisabled(); // sem workspace
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await expect(page.getByTestId('workspace-name')).toHaveText('meu-projeto');
  await expect(page.getByTestId('status-git')).toHaveText('Git: não é repositório');

  await page.getByTestId('start-claude').click();
  await page.getByTestId('start-codex').click();
  await expect(termText(page, 'claude')).toContainText('claude falso');
  await expect(termText(page, 'codex')).toContainText('codex falso');
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão ativa');
  await expect(page.getByTestId('status-sessions')).toHaveText('Sessões ativas: 2');

  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('ola devfusion');
  await page.keyboard.press('Enter');
  await expect(termText(page, 'claude')).toContainText('eco: ola devfusion');
  await expect(termText(page, 'codex')).not.toContainText('ola devfusion');

  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('env');
  await page.keyboard.press('Enter');
  await expect(termText(page, 'claude')).toContainText('keys= term=xterm-256color');

  const before = await page.evaluate(async () => (await window.devfusion.agents.list()).ok ? (await window.devfusion.agents.list() as { ok: true; data: Array<{ pid: number | null }> }).data.map((a) => a.pid) : []);
  expect(before.every((p) => typeof p === 'number')).toBe(true);

  // Codex falso ignora Ctrl+C e SIGTERM: Parar tudo precisa escalar até SIGKILL.
  await page.getByTestId('stop-all').click();
  await expect(page.getByTestId('agent-status-codex')).toHaveText(/sessão encerrada/, { timeout: 15_000 });
  await expect(page.getByTestId('agent-status-claude')).toHaveText(/sessão encerrada/);
  await expect(page.getByTestId('status-sessions')).toHaveText('Sessões ativas: 0');
  for (const pid of before) expect(alive(pid!)).toBe(false);

  // Fechar o app com agente rodando também encerra o processo.
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão ativa');
  const pid = await page.evaluate(async () => { const r = await window.devfusion.agents.list(); return r.ok ? r.data.find((a) => a.agent === 'claude')!.pid : null; });
  await app.close();
  await expect.poll(() => alive(pid!), { timeout: 10_000 }).toBe(false);
  expect(cspErrors).toEqual([]);
});

test('login pelo comando oficial dentro do terminal integrado e revalidação automática', async () => {
  tools.add('codex', SPECS.interactiveAgent('codex', { loggedIn: false }));
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await expect(page.getByTestId('check-codex-auth')).toHaveAttribute('data-state', 'unauthenticated');
  await passOnboarding(page);
  await expect(page.getByTestId('agent-status-codex')).toHaveText('não autenticado');
  await page.getByTestId('login-start-codex').click();
  await expect(termText(page, 'codex')).toContainText('Login successful');
  await expect(page.getByTestId('agent-status-codex')).toHaveText('login encerrado');
  await expect.poll(async () => page.evaluate(async () => {
    const r = await window.devfusion.doctor.getReport();
    return r.ok ? r.data.results.find((x) => x.id === 'codex-auth')?.state : null;
  })).toBe('ok');
  await expect(page.getByTestId('agents-summary')).toHaveText('Agentes: 1 de 2 prontos');
  await app.close();
});

test('workspace inválido é recusado e cancelamento não muda nada', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, null);
  await page.getByTestId('workspace-choose').click();
  await expect(page.getByTestId('workspace-name')).toHaveText('nenhum selecionado');
  await stubOpenDialog(app, '/');
  await page.getByTestId('workspace-choose').click();
  await expect(page.getByTestId('workspace-error')).toContainText('raiz do disco');
  await app.close();
});

test('workspace é restaurado ao reabrir e sessão anterior não aparece como viva', async () => {
  tools.add('claude', SPECS.interactiveAgent('claude'));
  let { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('start-claude').click();
  await expect(page.getByTestId('agent-status-claude')).toHaveText('sessão ativa');
  await app.close();
  ({ app, page } = await launch(dir, { toolDir: tools.dir }));
  await expect(page.getByTestId('workspace-name')).toHaveText('meu-projeto');
  await expect(page.getByTestId('agent-status-claude')).toHaveText(/pronto|sessão não iniciada/);
  await expect(page.getByTestId('status-sessions')).toHaveText('Sessões ativas: 0');
  await app.close();
});

test('regressão: Enter logo após clicar em Iniciar vai para o terminal, não para o botão Encerrar', async () => {
  tools.add('codex', SPECS.interactiveAgent('codex'));
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('start-codex').click();
  await expect(termText(page, 'codex')).toContainText('codex falso');
  // Fluxo do usuário: responder ao prompt da CLI só com o teclado, sem clicar no terminal.
  await page.keyboard.type('confiar');
  await page.keyboard.press('Enter');
  await expect(termText(page, 'codex')).toContainText('eco: confiar');
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('agent-status-codex')).toHaveText('sessão ativa');
  await app.close();
});

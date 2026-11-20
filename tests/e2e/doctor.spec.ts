import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubConfirmDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string;
let tools: FakeToolDir;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-')); tools = new FakeToolDir(); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); });

const state = (page: import('@playwright/test').Page, id: string) => page.getByTestId(`check-${id}`);

test('primeira execução em ambiente limpo: onboarding, modo degradado e app continua acessível', async () => {
  let { app, page } = await launch(dir, { toolDir: tools.dir });
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await expect(state(page, 'claude')).toHaveAttribute('data-state', 'missing');
  await expect(state(page, 'codex')).toHaveAttribute('data-state', 'missing');
  await expect(state(page, 'claude-auth')).toHaveAttribute('data-state', 'unknown');
  await expect(state(page, 'net-anthropic')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('onboarding-continue')).toHaveText('Continuar em modo degradado');
  await page.getByTestId('onboarding-continue').click();
  await expect(page.getByTestId('doctor-banner')).toContainText('Modo degradado');
  await expect(page.getByTestId('agents-summary')).toHaveText('Agentes: 0 de 2 prontos');
  await app.close();

  // Reinício: sem onboarding, mas o diagnóstico roda de novo.
  ({ app, page } = await launch(dir, { toolDir: tools.dir }));
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
  await expect(page.getByTestId('status-doctor')).toContainText(/atenção|verificando/);
  await expect(page.getByTestId('doctor-banner')).toBeVisible();
  await app.close();
});

test('ambos os agentes prontos: modo completo', async () => {
  tools.add('git', SPECS.git()); tools.add('claude', SPECS.claude(true)); tools.add('codex', SPECS.codex(true));
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await expect(page.getByTestId('onboarding-continue')).toHaveText('Continuar');
  await expect(page.getByTestId('onboarding-summary')).toHaveText('Os dois agentes estão prontos.');
  await passOnboarding(page);
  await expect(page.getByTestId('agents-summary')).toHaveText('Agentes: 2 de 2 prontos');
  await expect(page.getByTestId('agent-status-claude')).toHaveText('pronto · sessão não iniciada');
  await expect(page.getByTestId('agent-status-codex')).toHaveText('pronto · sessão não iniciada');
  await app.close();
});

test('um agente deslogado: modo individual e instrução de login oficial', async () => {
  tools.add('claude', SPECS.claude(false)); tools.add('codex', SPECS.codex(true));
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await expect(state(page, 'claude-auth')).toHaveAttribute('data-state', 'unauthenticated');
  await expect(page.getByTestId('onboarding-continue')).toHaveText('Continuar com um agente (modo individual)');
  await page.getByTestId('login-claude').click();
  await expect(page.getByTestId('login-dialog')).toContainText('claude auth login');
  await app.close();
});

test('instalação assistida: recusa no diálogo nativo não executa nada; aceite instala e revalida', async () => {
  tools.add('node', SPECS.node('v22.12.0'));
  tools.add('npm', { '--version': { stdout: '10.9.0' }, 'install -g @anthropic-ai/claude-code': { stdout: 'added 1 package\n', create: { claude: SPECS.claude(false) } } });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await page.getByTestId('install-claude').click();
  await expect(page.getByTestId('method-claude-npm')).toContainText('npm install -g @anthropic-ai/claude-code');
  await expect(page.getByTestId('method-claude-script-posix')).toContainText('somente instrução');
  await expect(page.getByTestId('method-claude-script-posix').getByRole('button', { name: 'Instalar' })).toHaveCount(0);

  await stubConfirmDialog(app, 0);
  await page.getByTestId('run-claude-npm').click();
  await expect(page.getByTestId('install-status')).toHaveAttribute('data-status', 'declined');
  await expect(state(page, 'claude')).toHaveAttribute('data-state', 'missing');

  await stubConfirmDialog(app, 1);
  await page.getByTestId('run-claude-npm').click();
  await expect(page.getByTestId('install-status')).toHaveAttribute('data-status', 'succeeded');
  await expect(page.getByTestId('install-output')).toContainText('added 1 package');
  await expect(page.getByTestId('install-message')).toContainText('revalidada');
  await page.keyboard.press('Escape');
  await expect(state(page, 'claude')).toHaveAttribute('data-state', 'ok');
  await expect(state(page, 'claude-auth')).toHaveAttribute('data-state', 'unauthenticated');
  await app.close();
});

test('instalação malsucedida mostra a saída e mantém o app utilizável', async () => {
  tools.add('node', SPECS.node());
  tools.add('npm', { 'install -g @openai/codex': { stderr: 'npm ERR! code EACCES\n', exitCode: 243 } });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await stubConfirmDialog(app, 1);
  await page.getByTestId('install-codex').click();
  await page.getByTestId('run-codex-npm').click();
  await expect(page.getByTestId('install-status')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('install-output')).toContainText('EACCES');
  await expect(page.getByTestId('install-message')).toContainText('243');
  await page.keyboard.press('Escape');
  await passOnboarding(page);
  await expect(page.getByTestId('status-bar')).toBeVisible();
  await app.close();
});

test('PATH incorreto: caminho configurado nas Configurações é validado e usado', async () => {
  const elsewhere = new FakeToolDir();
  try {
    const claudePath = elsewhere.add('claude', SPECS.claude(true));
    const { app, page } = await launch(dir, { toolDir: tools.dir });
    await passOnboarding(page);
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByTestId('cli-path-claude').fill('relativo/claude');
    await page.getByTestId('cli-path-claude-save').click();
    await expect(page.getByRole('alert').first()).toContainText('Valor inválido');
    await page.getByTestId('cli-path-claude').fill(claudePath);
    await page.getByTestId('cli-path-claude-save').click();
    await page.getByRole('button', { name: 'System Doctor' }).click();
    await expect(state(page, 'claude')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('check-detail-claude')).toHaveText('Encontrado via caminho configurado.');
    await app.close();
  } finally { elsewhere.cleanup(); }
});

test('disco insuficiente aparece como problema bloqueante', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir, minFreeDiskBytes: Number.MAX_SAFE_INTEGER });
  await expect(state(page, 'disk')).toHaveAttribute('data-state', 'incompatible');
  await passOnboarding(page);
  await expect(page.getByTestId('doctor-banner')).toContainText('problema(s) no sistema');
  await app.close();
});

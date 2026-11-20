import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';
import { launch, passOnboarding, stubOpenDialog } from './launch';

test.skip(process.platform === 'win32', 'CLIs falsas dos E2E ainda não validadas no Windows');

let dir: string; let tools: FakeToolDir; let ws: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-'));
  tools = new FakeToolDir();
  tools.add('git', SPECS.git()); // só para o Doctor; o diff usa o git real abaixo
  tools.add('claude', SPECS.interactiveAgent('claude'));
  tools.add('codex', SPECS.interactiveAgent('codex'));
  ws = join(mkdtempSync(join(tmpdir(), 'devfusion-ws-')), 'loja');
  mkdirSync(ws);
  const g = (...a: string[]) => execFileSync('git', ['-C', ws, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(ws, 'login.ts'), 'export function login() { return false; }\n');
  writeFileSync(join(ws, '.env'), 'DB_PASS=velha\n');
  g('add', '.'); g('commit', '-q', '-m', 'init');
});
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); rmSync(join(ws, '..'), { recursive: true, force: true }); });

const term = (page: Page, a: string) => page.locator(`[data-testid="terminal-${a}"] .xterm-rows`);

async function setup(page: Page, app: Parameters<typeof stubOpenDialog>[0]) {
  await passOnboarding(page);
  // O Git real do sistema é usado para o diff da revisão.
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByTestId('cli-path-git').fill(execFileSync('which', ['git']).toString().trim());
  await page.getByTestId('cli-path-git-save').click();
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await expect(page.getByTestId('workspace-name')).toHaveText('loja');
  await page.getByTestId('start-claude').click();
  await page.getByTestId('start-codex').click();
  await expect(term(page, 'claude')).toContainText('claude falso');
  await expect(term(page, 'codex')).toContainText('codex falso');
}

test('chat cola no terminal sem enviar; Enter do usuário envia; histórico persiste', async () => {
  let { app, page } = await launch(dir, { toolDir: tools.dir });
  await setup(page, app);
  await page.getByTestId('chat-input').fill('planejem o login');
  await page.getByTestId('chat-target').selectOption('both');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-feedback')).toContainText('Revise e pressione Enter');
  await expect(term(page, 'claude')).toContainText('planejem o login');
  await expect(term(page, 'codex')).toContainText('planejem o login');
  await page.waitForTimeout(800);
  await expect(term(page, 'claude')).not.toContainText('eco:'); // nada foi submetido sozinho
  await page.keyboard.press('Enter'); // foco foi para o terminal do Claude
  await expect(term(page, 'claude')).toContainText('eco: planejem o login');
  await expect(term(page, 'codex')).not.toContainText('eco:');

  // Clique duplo não duplica (proteção contra repetição)
  await page.getByTestId('chat-input').fill('mesma');
  await page.getByTestId('chat-target').selectOption('codex');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-feedback')).toContainText('Colado no terminal de Codex');
  await page.getByTestId('chat-input').fill('mesma');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-feedback')).toContainText('idêntica');
  await expect(page.getByTestId('chat-message')).toHaveCount(2);
  await app.close();

  ({ app, page } = await launch(dir, { toolDir: tools.dir }));
  await expect(page.getByTestId('chat-message')).toHaveCount(2);
  await expect(page.getByTestId('chat-message').first()).toContainText('planejem o login');
  await app.close();
});

test('encaminhar a seleção de um terminal para o outro com procedência e pré-visualização', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await setup(page, app);
  await page.locator('[data-testid="terminal-claude"] .xterm').click();
  await page.keyboard.type('usar bcrypt com custo 12');
  await page.keyboard.press('Enter');
  await expect(term(page, 'claude')).toContainText('eco: usar bcrypt com custo 12');
  await expect(page.getByTestId('forward-claude')).toBeDisabled();
  const line = page.locator('[data-testid="terminal-claude"] .xterm-rows > div', { hasText: 'eco: usar bcrypt' });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height / 2, { clickCount: 3 }); // seleciona a linha
  await expect(page.getByTestId('forward-claude')).toBeEnabled();
  await page.getByTestId('forward-claude').click();
  await expect(page.getByTestId('outbound-prefix')).toContainText('Conteúdo produzido por Claude Code');
  await expect(page.getByTestId('outbound-text')).toHaveValue(/eco: usar bcrypt com custo 12/);
  await page.getByTestId('outbound-confirm').click();
  await expect(term(page, 'codex')).toContainText('Encaminhado pelo usuário via DevFusion');
  await expect(term(page, 'codex')).toContainText('usar bcrypt com custo 12');
  await page.waitForTimeout(500);
  // O Codex falso só responderia "eco: [Encaminhado…" se o texto tivesse sido submetido.
  await expect(term(page, 'codex')).not.toContainText('eco: [Encaminhado');
  await expect(page.getByTestId('chat-message').last()).toHaveAttribute('data-kind', 'forward');
  await app.close();
});

test('dev/revisor: tarefa, diff Git sem .env, decisão humana e limite de rodadas', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await setup(page, app);
  await page.getByTestId('max-rounds').fill('1');
  await page.getByRole('button', { name: 'Tarefas' }).click();
  await page.getByTestId('task-new').click();
  await page.getByTestId('task-title').fill('Login seguro');
  await page.getByTestId('task-description').fill('Validar a senha no login.');
  await page.getByTestId('task-criteria').fill('retorna true para senha correta\ntem teste');
  await page.getByTestId('task-create').click();
  await expect(page.getByTestId('task-detail')).toHaveAttribute('data-status', 'draft');

  await page.getByTestId('task-send-dev').click();
  await expect(page.getByTestId('outbound-text')).toHaveValue(/Critérios de aceitação:\n- retorna true para senha correta\n- tem teste/);
  await page.getByTestId('outbound-confirm').click();
  await expect(page.getByTestId('task-detail')).toHaveAttribute('data-status', 'in_progress');
  await expect(term(page, 'claude')).toContainText('Tarefa: Login seguro');

  // "Desenvolvedor" altera o repositório (simulado direto no disco).
  writeFileSync(join(ws, 'login.ts'), 'export function login(p: string) { return p === "ok"; }\n');
  writeFileSync(join(ws, '.env'), 'DB_PASS=nova-senha-secreta\n');

  await page.getByTestId('task-request-review').click();
  await expect(page.getByTestId('outbound-text')).toHaveValue(/\+export function login\(p: string\)/);
  await expect(page.getByTestId('outbound-text')).not.toHaveValue(/nova-senha-secreta/);
  await expect(page.getByTestId('outbound-warning').first()).toContainText('omitidos do diff: .env');
  await page.getByTestId('outbound-confirm').click();
  await expect(page.getByTestId('task-detail')).toHaveAttribute('data-status', 'in_review');
  await expect(term(page, 'codex')).toContainText('Revise a implementação');
  await expect(page.getByTestId('task-status')).toContainText('revisões 1/1');

  // Limite de 1 rodada: pedir correções fica indisponível; só decisões humanas.
  await expect(page.getByTestId('task-request-changes')).toBeDisabled();
  await expect(page.getByTestId('task-limit')).toBeVisible();
  await page.getByTestId('task-approve').click();
  await expect(page.getByTestId('task-detail')).toHaveAttribute('data-status', 'approved');
  await expect(page.getByTestId('chat-event').last()).toContainText('Você aprovou a tarefa "Login seguro"');
  // O repositório não foi alterado pelo app (sem commit/add).
  expect(execFileSync('git', ['-C', ws, 'log', '--oneline']).toString().trim().split('\n')).toHaveLength(1);
  await app.close();
});

test('presets de permissão: revisor inicia com flags oficiais de somente leitura', async () => {
  // CLI falsa que imprime os argumentos recebidos.
  tools.add('codex', { ...SPECS.interactiveAgent('codex'), '--sandbox read-only --ask-for-approval on-request': { interactive: { banner: 'codex falso SOMENTE-LEITURA' } } });
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  await stubOpenDialog(app, ws);
  await page.getByTestId('workspace-choose').click();
  await page.getByTestId('permission-codex').selectOption('read-only');
  await page.getByTestId('start-codex').click();
  await expect(term(page, 'codex')).toContainText('codex falso SOMENTE-LEITURA');
  await expect(page.getByTestId('agent-permission-codex')).toHaveText('somente leitura');
  await app.close();
});

test('sem colagem segura no programa, texto com várias linhas é recusado (não vira Enter)', async () => {
  tools.add('codex', SPECS.interactiveAgent('codex', { noBracketedPaste: true }));
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await setup(page, app);
  await page.getByTestId('chat-input').fill('linha 1\nlinha 2');
  await page.getByTestId('chat-target').selectOption('codex');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-feedback')).toContainText('não está aceitando colagem segura');
  await expect(term(page, 'codex')).not.toContainText('eco:');
  await expect(page.getByTestId('chat-message')).toHaveCount(0);
  // Uma linha só continua permitida (sem Enter).
  await page.getByTestId('chat-input').fill('uma linha');
  await page.getByTestId('chat-send').click();
  await expect(term(page, 'codex')).toContainText('uma linha');
  await page.waitForTimeout(500);
  await expect(term(page, 'codex')).not.toContainText('eco:');
  await app.close();
});

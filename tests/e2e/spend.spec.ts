import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir } from '../helpers/fakeTools';
import { launch, passOnboarding } from './launch';

// Roda também no Windows: a barra não depende das CLIs falsas.
let dir: string; let tools: FakeToolDir;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-')); tools = new FakeToolDir(); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); tools.cleanup(); });

test('nível de gasto e Eco: escolha visível, tabela de modelos acompanha e fica salva ao reabrir', async () => {
  let { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  const bar = page.getByTestId('spend-bar');
  await expect(bar).toBeVisible();
  // Embaixo da linha do Dev Orchestrator.
  const modeBox = (await page.getByTestId('mode-orchestrator').boundingBox())!;
  expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(modeBox.y + modeBox.height);
  for (const [id, label] of [['ultra-baixo', 'Ultra baixo'], ['medio', 'Médio'], ['alto', 'Alto'], ['muito-alto', 'Muito alto'], ['ultra', 'Ultra']] as const) {
    await expect(page.getByTestId(`spend-${id}`)).toHaveText(label);
  }
  await expect(page.getByTestId('spend-alto')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('spend-eco')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('spend-summary')).toContainText('Opus 5.5 (alto)');

  await page.getByTestId('spend-summary').click();
  await page.getByTestId('spend-ultra-baixo').click();
  await expect(page.getByTestId('spend-ultra-baixo')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('spend-row-trivial')).toContainText('Haiku 5.5 (baixo)');
  await expect(page.getByTestId('spend-row-trivial')).toContainText('GPT-6-Luna (baixo)');
  // Tarefa difícil continua em modelo forte no nível mais baixo.
  await expect(page.getByTestId('spend-row-critica')).toContainText('Opus 5.5 (alto)');
  await expect(page.getByTestId('spend-row-critica')).toContainText('GPT-6.2-Astra (alto)');

  // Ultra com o Eco ao lado.
  await page.getByTestId('spend-ultra').click();
  await expect(page.getByTestId('spend-row-trivial')).toContainText('Sonnet 5.5 (alto)');
  await expect(page.getByTestId('spend-summary')).toContainText('até 3 workers');
  await page.getByTestId('spend-eco').click();
  await expect(page.getByTestId('spend-eco')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('spend-row-trivial')).toContainText('Haiku 5.5 (baixo)');
  await expect(page.getByTestId('spend-row-critica')).toContainText('Opus 5.5 (máximo)');
  await expect(page.getByTestId('spend-summary')).toContainText('até 2 workers');
  if (process.platform === 'win32') await expect(page.getByTestId('spend-unsupported')).toBeVisible();
  else await expect(page.getByTestId('spend-unsupported')).toHaveCount(0);
  if (process.env['DEVFUSION_SHOT']) await page.screenshot({ path: process.env['DEVFUSION_SHOT'] });
  await app.close();

  ({ app, page } = await launch(dir, { toolDir: tools.dir }));
  await passOnboarding(page);
  await expect(page.getByTestId('spend-ultra')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('spend-eco')).toHaveAttribute('aria-pressed', 'true');
  await app.close();
});

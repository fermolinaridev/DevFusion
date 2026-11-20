import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeToolDir } from '../helpers/fakeTools';
import { launch, passOnboarding } from './launch';

let dir: string; let tools: FakeToolDir;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'devfusion-e2e-')); tools = new FakeToolDir(); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); tools.cleanup(); });

test('fuzz: cada função da API do preload com argumentos hostis não gera erro interno', async () => {
  const { app, page } = await launch(dir, { toolDir: tools.dir });
  await passOnboarding(page);
  const report = await page.evaluate(async () => {
    const junk: unknown[] = [undefined, null, 42, 'x'.repeat(200_000), '../../etc/passwd', { __proto__: { a: 1 } }, ['claude'], { kind: 'worktree', id: 'nao-uuid' }];
    const api = window.devfusion as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
    const results: Array<{ fn: string; outcome: string }> = [];
    for (const [ns, fns] of Object.entries(api)) {
      for (const [name, fn] of Object.entries(fns)) {
        if (name.startsWith('on')) continue; // inscrições de eventos
        if (['choose', 'stopAll', 'exportToFile', 'deleteAll', 'refresh', 'run'].includes(name)) continue; // abrem diálogos ou rodam ações válidas sem argumento
        for (const v of junk) {
          try {
            const r = (await fn(v, v, v, v, v, v)) as { ok?: boolean; error?: { code: string } } | undefined;
            results.push({ fn: `${ns}.${name}`, outcome: r && r.ok === false ? r.error!.code : 'ok' });
          } catch (e) {
            results.push({ fn: `${ns}.${name}`, outcome: `EXCEPTION ${(e as Error).message.slice(0, 80)}` });
          }
        }
      }
    }
    return results;
  });
  const internal = report.filter((r) => r.outcome === 'INTERNAL' || r.outcome.startsWith('EXCEPTION'));
  expect(internal).toEqual([]);
  expect(report.length).toBeGreaterThan(200);
  // App continua respondendo depois do fuzz.
  await expect(page.getByTestId('status-bar')).toBeVisible();
  expect((await page.evaluate(() => window.devfusion.app.getInfo())).ok).toBe(true);
  await app.close();
});

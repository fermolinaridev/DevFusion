import { defineConfig } from '@playwright/test';

/** Testes do app empacotado (Fase 8): `DEVFUSION_PACKAGED_EXE=<executável> npm run test:package`. */
export default defineConfig({
  testDir: './tests/package',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
});

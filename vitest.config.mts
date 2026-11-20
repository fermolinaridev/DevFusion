import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const real = process.env['DEVFUSION_REAL_TESTS'] === '1';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: {
    // Testes reais (CLIs e contas do usuário) só com DEVFUSION_REAL_TESTS=1.
    include: real ? ['tests/real/**/*.test.ts'] : ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/ipc/registerIpc.ts', 'src/main/security/electronSecurity.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});

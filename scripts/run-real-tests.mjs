// Roda os testes reais (CLIs e contas do usuário) de forma portátil (Windows, macOS, Linux).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const r = spawnSync(process.execPath, [vitest, 'run'], { stdio: 'inherit', env: { ...process.env, DEVFUSION_REAL_TESTS: '1' } });
process.exit(r.status ?? 1);

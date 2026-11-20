// node-pty 1.1.x publica o prebuild `spawn-helper` (macOS) sem bit de execução,
// causando "posix_spawnp failed". Corrige apenas a permissão do arquivo local.
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const base = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
if (process.platform !== 'win32' && existsSync(base)) {
  for (const dir of readdirSync(base)) {
    const helper = join(base, dir, 'spawn-helper');
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      console.log(`[fix-node-pty] chmod 755 ${dir}/spawn-helper`);
    }
  }
}

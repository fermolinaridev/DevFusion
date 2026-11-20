import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Resposta de uma CLI falsa para uma linha de argumentos ("--version", "auth status --json"…). */
export interface FakeResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Atraso antes de responder (simula travamento/timeout). */
  sleepMs?: number;
  /** Cria outras CLIs falsas no mesmo diretório (simula uma instalação). */
  create?: Record<string, FakeToolSpec>;
}
export type FakeToolSpec = Record<string, FakeResponse> & { '*'?: FakeResponse };

/**
 * Gera executáveis falsos (Node + lançador sh/.cmd) que respondem conforme o spec.
 * Usa o Node que roda os testes por caminho absoluto, então funciona mesmo com PATH vazio.
 */
export class FakeToolDir {
  readonly dir: string;
  constructor(prefix = 'devfusion-fake-') {
    this.dir = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(this.dir, '.specs'), { recursive: true });
  }

  add(name: string, spec: FakeToolSpec): string {
    return writeFake(this.dir, name, spec);
  }

  cleanup(): void { rmSync(this.dir, { recursive: true, force: true }); }
}

export function writeFake(dir: string, name: string, spec: FakeToolSpec): string {
  mkdirSync(join(dir, '.specs'), { recursive: true });
  writeFileSync(join(dir, '.specs', `${name}.json`), JSON.stringify(spec));
  const jsFile = join(dir, '.specs', `${name}.cjs`);
  writeFileSync(jsFile, FAKE_RUNTIME);
  if (process.platform === 'win32') {
    const launcher = join(dir, `${name}.cmd`);
    writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${jsFile}" %*\r\n`);
    return launcher;
  }
  const launcher = join(dir, name);
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${jsFile}" "$@"\n`);
  chmodSync(launcher, 0o755);
  return launcher;
}

/**
 * Runtime das CLIs falsas. Lê o spec ao lado de si (<nome>.json) e, para simular
 * instalações, cria novas ferramentas copiando o próprio arquivo.
 */
const FAKE_RUNTIME = `
const fs = require('fs'), path = require('path');
const specsDir = path.dirname(__filename);
const toolDir = path.dirname(specsDir);
const spec = JSON.parse(fs.readFileSync(__filename.replace(/\\.cjs$/, '.json'), 'utf8'));
const key = process.argv.slice(2).join(' ');
const r = spec[key] || spec['*'] || { stderr: 'unknown command: ' + key, exitCode: 2 };
function create(name, s) {
  fs.writeFileSync(path.join(specsDir, name + '.json'), JSON.stringify(s));
  const js = path.join(specsDir, name + '.cjs');
  fs.copyFileSync(__filename, js);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(toolDir, name + '.cmd'), '@echo off\\r\\n"' + process.execPath + '" "' + js + '" %*\\r\\n');
  } else {
    const l = path.join(toolDir, name);
    fs.writeFileSync(l, '#!/bin/sh\\nexec "' + process.execPath + '" "' + js + '" "$@"\\n');
    fs.chmodSync(l, 0o755);
  }
}
setTimeout(() => {
  if (r.create) for (const [n, s] of Object.entries(r.create)) create(n, s);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.exitCode || 0);
}, r.sleepMs || 0);
`;

/** Specs prontos usados nos cenários de aceitação. */
export const SPECS = {
  git: (version = '2.54.0'): FakeToolSpec => ({ '--version': { stdout: `git version ${version}\n` } }),
  claude: (loggedIn: boolean | 'garbage' = true): FakeToolSpec => ({
    '--version': { stdout: '2.1.329 (Claude Code)\n' },
    'auth status --json': loggedIn === 'garbage'
      ? { stdout: 'not json' }
      : loggedIn
        ? { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }) }
        : { stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), exitCode: 1 },
  }),
  codex: (loggedIn = true): FakeToolSpec => ({
    '--version': { stdout: 'codex-cli 0.169.0\n' },
    'login status': loggedIn ? { stdout: 'Logged in using ChatGPT\n' } : { stderr: 'Not logged in\n', exitCode: 1 },
  }),
  node: (version = 'v22.12.0'): FakeToolSpec => ({ '--version': { stdout: `${version}\n` } }),
};

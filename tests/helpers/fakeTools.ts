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
  /** Modo interativo (para PTY): eco de linhas, comandos "flood", "env", "exit". */
  interactive?: { banner?: string; ignoreSigint?: boolean; ignoreSigterm?: boolean; noBracketedPaste?: boolean; mouseTracking?: boolean };
  /** Servidor JSON-RPC por stdio (simula o App Server): resposta por método e log dos métodos recebidos. */
  jsonrpc?: { results: Record<string, unknown>; errors?: Record<string, string>; logFile?: string; silent?: boolean };
  /** Simula `ai-memory run`: registra o argv e executa o `--executable` com os argumentos nativos. */
  wrapRun?: { logFile: string };
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
const argv = process.argv.slice(2);
const key = argv.join(' ');
// O DevFusion acrescenta "--settings <json>" (statusline de uso) às sessões do Claude.
const si = argv.indexOf('--settings');
const keyNoSettings = si >= 0 ? argv.filter((_, i) => i !== si && i !== si + 1).join(' ') : key;
const r = (argv[0] === 'run' && spec['run'] && spec['run'].wrapRun ? spec['run'] : null) || spec[key] || spec[keyNoSettings] || spec['*'] || { stderr: 'unknown command: ' + key, exitCode: 2 };
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
if (r.wrapRun) {
  // ai-memory run [flags do wrapper] <agente> [args nativos]: flags do wrapper antes do agente.
  fs.writeFileSync(r.wrapRun.logFile, JSON.stringify(argv));
  let i = 1, exe = null;
  while (i < argv.length && argv[i].startsWith('--')) { if (argv[i] === '--executable') { exe = argv[i + 1]; i += 2; } else i += 1; }
  const native = argv.slice(i + 1);
  const child = require('child_process').spawn(exe, native, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code, sig) => process.exit(sig ? 1 : (code ?? 0)));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { try { child.kill(s); } catch {} });
} else if (r.jsonrpc) {
  const rpc = r.jsonrpc;
  let jb = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    jb += d;
    let i;
    while ((i = jb.indexOf('\\n')) >= 0) {
      const line = jb.slice(0, i); jb = jb.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (rpc.logFile) fs.appendFileSync(rpc.logFile, m.method + '\\n');
      if (m.id === undefined || rpc.silent) continue;
      if (rpc.errors && rpc.errors[m.method]) process.stdout.write(JSON.stringify({ id: m.id, error: { code: -1, message: rpc.errors[m.method] } }) + '\\n');
      else process.stdout.write(JSON.stringify({ id: m.id, result: rpc.results[m.method] !== undefined ? rpc.results[m.method] : {} }) + '\\n');
    }
  });
  process.stdin.on('end', () => process.exit(0));
} else if (r.interactive) {
  const it = r.interactive;
  // O banner/prompt só é impresso depois que a leitura está configurada (sem corrida com quem digita).
  const banner = () => process.stdout.write((it.banner || 'fake pronto') + '\\r\\n> ');
  process.on('SIGINT', () => { process.stdout.write('[SIGINT]\\r\\n> '); if (!it.ignoreSigint) process.exit(130); });
  process.on('SIGTERM', () => { if (!it.ignoreSigterm) process.exit(143); });
  let buf = '';
  process.stdin.setEncoding('utf8');
  const handle = (line) => {
    if (line === 'exit') process.exit(0);
      else if (line === 'fail') process.exit(3);
      else if (line === 'flood') { let out = ''; for (let n = 0; n < 20000; n++) out += 'linha ' + n + ' ' + 'x'.repeat(60) + '\\r\\n'; process.stdout.write(out); }
      else if (line === 'args') process.stdout.write('ARGS=' + JSON.stringify(process.argv.slice(2)) + '\\r\\n');
      else if (line === 'env') process.stdout.write('cwd=' + process.cwd() + ' keys=' + Object.keys(process.env).filter((k) => /KEY|TOKEN|ANTHROPIC|OPENAI|CLAUDE_CODE/.test(k)).join(',') + ' term=' + process.env.TERM + '\\r\\n');
      else process.stdout.write('eco: ' + line + '\\r\\n');
      process.stdout.write('> ');
  };
  if (!it.noBracketedPaste && process.stdin.isTTY) {
    // Como as CLIs reais: modo raw, colagem delimitada (ESC[?2004h) e Enter só pelo teclado.
    process.stdin.setRawMode(true);
    process.stdout.write('\\x1b[?2004h' + (it.mouseTracking ? '\\x1b[?1000h\\x1b[?1002h\\x1b[?1006h' : ''));
    let pasting = false;
    process.stdin.on('data', (d) => {
      let s = d;
      while (s.length) {
        if (s.startsWith('\\x1b[200~')) { pasting = true; s = s.slice(6); continue; }
        if (s.startsWith('\\x1b[201~')) { pasting = false; s = s.slice(6); continue; }
        if (s.startsWith('\\x1b[I') || s.startsWith('\\x1b[O')) { s = s.slice(3); continue; }
        const mouse = /^\\x1b\\[<\\d+;\\d+;\\d+[Mm]/.exec(s);
        if (mouse) { s = s.slice(mouse[0].length); continue; }
        const ch = s[0]; s = s.slice(1);
        if (!pasting && ch === '\\x03') { process.stdout.write('^C[SIGINT]\\r\\n> '); if (!it.ignoreSigint) process.exit(130); continue; }
        if (!pasting && ch === '\\r') { process.stdout.write('\\r\\n'); const line = buf.trim(); buf = ''; if (line) handle(line); else process.stdout.write('> '); continue; }
        const c = ch === '\\n' || ch === '\\r' ? ' ' : ch;
        buf += c; process.stdout.write(c);
      }
    });
    banner();
  } else {
    banner();
    process.stdin.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.search(/[\\r\\n]/)) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    });
  }
} else setTimeout(() => {
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
  /** CLI de agente interativa; o login "autentica" recriando a CLI com status logado. */
  interactiveAgent: (agent: 'claude' | 'codex', opts: { loggedIn?: boolean; ignoreSigint?: boolean; ignoreSigterm?: boolean; noBracketedPaste?: boolean; mouseTracking?: boolean } = {}): FakeToolSpec => {
    const base = agent === 'claude' ? SPECS.claude(opts.loggedIn ?? true) : SPECS.codex(opts.loggedIn ?? true);
    const loggedInSpec: FakeToolSpec = { ...(agent === 'claude' ? SPECS.claude(true) : SPECS.codex(true)), '': { interactive: { banner: `${agent} falso` } } };
    const loginKey = agent === 'claude' ? 'auth login' : 'login';
    return {
      ...base,
      '': { interactive: { banner: `${agent} falso`, ignoreSigint: opts.ignoreSigint, ignoreSigterm: opts.ignoreSigterm, noBracketedPaste: opts.noBracketedPaste, mouseTracking: opts.mouseTracking } },
      [loginKey]: { stdout: 'Abrindo navegador… Login successful.\n', create: { [agent]: loggedInSpec } },
    };
  },
};

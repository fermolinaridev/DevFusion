// Detecção de executáveis em PATH e locais oficiais conhecidos (sem varredura).
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { redact } from './env.mjs';

/** Locais oficiais adicionais por ferramenta, fora do PATH. */
const EXTRA_LOCATIONS = {
  // O app ChatGPT para macOS (assinado pela OpenAI) embute a CLI do Codex.
  codex: process.platform === 'darwin'
    ? [{ path: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', source: 'chatgpt-app-bundle' }]
    : [],
  claude: [],
};

function isExecutable(p) {
  try { accessSync(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
}

export function which(name, env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      if (existsSync(candidate) && isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** Executa sem shell, argumentos separados, com timeout. Diferencia timeout de ausência. */
export function run(file, args, { env, cwd, timeoutMs = 15000, input } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(file, args, { env, cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
        timedOut: Boolean(err && err.killed && err.signal === 'SIGTERM'),
        notFound: err?.code === 'ENOENT',
        stdout: redact(stdout ?? ''),
        stderr: redact(stderr ?? ''),
        ms: Date.now() - started,
      });
    });
    if (input !== undefined) { child.stdin.end(input); }
  });
}

export async function detectTool(name, env) {
  const candidates = [];
  const onPath = which(name, env);
  if (onPath) candidates.push({ path: onPath, source: 'PATH' });
  for (const loc of EXTRA_LOCATIONS[name] ?? []) {
    if (existsSync(loc.path) && isExecutable(loc.path) && loc.path !== onPath) candidates.push(loc);
  }
  const results = [];
  for (const c of candidates) {
    const v = await run(c.path, ['--version'], { env, timeoutMs: 15000 });
    results.push({ ...c, path: redact(c.path), absPath: c.path, version: v.ok ? v.stdout.trim().split('\n')[0] : null, versionError: v.ok ? null : (v.timedOut ? 'timeout' : v.stderr.trim().slice(0, 200)) });
  }
  return { name, state: results.length ? 'found' : 'missing', candidates: results };
}

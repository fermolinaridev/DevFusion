// Ambiente e sanitização compartilhados pela POC da Fase 0.
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Variáveis herdadas pelos processos das CLIs (allowlist).
 * Motivos:
 *  - nunca repassar ANTHROPIC_API_KEY / OPENAI_API_KEY / CODEX_API_KEY: evita
 *    fallback silencioso para API paga (requisito do PROMPT.md);
 *  - nunca repassar variáveis de sessões hospedeiras (ex.: CLAUDE_CODE_*,
 *    ANTHROPIC_BASE_URL) que fariam a CLI usar outra autenticação que não a
 *    oficial do próprio usuário;
 *  - não vazar segredos de um provedor para o outro.
 */
const ENV_ALLOWLIST = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR',
  // Windows
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'ComSpec',
  'PATHEXT', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'ProgramFiles', 'ProgramData',
];

/** Diretórios de instalação oficiais conhecidos (sem varredura de disco). */
export function knownBinDirs() {
  const h = homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(h, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? join(h, 'AppData', 'Roaming');
    return [join(h, '.local', 'bin'), join(roaming, 'npm'), join(local, 'Microsoft', 'WinGet', 'Links')];
  }
  return [join(h, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

export function buildCleanEnv(extraPathDirs = []) {
  const env = {};
  for (const k of ENV_ALLOWLIST) if (process.env[k] !== undefined) env[k] = process.env[k];
  const systemPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  // PATH do sistema, sem diretórios de sessões hospedeiras/temporários.
  const filtered = systemPath.filter((p) => !/claude-\d+|\/T\/|scratchpad/i.test(p));
  env.PATH = [...new Set([...extraPathDirs, ...knownBinDirs(), ...filtered])].join(delimiter);
  env.TERM = 'xterm-256color';
  env.LANG ??= 'en_US.UTF-8';
  return env;
}

const REDACTIONS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  [/\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,})\b/g, '<api-key>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt>'],
  [/\b(Bearer|token|access_token|refresh_token|id_token)(["'\s:=]+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1$2<redigido>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
];

/** Remove e-mails, chaves, tokens e IDs de conta de qualquer texto de log. */
export function redact(text) {
  let s = String(text);
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s.split(homedir()).join('~');
}

/** Remove sequências ANSI/OSC para inspeção humana de saída de PTY. */
export function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b./g, '');
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

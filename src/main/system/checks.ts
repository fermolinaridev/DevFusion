import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import type { CheckGroup, CheckId, CheckResult, CheckState, SuggestedAction } from '@shared/doctor';
import { redact } from '@shared/redact';
import type { Settings } from '@shared/settings';
import type { PlatformDetector, ToolName } from './PlatformDetector';
import type { CommandRunner, RunResult } from './ProcessRunner';
import { compareVersions, parseVersion } from './version';

export interface CheckContext {
  detector: PlatformDetector;
  run: CommandRunner;
  cliPaths: Settings['cliPaths'];
  userDataDir: string;
  workspacePath: string | null;
  /** Espaço livre mínimo — política do DevFusion, não exigência dos provedores. */
  minFreeDiskBytes: number;
  freeDiskBytes: (dir: string) => Promise<number>;
  connect: (host: string, port: number, timeoutMs: number) => Promise<ConnectResult>;
  connectivityTargets: Record<'anthropic' | 'openai', { host: string; port: number }>;
}

export type ConnectResult = { ok: true; ms: number } | { ok: false; timedOut: boolean; code: string };

type Outcome = Pick<CheckResult, 'state' | 'detail'> & Partial<Pick<CheckResult, 'version' | 'path' | 'action'>>;

interface CheckDef {
  id: CheckId;
  label: string;
  group: CheckGroup;
  requirement: CheckResult['requirement'];
  dependsOn?: CheckId;
  run(ctx: CheckContext, deps: Partial<Record<CheckId, CheckResult>>): Promise<Outcome>;
}

const TOOL_TIMEOUT_MS = 15_000;
const AUTH_TIMEOUT_MS = 20_000;
const NET_TIMEOUT_MS = 5_000;
/** Git worktree (usado na Fase 5) existe desde o Git 2.5. */
const GIT_MIN = '2.5.0';
/** Requisitos de SO documentados em code.claude.com/docs/en/setup. */
const CLAUDE_MIN_DARWIN_KERNEL = 22; // macOS 13
const CLAUDE_MIN_WINDOWS_BUILD = 17763; // Windows 10 1809

const none: SuggestedAction = { kind: 'none' };

function describeFailure(r: RunResult, what: string): Outcome {
  if (r.timedOut) return { state: 'unknown', detail: `Tempo esgotado ao executar ${what}. A ferramenta pode estar travada ou lenta; tente revalidar.`, action: { kind: 'retry' } };
  if (r.permissionDenied) return { state: 'error', detail: `O sistema negou a execução de ${what} (permissão).`, action: { kind: 'retry' } };
  const msg = (r.stderr || r.stdout || r.spawnError || '').trim().split('\n')[0]?.slice(0, 200) ?? '';
  return { state: 'error', detail: `${what} terminou com código ${r.exitCode ?? '—'}${msg ? `: ${msg}` : ''}`, action: { kind: 'retry' } };
}

async function toolCheck(ctx: CheckContext, tool: ToolName, configured: string | null, versionArgs: string[]): Promise<Outcome & { resolvedPath?: string }> {
  const { found, configuredInvalid } = ctx.detector.locate(tool, configured);
  const prefix = configuredInvalid ? 'O caminho configurado não é um executável válido. ' : '';
  if (!found) return { state: 'missing', detail: `${prefix}Não encontrado no PATH nem nos locais oficiais conhecidos.` };
  const r = await ctx.run(found.path, versionArgs, { env: ctx.detector.childEnv(), timeoutMs: TOOL_TIMEOUT_MS });
  const path = ctx.detector.shortenHome(found.path);
  if (r.notFound) return { state: 'missing', detail: `${prefix}Executável não pôde ser iniciado.`, path };
  if (r.exitCode !== 0) return { ...describeFailure(r, `${tool} ${versionArgs.join(' ')}`), path };
  const firstLine = (r.stdout || r.stderr).trim().split('\n')[0] ?? '';
  const sourceNote = found.source === 'configured' ? 'caminho configurado' : found.source === 'PATH' ? 'PATH' : 'local oficial conhecido';
  return { state: 'ok', version: firstLine.slice(0, 120) || null, path, detail: `${prefix}Encontrado via ${sourceNote}.`, resolvedPath: found.path };
}

function withAction(o: Outcome, missingAction: SuggestedAction, configurable?: 'git' | 'claude' | 'codex'): Outcome {
  if (o.action) return o;
  if (o.state === 'missing') return { ...o, action: missingAction };
  if (o.state === 'error' && configurable) return { ...o, action: { kind: 'configure-path', tool: configurable } };
  return { ...o, action: none };
}

function claudeOsRequirement(ctx: CheckContext): string | null {
  const { platform, release } = ctx.detector.info();
  if (platform === 'darwin') {
    const major = Number(release.split('.')[0]);
    if (Number.isFinite(major) && major < CLAUDE_MIN_DARWIN_KERNEL) return 'O Claude Code requer macOS 13 ou mais recente.';
  }
  if (platform === 'win32') {
    const build = Number(release.split('.')[2]);
    if (Number.isFinite(build) && build < CLAUDE_MIN_WINDOWS_BUILD) return 'O Claude Code requer Windows 10 1809 (build 17763) ou mais recente.';
  }
  return null;
}

export const CHECKS: readonly CheckDef[] = [
  {
    id: 'os', label: 'Sistema operacional', group: 'system', requirement: 'required',
    async run(ctx) {
      const { platform, arch, release } = ctx.detector.info();
      const name = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
      const supportedOs = ['win32', 'darwin', 'linux'].includes(platform);
      const supportedArch = ['x64', 'arm64'].includes(arch);
      const homologated = platform === 'darwin' ? ' Homologado nesta versão: macOS.' : ' Ainda não homologado nesta plataforma; use com cautela.';
      if (!supportedOs || !supportedArch) return { state: 'incompatible', version: `${name} ${release} ${arch}`, detail: 'Plataforma ou arquitetura não suportada (suportadas: Windows, macOS e Linux em x64/arm64).' };
      return { state: 'ok', version: `${name} ${release} ${arch}`, detail: `Plataforma suportada.${homologated}` };
    },
  },
  {
    id: 'app-data', label: 'Dados do aplicativo', group: 'system', requirement: 'required',
    async run(ctx) {
      const probe = join(ctx.userDataDir, `.devfusion-write-test-${randomBytes(4).toString('hex')}`);
      try {
        await fsp.writeFile(probe, 'ok');
        const back = await fsp.readFile(probe, 'utf8');
        await fsp.unlink(probe);
        if (back !== 'ok') return { state: 'error', detail: 'Leitura não confere com o que foi gravado.', path: ctx.detector.shortenHome(ctx.userDataDir) };
        return { state: 'ok', detail: 'Leitura e escrita funcionando.', path: ctx.detector.shortenHome(ctx.userDataDir) };
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? 'erro';
        const denied = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
        return { state: 'error', detail: denied ? 'Permissão negada para gravar no diretório de dados.' : `Falha ao gravar no diretório de dados (${code}).`, path: ctx.detector.shortenHome(ctx.userDataDir), action: { kind: 'retry' } };
      }
    },
  },
  {
    id: 'disk', label: 'Espaço em disco', group: 'system', requirement: 'required',
    async run(ctx) {
      try {
        const free = await ctx.freeDiskBytes(ctx.userDataDir);
        const fmt = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GiB` : `${Math.round(b / 1024 ** 2)} MiB`);
        if (free < ctx.minFreeDiskBytes) return { state: 'incompatible', version: `${fmt(free)} livres`, detail: `Espaço insuficiente: mínimo de ${fmt(ctx.minFreeDiskBytes)} (política do DevFusion).`, action: { kind: 'retry' } };
        return { state: 'ok', version: `${fmt(free)} livres`, detail: 'Espaço suficiente no volume de dados do app.' };
      } catch (e) {
        return { state: 'unknown', detail: `Não foi possível medir o espaço livre (${(e as NodeJS.ErrnoException).code ?? 'erro'}).`, action: { kind: 'retry' } };
      }
    },
  },
  {
    id: 'git', label: 'Git', group: 'tools', requirement: 'agent',
    async run(ctx) {
      const o = await toolCheck(ctx, 'git', ctx.cliPaths.git, ['--version']);
      if (o.state === 'ok') {
        const v = parseVersion(o.version ?? '');
        if (v && compareVersions(v, parseVersion(GIT_MIN)!) < 0) return { ...o, state: 'incompatible', detail: `Versão anterior a ${GIT_MIN}; worktrees (usados na colaboração) exigem ${GIT_MIN}+.`, action: { kind: 'install', dependency: 'git' } };
      }
      return withAction(o, { kind: 'install', dependency: 'git' }, 'git');
    },
  },
  {
    id: 'claude', label: 'Claude Code', group: 'agents', requirement: 'agent',
    async run(ctx) {
      const osIssue = claudeOsRequirement(ctx);
      const o = await toolCheck(ctx, 'claude', ctx.cliPaths.claude, ['--version']);
      if (osIssue) return { ...o, state: 'incompatible', detail: osIssue, action: { kind: 'open-docs', docId: 'claude-setup' } };
      return withAction(o, { kind: 'install', dependency: 'claude' }, 'claude');
    },
  },
  {
    id: 'codex', label: 'Codex', group: 'agents', requirement: 'agent',
    async run(ctx) {
      const o = await toolCheck(ctx, 'codex', ctx.cliPaths.codex, ['--version']);
      if (o.state === 'ok' && o.path?.includes('ChatGPT.app')) o.detail = 'CLI embutida no app ChatGPT (instalação oficial da OpenAI). Pode ser uma versão de pré-lançamento.';
      return withAction(o, { kind: 'install', dependency: 'codex' }, 'codex');
    },
  },
  {
    id: 'claude-auth', label: 'Conta Claude', group: 'accounts', requirement: 'agent', dependsOn: 'claude',
    async run(ctx, deps) {
      const tool = deps.claude;
      if (!tool || tool.state !== 'ok') return { state: 'unknown', detail: 'Claude Code indisponível; status da conta não verificado.' };
      const { found } = ctx.detector.locate('claude', ctx.cliPaths.claude);
      if (!found) return { state: 'unknown', detail: 'Claude Code indisponível.' };
      const r = await ctx.run(found.path, ['auth', 'status', '--json'], { env: ctx.detector.childEnv(), timeoutMs: AUTH_TIMEOUT_MS });
      if (r.timedOut || r.permissionDenied || r.notFound) return { ...describeFailure(r, 'claude auth status') };
      return interpretClaudeAuth(r);
    },
  },
  {
    id: 'codex-auth', label: 'Conta Codex (ChatGPT)', group: 'accounts', requirement: 'agent', dependsOn: 'codex',
    async run(ctx, deps) {
      const tool = deps.codex;
      if (!tool || tool.state !== 'ok') return { state: 'unknown', detail: 'Codex indisponível; status da conta não verificado.' };
      const { found } = ctx.detector.locate('codex', ctx.cliPaths.codex);
      if (!found) return { state: 'unknown', detail: 'Codex indisponível.' };
      const r = await ctx.run(found.path, ['login', 'status'], { env: ctx.detector.childEnv(), timeoutMs: AUTH_TIMEOUT_MS });
      if (r.timedOut || r.permissionDenied || r.notFound) return { ...describeFailure(r, 'codex login status') };
      return interpretCodexAuth(r);
    },
  },
  netCheck('net-anthropic', 'Conexão com a Anthropic', 'anthropic'),
  netCheck('net-openai', 'Conexão com a OpenAI', 'openai'),
  optionalTool('node', 'Node.js externo', () => 'node', ['--version'], 'Necessário apenas para instalar CLIs via npm.', { kind: 'install', dependency: 'node' }),
  optionalTool('npm', 'npm', () => 'npm', ['--version'], 'Necessário apenas para instalar CLIs via npm.', { kind: 'install', dependency: 'node' }),
  {
    id: 'workspace', label: 'Workspace', group: 'system', requirement: 'optional',
    async run(ctx) {
      if (!ctx.workspacePath) return { state: 'optional', detail: 'Nenhum workspace selecionado. A seleção de projeto ainda não foi implementada.' };
      try {
        await fsp.access(ctx.workspacePath, fsConstants.R_OK | fsConstants.W_OK);
        return { state: 'ok', path: ctx.detector.shortenHome(ctx.workspacePath), detail: 'Leitura e escrita permitidas.' };
      } catch {
        return { state: 'error', path: ctx.detector.shortenHome(ctx.workspacePath), detail: 'Sem permissão de leitura/escrita no workspace.' };
      }
    },
  },
  optionalTool('python', 'Python', (p) => (p === 'win32' ? 'python' : 'python3'), ['--version'], 'Necessário apenas em projetos Python.', none),
  optionalTool('docker', 'Docker', () => 'docker', ['--version'], 'Necessário apenas em projetos com contêineres.', none),
];

function optionalTool(id: CheckId, label: string, tool: (platform: NodeJS.Platform) => ToolName, args: string[], why: string, action: SuggestedAction): CheckDef {
  return {
    id, label, group: 'tools', requirement: 'optional',
    async run(ctx) {
      const o = await toolCheck(ctx, tool(ctx.detector.platform), null, args);
      if (o.state === 'missing') return { ...o, state: 'optional', detail: `Não encontrado. ${why}`, action };
      return withAction({ ...o, detail: o.state === 'ok' ? `${o.detail} ${why}` : o.detail }, action);
    },
  };
}

function netCheck(id: CheckId, label: string, provider: 'anthropic' | 'openai'): CheckDef {
  return {
    id, label, group: 'network', requirement: 'agent',
    async run(ctx) {
      const t = ctx.connectivityTargets[provider];
      const r = await ctx.connect(t.host, t.port, NET_TIMEOUT_MS);
      if (r.ok) return { state: 'ok', version: `${r.ms} ms`, detail: `Conexão segura com ${t.host} estabelecida.` };
      if (r.timedOut) return { state: 'unknown', detail: `Sem resposta de ${t.host} em ${NET_TIMEOUT_MS / 1000} s. Verifique a internet ou proxy.`, action: { kind: 'retry' } };
      return { state: 'error', detail: `Sem conexão com ${t.host} (${r.code}). Os agentes precisam de internet.`, action: { kind: 'retry' } };
    },
  };
}

/** `claude auth status --json`: só `loggedIn === true` conta como autenticado. */
export function interpretClaudeAuth(r: RunResult): Outcome {
  type AuthJson = { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
  let data: AuthJson | null;
  try { const parsed: unknown = JSON.parse(r.stdout.trim()); data = parsed && typeof parsed === 'object' ? (parsed as AuthJson) : null; } catch { data = null; }
  if (!data || typeof data.loggedIn !== 'boolean') {
    return { state: 'unknown', detail: 'Não foi possível interpretar a saída de "claude auth status". Status desconhecido não é tratado como login.', action: { kind: 'retry' } };
  }
  if (!data.loggedIn) return { state: 'unauthenticated', detail: 'Não autenticado ou sessão expirada. Faça login pelo fluxo oficial da CLI.', action: { kind: 'login', agent: 'claude' } };
  const method = typeof data.authMethod === 'string' ? data.authMethod : 'desconhecido';
  const plan = typeof data.subscriptionType === 'string' ? ` · plano ${data.subscriptionType}` : '';
  if (method === 'claude.ai') return { state: 'ok', version: `claude.ai${plan}`, detail: 'Autenticado com a assinatura (login oficial).', action: none };
  return { state: 'ok', version: method, detail: `Autenticado por "${method}". Esse método pode ser cobrado pela API; o DevFusion não usa API keys.`, action: none };
}

/** `codex login status`: interpreta apenas mensagens reconhecidas; o resto é desconhecido. */
export function interpretCodexAuth(r: RunResult): Outcome {
  const text = redact(`${r.stdout}\n${r.stderr}`).trim();
  if (r.exitCode === 0 && /logged in using chatgpt/i.test(text)) return { state: 'ok', version: 'ChatGPT', detail: 'Autenticado com a conta ChatGPT (login oficial).', action: none };
  if (r.exitCode === 0 && /logged in using (an )?api key/i.test(text)) return { state: 'ok', version: 'API key', detail: 'Autenticado por API key: uso cobrado pela API, não pelo plano ChatGPT. O DevFusion não usa API keys.', action: none };
  if (/not logged in/i.test(text)) return { state: 'unauthenticated', detail: 'Não autenticado. Faça login pelo fluxo oficial da CLI.', action: { kind: 'login', agent: 'codex' } };
  return { state: 'unknown', detail: `Resposta não reconhecida de "codex login status" (código ${r.exitCode ?? '—'}). Status desconhecido não é tratado como login.`, action: { kind: 'retry' } };
}

/** Conexão TLS simples (handshake), sem enviar requisições a endpoints. */
export function tlsProbe(host: string, port: number, timeoutMs: number): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const socket = tlsConnect({ host, port, servername: host, timeout: timeoutMs }, () => {
      finish({ ok: true, ms: Date.now() - started });
    });
    socket.on('timeout', () => finish({ ok: false, timedOut: true, code: 'TIMEOUT' }));
    socket.on('error', (e: NodeJS.ErrnoException) => finish({ ok: false, timedOut: false, code: e.code ?? 'ERRO' }));
    function finish(r: ConnectResult) { if (done) return; done = true; socket.destroy(); resolve(r); }
  });
}

export function defaultConnectivityTargets(env: NodeJS.ProcessEnv): CheckContext['connectivityTargets'] {
  const targets: CheckContext['connectivityTargets'] = {
    anthropic: { host: 'api.anthropic.com', port: 443 },
    openai: { host: 'chatgpt.com', port: 443 },
  };
  // Formato: "anthropic=host:porta,openai=host:porta" (usado por testes para simular rede).
  for (const part of (env['DEVFUSION_CONNECTIVITY_TARGETS'] ?? '').split(',').filter(Boolean)) {
    const m = /^(anthropic|openai)=([^:]+):(\d{1,5})$/.exec(part.trim());
    if (m) targets[m[1] as 'anthropic' | 'openai'] = { host: m[2]!, port: Number(m[3]) };
  }
  return targets;
}

export function checkState(results: CheckResult[], id: CheckId): CheckState | undefined {
  return results.find((r) => r.id === id)?.state;
}

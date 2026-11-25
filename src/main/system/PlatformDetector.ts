import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir, arch, release } from 'node:os';
import { delimiter as hostDelimiter, win32, posix } from 'node:path';

export type ToolName = 'git' | 'claude' | 'codex' | 'node' | 'npm' | 'python' | 'python3' | 'docker' | 'brew' | 'winget' | 'ai-memory';

export interface PlatformDetectorOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface ToolLocation {
  path: string;
  source: 'configured' | 'PATH' | 'known-location';
}

/**
 * Variáveis repassadas aos processos das ferramentas (allowlist, validada na Fase 0):
 * nenhuma API key, token ou variável de sessões hospedeiras chega às CLIs.
 */
const ENV_ALLOWLIST = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'ComSpec', 'COMSPEC',
  'PATHEXT', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'WINDIR',
  // Linux: abrir o navegador no login (xdg-open) e o chaveiro do sistema (Secret Service via D-Bus).
  'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  // ai-memory (integração opcional): diretórios XDG onde ficam config/dados e servidor alternativo.
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'AI_MEMORY_SERVER_URL',
  // Única exceção a "nenhum token": o MCP do ai-memory no Codex lê este nome (`bearer_token_env_var`).
  // Só é repassado se o próprio usuário o exportou; o DevFusion não lê o arquivo do token nem registra o valor.
  'AI_MEMORY_AUTH_TOKEN',
];

export class PlatformDetector {
  readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  private registryPath: string[] = [];

  constructor(opts: PlatformDetectorOptions = {}) {
    this.platform = opts.platform ?? process.platform;
    this.env = opts.env ?? process.env;
    this.home = opts.home ?? homedir();
  }

  get delimiter(): string { return this.platform === 'win32' ? ';' : this.platform === process.platform ? hostDelimiter : ':'; }
  private join(...parts: string[]): string { return this.platform === 'win32' ? win32.join(...parts) : posix.join(...parts); }

  info() {
    return { platform: this.platform, arch: arch(), release: release() };
  }

  /** Diretórios de instalação oficiais conhecidos — lista fixa, sem varredura de disco. */
  knownToolDirs(): string[] {
    if (this.platform === 'win32') {
      const profile = this.env['USERPROFILE'] ?? this.home;
      const appData = this.env['APPDATA'] ?? this.join(profile, 'AppData', 'Roaming');
      const localAppData = this.env['LOCALAPPDATA'] ?? this.join(profile, 'AppData', 'Local');
      const programFiles = this.env['ProgramFiles'] ?? 'C:\\Program Files';
      return [
        this.join(profile, '.local', 'bin'), // instalador nativo do Claude Code
        this.join(appData, 'npm'), // pacotes globais do npm
        this.join(localAppData, 'Microsoft', 'WinGet', 'Links'), // atalhos do WinGet
        this.join(programFiles, 'Git', 'cmd'),
        this.join(programFiles, 'nodejs'),
        this.join(localAppData, 'Programs', 'ai-memory'), // install.ps1 do ai-memory
      ];
    }
    return [this.join(this.home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  }

  /** Locais oficiais específicos de uma ferramenta, fora de diretórios de PATH. */
  extraLocations(tool: ToolName): string[] {
    if (tool === 'codex' && this.platform === 'darwin') {
      // O app ChatGPT para macOS (assinado pela OpenAI) embute a CLI do Codex — verificado na Fase 0.
      return ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'];
    }
    return [];
  }

  /**
   * PATH usado para encontrar e executar ferramentas. `DEVFUSION_TOOL_PATH` substitui
   * tudo (usado por testes para simular ambientes); caso contrário: PATH do processo,
   * PATH do registro (Windows, após instalação) e locais oficiais conhecidos.
   */
  searchDirs(): string[] {
    const override = this.env['DEVFUSION_TOOL_PATH'];
    if (override !== undefined) return override.split(this.delimiter).filter(Boolean);
    const fromEnv = (this.env['PATH'] ?? this.env['Path'] ?? '').split(this.delimiter).filter(Boolean);
    return dedupe([...fromEnv, ...this.registryPath, ...this.knownToolDirs()], this.platform === 'win32');
  }

  usesToolPathOverride(): boolean { return this.env['DEVFUSION_TOOL_PATH'] !== undefined; }

  childEnv(): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = {};
    for (const k of ENV_ALLOWLIST) if (this.env[k] !== undefined) out[k] = this.env[k];
    out['PATH'] = this.searchDirs().join(this.delimiter);
    out['LANG'] ??= 'en_US.UTF-8';
    out['NO_COLOR'] = '1';
    return out;
  }

  /** Procura o executável: caminho configurado > PATH de busca > locais oficiais extras. */
  locate(tool: ToolName, configured?: string | null): { found: ToolLocation | null; configuredInvalid: boolean } {
    if (configured) {
      if (isExecutableFile(configured, this.platform)) return { found: { path: this.nativeBehindNpmShim(tool, configured), source: 'configured' }, configuredInvalid: false };
      return { found: this.locateAuto(tool), configuredInvalid: true };
    }
    return { found: this.locateAuto(tool), configuredInvalid: false };
  }

  private locateAuto(tool: ToolName): ToolLocation | null {
    const exts = this.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    const knownDirs = new Set(this.knownToolDirs());
    for (const dir of this.searchDirs()) {
      for (const ext of exts) {
        const candidate = this.join(dir, tool + ext);
        if (isExecutableFile(candidate, this.platform)) return { path: this.nativeBehindNpmShim(tool, candidate), source: knownDirs.has(dir) && !this.inProcessPath(dir) ? 'known-location' : 'PATH' };
      }
    }
    if (this.usesToolPathOverride()) return null;
    for (const p of this.extraLocations(tool)) if (isExecutableFile(p, this.platform)) return { path: p, source: 'known-location' };
    return null;
  }

  /**
   * Windows: o npm instala `claude.cmd`/`codex.cmd`, que só rodam via cmd.exe e não recebem com
   * segurança argumentos com aspas (ex.: o JSON de `--settings`). Quando o executável oficial do mesmo
   * pacote está ao lado, usa ele direto; senão mantém o .cmd.
   */
  private nativeBehindNpmShim(tool: ToolName, path: string): string {
    if (this.platform !== 'win32' || !/\.cmd$/i.test(path)) return path;
    const modules = win32.join(win32.dirname(path), 'node_modules');
    const candidates: string[] = [];
    if (tool === 'claude') candidates.push(win32.join(modules, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
    if (tool === 'codex') {
      const cpu = arch() === 'arm64' ? 'arm64' : 'x64';
      const triple = cpu === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      for (const base of [win32.join(modules, '@openai', 'codex', 'node_modules'), modules]) candidates.push(win32.join(base, '@openai', `codex-win32-${cpu}`, 'vendor', triple, 'bin', 'codex.exe'));
    }
    return candidates.find((c) => isExecutableFile(c, this.platform)) ?? path;
  }

  /** Windows: `sh.exe` do Git for Windows (o Claude Code também usa o Git Bash). Outras plataformas: `/bin/sh`. */
  locateSh(gitConfigured?: string | null): string | null {
    if (this.platform !== 'win32') return '/bin/sh';
    const git = this.locate('git', gitConfigured).found?.path;
    const roots = [
      ...(git ? [win32.dirname(win32.dirname(git))] : []),
      win32.join(this.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git'),
      ...(this.env['LOCALAPPDATA'] ? [win32.join(this.env['LOCALAPPDATA'], 'Programs', 'Git')] : []),
    ];
    return roots.map((r) => win32.join(r, 'bin', 'sh.exe')).find((p) => isExecutableFile(p, this.platform)) ?? null;
  }

  private inProcessPath(dir: string): boolean {
    return (this.env['PATH'] ?? '').split(this.delimiter).includes(dir);
  }

  /**
   * Windows: instaladores atualizam o PATH no registro, mas o processo atual não vê.
   * Relê HKCU/HKLM para a sessão do app. Em outras plataformas não faz nada.
   */
  async refreshPathFromRegistry(): Promise<void> {
    if (this.platform !== 'win32') return;
    const read = (key: string) => new Promise<string[]>((resolve) => {
      execFile('reg', ['query', key, '/v', 'Path'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        const line = stdout.split(/\r?\n/).find((l) => /\sPath\s+REG_(EXPAND_)?SZ\s+/i.test(l));
        const value = line?.replace(/^.*REG_(EXPAND_)?SZ\s+/i, '') ?? '';
        resolve(value.split(';').map((p) => p.replace(/%([^%]+)%/g, (_, v: string) => this.env[v] ?? `%${v}%`)).filter(Boolean));
      });
    });
    const [user, machine] = await Promise.all([
      read('HKCU\\Environment'),
      read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    ]);
    this.registryPath = [...machine, ...user];
  }

  shortenHome(p: string): string {
    return p.startsWith(this.home) ? '~' + p.slice(this.home.length) : p;
  }

  homeDir(): string { return this.home; }
}

export function isExecutableFile(p: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (platform !== 'win32') accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function dedupe(dirs: string[], caseInsensitive: boolean): string[] {
  const seen = new Set<string>();
  return dirs.filter((d) => { const k = caseInsensitive ? d.toLowerCase() : d; if (seen.has(k)) return false; seen.add(k); return true; });
}


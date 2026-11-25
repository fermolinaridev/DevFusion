import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { arch, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformDetector } from '../../src/main/system/PlatformDetector';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

describe.skipIf(process.platform === 'win32')('PlatformDetector', () => {
  let a: FakeToolDir; let b: FakeToolDir;
  afterEach(() => { a?.cleanup(); b?.cleanup(); });

  it('DEVFUSION_TOOL_PATH substitui PATH e locais conhecidos', () => {
    a = new FakeToolDir();
    a.add('git', SPECS.git());
    const d = new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: a.dir, PATH: '/usr/bin:/bin' } });
    expect(d.searchDirs()).toEqual([a.dir]);
    expect(d.locate('git').found).toEqual({ path: `${a.dir}/git`, source: 'PATH' });
    expect(d.locate('claude').found).toBeNull();
  });

  it('caminho configurado tem prioridade; caminho inválido cai na detecção automática e é sinalizado', () => {
    a = new FakeToolDir(); b = new FakeToolDir();
    a.add('claude', SPECS.claude());
    const configured = b.add('claude', SPECS.claude());
    const d = new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: a.dir } });
    expect(d.locate('claude', configured)).toEqual({ found: { path: configured, source: 'configured' }, configuredInvalid: false });
    expect(d.locate('claude', '/nao/existe/claude')).toEqual({ found: { path: `${a.dir}/claude`, source: 'PATH' }, configuredInvalid: true });
  });

  it('ambiente das CLIs não leva API keys nem variáveis de sessões hospedeiras', () => {
    const d = new PlatformDetector({ env: { HOME: '/h', PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-x', OPENAI_API_KEY: 'sk-x', CODEX_API_KEY: 'x', CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'http://x' } });
    const env = d.childEnv();
    expect(Object.keys(env).filter((k) => /KEY|TOKEN|ANTHROPIC|CLAUDE|OPENAI|CODEX/.test(k))).toEqual([]);
    expect(env['HOME']).toBe('/h');
  });

  it('repassa só o token do ai-memory exportado pelo usuário (MCP do Codex), nenhum outro', () => {
    const d = new PlatformDetector({ env: { HOME: '/h', PATH: '/usr/bin', AI_MEMORY_AUTH_TOKEN: 'aim-x', GITHUB_TOKEN: 'g', OPENAI_API_KEY: 'sk', CLAUDE_CODE_OAUTH_TOKEN: 't' } });
    const env = d.childEnv();
    expect(Object.keys(env).filter((k) => /KEY|TOKEN/.test(k))).toEqual(['AI_MEMORY_AUTH_TOKEN']);
    expect(new PlatformDetector({ env: { HOME: '/h', PATH: '/usr/bin' } }).childEnv()['AI_MEMORY_AUTH_TOKEN']).toBeUndefined();
  });

  it('repassa servidor gráfico e D-Bus no Linux (login pelo navegador e chaveiro), sem segredos', () => {
    const d = new PlatformDetector({ platform: 'linux', home: '/home/u', env: {
      PATH: '/usr/bin', HOME: '/home/u', DISPLAY: ':99', XAUTHORITY: '/home/u/.Xauthority', WAYLAND_DISPLAY: 'wayland-0',
      XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', GITHUB_TOKEN: 'x',
    } });
    const env = d.childEnv();
    expect(env).toMatchObject({ DISPLAY: ':99', XAUTHORITY: '/home/u/.Xauthority', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' });
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });

  it('inclui locais oficiais conhecidos quando o app abre com PATH mínimo', () => {
    const d = new PlatformDetector({ platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, home: '/Users/u' });
    expect(d.searchDirs()).toEqual(expect.arrayContaining(['/Users/u/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']));
  });
});

describe('PlatformDetector (Windows, sem executar)', () => {
  it('lista locais oficiais do Windows a partir das variáveis do usuário', () => {
    const d = new PlatformDetector({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\u', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows' }, home: 'C:\\Users\\u' });
    expect(d.knownToolDirs()).toEqual([
      'C:\\Users\\u\\.local\\bin',
      'C:\\Users\\u\\AppData\\Roaming\\npm',
      'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\nodejs',
      'C:\\Users\\u\\AppData\\Local\\Programs\\ai-memory',
    ]);
    expect(d.childEnv()['PATH']!.split(';')[0]).toBe('C:\\Windows');
  });
});

describe.skipIf(process.platform !== 'win32')('PlatformDetector (Windows, npm e Git Bash)', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const put = (...parts: string[]) => { const p = join(dir, ...parts); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, ''); return p; };
  const cpu = arch() === 'arm64' ? 'arm64' : 'x64';
  const triple = cpu === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';

  it('claude.cmd e codex.cmd do npm resolvem para o executável oficial do pacote', () => {
    dir = mkdtempSync(join(tmpdir(), 'devfusion-npm-'));
    const cmd = put('claude.cmd'); put('codex.cmd');
    const claude = put('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    const codex = put('node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${cpu}`, 'vendor', triple, 'bin', 'codex.exe');
    const d = new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: dir } });
    expect(d.locate('claude').found?.path).toBe(claude);
    expect(d.locate('codex').found?.path).toBe(codex);
    expect(d.locate('claude', cmd).found).toEqual({ path: claude, source: 'configured' });
  });

  it('sem o executável ao lado, mantém o .cmd; outras ferramentas não mudam', () => {
    dir = mkdtempSync(join(tmpdir(), 'devfusion-npm-'));
    const cmd = put('claude.cmd'); const npm = put('npm.cmd');
    const d = new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: dir } });
    expect(d.locate('claude').found?.path).toBe(cmd);
    expect(d.locate('npm').found?.path).toBe(npm);
  });

  it('acha o sh do Git for Windows a partir do git configurado', () => {
    dir = mkdtempSync(join(tmpdir(), 'devfusion-git-'));
    const git = put('Git', 'cmd', 'git.exe'); const sh = put('Git', 'bin', 'sh.exe');
    expect(new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: dir, ProgramFiles: join(dir, 'nada') } }).locateSh(git)).toBe(sh);
    expect(new PlatformDetector({ env: { DEVFUSION_TOOL_PATH: dir, ProgramFiles: join(dir, 'nada') } }).locateSh()).toBeNull();
  });
});

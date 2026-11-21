import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Teste do app EMPACOTADO (Fase 8). Recebe o executável em DEVFUSION_PACKAGED_EXE:
 * build local (`release/…`) ou app instalado pelo NSIS no CI.
 * As Fuses desligam o `--inspect`, então o Playwright conecta só ao renderer, pela porta
 * de depuração do Chromium; o perfil fica isolado com `--user-data-dir`.
 */
const EXE = process.env['DEVFUSION_PACKAGED_EXE'] ?? '';
test.skip(!EXE, 'Defina DEVFUSION_PACKAGED_EXE com o executável empacotado');

const asarPath = () => process.platform === 'darwin'
  ? join(dirname(EXE), '..', 'Resources', 'app.asar')
  : join(dirname(EXE), 'resources', 'app.asar');
/** Binário que recebe as Fuses (no macOS, o .app). */
const fuseTarget = () => process.platform === 'darwin' ? join(dirname(EXE), '..', '..') : EXE;

let profile: string; let decoy: string; let proc: ChildProcess | null = null; let browser: Browser | null = null; let output = '';

function launch(extraEnv: Record<string, string> = {}): ChildProcess {
  const p = spawn(EXE, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], { env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout!.on('data', (d: Buffer) => { output += d.toString(); });
  p.stderr!.on('data', (d: Buffer) => { output += d.toString(); });
  return p;
}

async function connect(): Promise<Page> {
  const portFile = join(profile, 'DevToolsActivePort');
  await expect.poll(() => existsSync(portFile), { timeout: 30_000, message: `DevToolsActivePort não apareceu. Saída:\n${output}` }).toBe(true);
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(() => browser!.contexts().flatMap((c) => c.pages()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const page = browser.contexts().flatMap((c) => c.pages())[0]!;
  await page.waitForSelector('[data-testid="onboarding"], [data-testid="status-bar"]', { timeout: 30_000 });
  return page;
}

function killTree(p: ChildProcess | null): void {
  if (!p?.pid || p.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']);
  else try { p.kill('SIGKILL'); } catch { /* já encerrado */ }
}

test.beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'devfusion-pkg-'));
  decoy = mkdtempSync(join(tmpdir(), 'devfusion-pkg-decoy-'));
  output = '';
});
test.afterEach(async () => {
  await browser?.close().catch(() => undefined); browser = null;
  killTree(proc); proc = null;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  rmSync(decoy, { recursive: true, force: true });
});

test('app empacotado abre, Doctor roda com PTY nativo, renderer isolado e variáveis de teste ignoradas', async () => {
  // Variáveis de teste apontando para outro lugar: o app empacotado deve ignorá-las.
  proc = launch({ DEVFUSION_USER_DATA_DIR: decoy, DEVFUSION_SUPPRESS_EXTERNAL_OPEN: '1' });
  const page = await connect();

  // Renderer: sem Node, só a API mínima; CSP de produção.
  expect(await page.evaluate(() => [typeof (globalThis as Record<string, unknown>)['require'], typeof (globalThis as Record<string, unknown>)['process']])).toEqual(['undefined', 'undefined']);
  expect(await page.evaluate(() => typeof window.devfusion.app.getInfo)).toBe('function');
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("script-src 'self'");

  // System Doctor: PTY nativo (node-pty fora do asar) e dados do app funcionando.
  await expect.poll(async () => {
    const r = await page.evaluate(() => window.devfusion.doctor.getReport()) as { ok: boolean; data?: { running: boolean; results: Array<{ id: string; state: string; detail: string }> } | null };
    const d = r.ok ? r.data : null;
    if (!d || d.running) return 'rodando';
    return JSON.stringify(d.results.filter((x) => ['pty', 'app-data', 'os'].includes(x.id)).map((x) => [x.id, x.state]));
  }, { timeout: 60_000 }).toBe(JSON.stringify([['os', 'ok'], ['app-data', 'ok'], ['pty', 'ok']]));

  // Perfil: banco e log no --user-data-dir; nada no diretório "de teste".
  expect(existsSync(join(profile, 'devfusion.sqlite'))).toBe(true);
  expect(readdirSync(decoy)).toEqual([]);
  const log = readFileSync(join(profile, 'logs', 'main.log'), 'utf8');
  expect(log).toContain('iniciando');
  expect(log).not.toContain('Exceção não tratada');

  // Fechar a janela encerra o app.
  await page.evaluate(() => window.close()).catch(() => undefined);
  await expect.poll(() => proc!.exitCode !== null || proc!.signalCode !== null, { timeout: 20_000 }).toBe(true);
});

test('Fuses ativas no binário e ELECTRON_RUN_AS_NODE não transforma o app em Node', async () => {
  const wire = await getCurrentFuseWire(fuseTarget());
  expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.DISABLE);
  expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE);
  expect(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(FuseState.ENABLE);
  expect(wire[FuseV1Options.EnableCookieEncryption]).toBe(FuseState.ENABLE);

  // Comportamento: com a variável, o executável NÃO roda código arbitrário como Node.
  const r = spawnSync(EXE, ['-e', 'console.log("VIROU_NODE")', `--user-data-dir=${profile}`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 8_000, encoding: 'utf8' });
  expect(`${r.stdout}${r.stderr}`).not.toContain('VIROU_NODE');
});

test('pacote contém só o código compilado e dependências de produção', () => {
  const files = listAsar(asarPath());
  const top = new Set(files.map((f) => f.split('/')[1]));
  expect([...top].sort()).toEqual(['node_modules', 'out', 'package.json']);
  const modules = new Set(files.filter((f) => f.startsWith('/node_modules/')).map((f) => f.split('/')[2]));
  expect([...modules].sort()).toEqual(['node-pty', 'zod']);
  const forbidden = files.filter((f) => /\.env|\.map$|\.pdb$|\/(tests?|poc|docs|src|deps)\//.test(f) || /\.(ts|tsx|md)$/.test(f) && !f.endsWith('.d.ts') && !f.endsWith('.d.cts'));
  expect(forbidden).toEqual([]);
  // Binário nativo do node-pty presente e só da plataforma empacotada.
  const natives = files.filter((f) => f.startsWith('/node_modules/node-pty/') && f.endsWith('.node'));
  expect(natives.length).toBeGreaterThan(0);
  expect(natives.every((f) => f.includes(`${process.platform}-`) || f.includes('/build/Release/'))).toBe(true);
});

/** Lê o índice do asar (formato Pickle: tamanho do cabeçalho em 12..16, JSON a partir de 16). */
function listAsar(file: string): string[] {
  const buf = readFileSync(file);
  const len = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + len).toString('utf8')) as AsarNode;
  const out: string[] = [];
  const walk = (node: AsarNode, prefix: string) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const p = `${prefix}/${name}`;
      if (child.files) walk(child, p); else out.push(p);
    }
  };
  walk(header, '');
  return out;
}
interface AsarNode { files?: Record<string, AsarNode> }

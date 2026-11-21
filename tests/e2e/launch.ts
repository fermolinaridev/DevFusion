import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Lança pela raiz do projeto (como `electron .`): o Electron lê package.json → main e versão.
export const APP_ROOT = resolve(__dirname, '../..');
export const APP_VERSION = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version;

export interface LaunchOptions {
  /** Diretório com CLIs falsas; substitui PATH e locais conhecidos. */
  toolDir: string;
  /** Simula rede: por padrão aponta para uma porta fechada local (sem tráfego externo). */
  connectivity?: string;
  minFreeDiskBytes?: number;
  /** Lista de releases simulada (servidor local); padrão: porta fechada. */
  updateFeed?: string;
}

export async function launch(userDataDir: string, opts: LaunchOptions): Promise<{ app: ElectronApplication; page: Page }> {
  // Ambiente mínimo: sem credenciais/API keys herdadas do shell de teste.
  const env: Record<string, string> = {
    DEVFUSION_USER_DATA_DIR: userDataDir,
    DEVFUSION_TOOL_PATH: opts.toolDir,
    DEVFUSION_CONNECTIVITY_TARGETS: opts.connectivity ?? 'anthropic=127.0.0.1:9,openai=127.0.0.1:9',
    PATH: process.env['PATH'] ?? '',
    // Nada de abrir navegador/gerenciador de arquivos de verdade durante os testes.
    DEVFUSION_SUPPRESS_EXTERNAL_OPEN: '1',
    // Verificação de atualização aponta para porta fechada local (sem tráfego externo nos testes).
    DEVFUSION_UPDATE_FEED: opts.updateFeed ?? 'http://127.0.0.1:9/releases',
  };
  if (opts.minFreeDiskBytes !== undefined) env['DEVFUSION_MIN_FREE_DISK_BYTES'] = String(opts.minFreeDiskBytes);
  for (const k of ['HOME', 'USER', 'TMPDIR', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT',
    // Linux: o Electron precisa do servidor gráfico (xvfb no CI) e do barramento de sessão.
    'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    const v = process.env[k]; if (v) env[k] = v;
  }
  const app = await electron.launch({ args: [APP_ROOT], env });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="onboarding"], [data-testid="status-bar"]');
  return { app, page };
}

/** Conclui o onboarding (quando exibido) e espera o layout principal. */
export async function passOnboarding(page: Page): Promise<void> {
  const cont = page.getByTestId('onboarding-continue');
  if (await page.getByTestId('onboarding').isVisible()) {
    await cont.waitFor();
    await page.waitForFunction(() => !(document.querySelector('[data-testid="onboarding-continue"]') as HTMLButtonElement | null)?.disabled);
    await cont.click();
  }
  await page.waitForSelector('[data-testid="status-bar"]');
}

/** Substitui o diálogo nativo de confirmação no main (resposta 1 = Instalar, 0 = Cancelar). */
export async function stubConfirmDialog(app: ElectronApplication, response: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, resp) => {
    (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({ response: resp, checkboxChecked: false });
  }, response);
}

/** Substitui o seletor nativo de pasta no main para devolver `path` (ou cancelar com null). */
export async function stubOpenDialog(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: p === null, filePaths: p ? [p] : [] });
  }, path);
}

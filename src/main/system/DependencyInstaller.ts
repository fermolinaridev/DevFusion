import type { CheckId, InstallMethod, InstallState, InstallableDependency } from '@shared/doctor';
import { INSTALL_CATALOG, commandDisplay, type CatalogEntry } from './InstallCatalog';
import type { PlatformDetector } from './PlatformDetector';
import type { CommandRunner } from './ProcessRunner';
import { parseVersion } from './version';

export interface InstallerDeps {
  detector: PlatformDetector;
  run: CommandRunner;
  /**
   * Confirmação final do usuário, exibida pelo processo main (diálogo nativo).
   * Um renderer comprometido não consegue pular esta etapa.
   */
  confirm: (method: InstallMethod) => Promise<boolean>;
  revalidate: (checks: CheckId[]) => Promise<unknown>;
  audit: (action: string, target: string, metadata: Record<string, unknown>) => void;
  onState: (state: InstallState) => void;
  timeoutMs?: number;
}

const IDLE: InstallState = { methodId: null, dependency: null, status: 'idle', output: '', exitCode: null, message: null };
const MAX_OUTPUT = 200_000;
const RELATED_CHECKS: Record<InstallableDependency, CheckId[]> = {
  git: ['git'],
  claude: ['claude', 'claude-auth'],
  codex: ['codex', 'codex-auth'],
  node: ['node', 'npm'],
};

export class DependencyInstaller {
  private state: InstallState = IDLE;
  private abort: AbortController | null = null;

  constructor(private readonly deps: InstallerDeps) {}

  getState(): InstallState { return this.state; }

  /** Métodos oficiais para a plataforma atual, com disponibilidade real calculada. */
  async methods(dependency: InstallableDependency): Promise<InstallMethod[]> {
    const entries = INSTALL_CATALOG.filter((e) => e.dependency === dependency && e.platforms.includes(this.deps.detector.platform));
    return Promise.all(entries.map((e) => this.describe(e)));
  }

  private async describe(e: CatalogEntry): Promise<InstallMethod> {
    let available = true;
    let unavailableReason: string | null = null;
    if (e.command) {
      const tool = this.deps.detector.locate(e.command.tool).found;
      if (!tool) { available = false; unavailableReason = `"${e.command.tool}" não foi encontrado neste computador.`; }
      else if (e.requires) {
        const req = this.deps.detector.locate(e.requires.tool).found;
        if (!req) { available = false; unavailableReason = e.requires.reason; }
        else if (e.requires.minMajor !== undefined) {
          const r = await this.deps.run(req.path, ['--version'], { env: this.deps.detector.childEnv(), timeoutMs: 10_000 });
          const v = r.exitCode === 0 ? parseVersion(r.stdout) : null;
          if (!v || v.major < e.requires.minMajor) { available = false; unavailableReason = `${e.requires.reason} Detectado: ${v ? `${v.major}.${v.minor}.${v.patch}` : 'versão desconhecida'}.`; }
        }
      }
    }
    return {
      id: e.id, dependency: e.dependency, title: e.title, sourceUrl: e.sourceUrl,
      commandDisplay: commandDisplay(e), automatic: e.command !== null, available, unavailableReason,
      permissions: e.permissions,
      versionNote: e.command ? 'Versão mais recente publicada nesse canal oficial no momento da instalação. A versão exata aparece após a revalidação.' : 'Definida pela página oficial.',
      notes: e.notes,
    };
  }

  /** Fluxo completo: valida método → confirmação no main → execução → revalidação. */
  async install(methodId: string): Promise<InstallState> {
    if (this.state.status === 'running' || this.state.status === 'awaiting-consent') return this.set({ ...this.state, message: 'Já existe uma instalação em andamento.' });
    const entry = INSTALL_CATALOG.find((e) => e.id === methodId && e.platforms.includes(this.deps.detector.platform));
    if (!entry || !entry.command) return this.set({ ...IDLE, methodId, status: 'failed', message: 'Método inexistente ou não executável automaticamente.' });
    const method = await this.describe(entry);
    if (!method.available) return this.set({ ...IDLE, methodId, dependency: entry.dependency, status: 'failed', message: method.unavailableReason });

    this.deps.audit('install.requested', entry.dependency, { method: entry.id, command: method.commandDisplay });
    this.set({ ...IDLE, methodId, dependency: entry.dependency, status: 'awaiting-consent' });
    let consent = false;
    try { consent = await this.deps.confirm(method); } catch { consent = false; }
    if (!consent) {
      this.deps.audit('install.declined', entry.dependency, { method: entry.id });
      return this.set({ ...this.state, status: 'declined', message: 'Instalação não autorizada. Nada foi executado.' });
    }

    const tool = this.deps.detector.locate(entry.command.tool).found!;
    this.abort = new AbortController();
    this.deps.audit('install.started', entry.dependency, { method: entry.id });
    this.set({ ...this.state, status: 'running', output: `$ ${method.commandDisplay}\n` });
    const r = await this.deps.run(tool.path, entry.command.args, {
      env: this.deps.detector.childEnv(),
      timeoutMs: this.deps.timeoutMs ?? 15 * 60_000,
      signal: this.abort.signal,
      onOutput: (chunk) => this.set({ ...this.state, output: (this.state.output + chunk).slice(-MAX_OUTPUT) }),
    });
    this.abort = null;

    let status: InstallState['status'];
    let message: string;
    if (r.cancelled) { status = 'cancelled'; message = 'Instalação cancelada. O gerenciador de pacotes pode ter deixado arquivos parciais; revalide antes de tentar de novo.'; }
    else if (r.timedOut) { status = 'failed'; message = 'Tempo limite atingido; a instalação foi interrompida.'; }
    else if (r.exitCode === 0) { status = 'succeeded'; message = 'Comando concluído. Revalidando…'; }
    else { status = 'failed'; message = `O comando terminou com código ${r.exitCode ?? '—'}${r.permissionDenied ? ' (permissão negada)' : ''}. Veja a saída acima; você também pode seguir a página oficial.`; }
    this.deps.audit('install.finished', entry.dependency, { method: entry.id, status, exitCode: r.exitCode });
    this.set({ ...this.state, status, exitCode: r.exitCode, message });

    // Revalida sempre (sucesso, falha ou cancelamento) para refletir o estado real.
    await this.deps.detector.refreshPathFromRegistry();
    await this.deps.revalidate(RELATED_CHECKS[entry.dependency]);
    if (status === 'succeeded') this.set({ ...this.state, message: 'Instalação concluída e revalidada. Se a ferramenta continuar ausente, reinicie o DevFusion para atualizar o PATH.' });
    return this.state;
  }

  cancel(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  private set(s: InstallState): InstallState {
    this.state = s;
    this.deps.onState(s);
    return s;
  }
}

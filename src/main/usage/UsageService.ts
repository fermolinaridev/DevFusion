import type { ProviderUsage, UsageReport } from '@shared/usage';
import type { ClaudeStatuslineBridge } from './ClaudeStatuslineBridge';

export interface UsageServiceDeps {
  readCodex: () => Promise<ProviderUsage>;
  claude: ClaudeStatuslineBridge;
  emit: (report: UsageReport) => void;
  /** Intervalo de consulta do Codex (padrão 5 min). */
  codexIntervalMs?: number;
}

/** Junta as duas fontes oficiais de uso do plano. Não estima nem prevê nada. */
export class UsageService {
  private codex: ProviderUsage = { provider: 'codex', status: 'no-data', windows: [], plan: null, updatedAt: null, source: '', note: 'Consultando…', extras: {} };
  private claude: ProviderUsage;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly d: UsageServiceDeps) {
    this.claude = d.claude.read();
  }

  start(): void {
    void this.refreshCodex();
    this.timer = setInterval(() => void this.refreshCodex(), this.d.codexIntervalMs ?? 5 * 60_000);
    this.timer.unref();
    this.d.claude.watch(() => { this.claude = this.d.claude.read(); this.emit(); });
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.d.claude.stop(); }

  report(): UsageReport { return { claude: this.claude, codex: this.codex }; }

  async refresh(): Promise<UsageReport> {
    this.claude = this.d.claude.read();
    await this.refreshCodex();
    return this.report();
  }

  private refreshCodex(): Promise<void> {
    // Uma consulta por vez; pedidos durante uma consulta reaproveitam o resultado.
    this.inflight ??= this.d.readCodex().then((r) => {
      // Falha temporária não apaga o último valor bom: mantém números e explica o erro.
      this.codex = r.status === 'ok' || this.codex.status !== 'ok' ? r : { ...this.codex, note: `Última atualização falhou: ${r.note ?? 'erro'}. Mostrando o último valor conhecido.` };
      this.emit();
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private emit(): void { this.d.emit(this.report()); }
}

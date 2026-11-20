import type { Settings } from '@shared/settings';

export type NotificationKind = keyof Settings['notifications'];

export interface NotifierDeps {
  isSupported: () => boolean;
  show: (title: string, body: string) => void;
  /** Só notifica com a janela em segundo plano (com ela à vista, a própria UI já mostra). */
  windowFocused: () => boolean;
  settings: () => Settings['notifications'];
}

/** Notificações do sistema para fatos (nunca inferências), com deduplicação por chave. */
export class Notifier {
  private readonly sent = new Set<string>();
  constructor(private readonly d: NotifierDeps) {}

  notify(kind: NotificationKind, title: string, body: string, dedupeKey?: string): boolean {
    if (!this.d.settings()[kind] || !this.d.isSupported() || this.d.windowFocused()) return false;
    if (dedupeKey) { if (this.sent.has(dedupeKey)) return false; this.sent.add(dedupeKey); }
    this.d.show(title, body);
    return true;
  }
}

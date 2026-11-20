import type { CheckState } from '@shared/doctor';

const LABEL: Record<CheckState, { text: string; icon: string; cls: string }> = {
  ok: { text: 'OK', icon: '✓', cls: 'text-codex' },
  missing: { text: 'Ausente', icon: '✕', cls: 'text-claude' },
  incompatible: { text: 'Incompatível', icon: '!', cls: 'text-claude' },
  unauthenticated: { text: 'Não autenticado', icon: '!', cls: 'text-warn' },
  unknown: { text: 'Desconhecido', icon: '?', cls: 'text-warn' },
  optional: { text: 'Opcional', icon: '–', cls: 'text-muted' },
  error: { text: 'Erro', icon: '✕', cls: 'text-claude' },
};

/** Estado com ícone e texto (não depende só de cor). */
export function StateBadge({ state, compact = false }: { state: CheckState; compact?: boolean }) {
  const l = LABEL[state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 font-medium ${compact ? '' : 'w-32'} ${l.cls}`} data-state={state}>
      <span aria-hidden="true" className="inline-block w-3 text-center">{l.icon}</span>
      {l.text}
    </span>
  );
}

import { useAppStore, type NavView } from '../../stores/appStore';

const ITEMS: Array<{ id: NavView; label: string; glyph: string }> = [
  { id: 'explorer', label: 'Explorer', glyph: '▤' },
  { id: 'agents', label: 'System Doctor', glyph: '◎' },
  { id: 'tasks', label: 'Tarefas', glyph: '☰' },
  { id: 'git', label: 'Git', glyph: '⑂' },
  { id: 'sessions', label: 'Sessões', glyph: '◷' },
  { id: 'settings', label: 'Configurações', glyph: '⚙' },
];

export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  return (
    <nav aria-label="Navegação principal" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2">
      {ITEMS.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => setView(item.id)}
            className={`flex h-9 w-9 items-center justify-center rounded text-base ${active ? 'bg-surface-2 text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}
          >
            <span aria-hidden="true">{item.glyph}</span>
          </button>
        );
      })}
    </nav>
  );
}

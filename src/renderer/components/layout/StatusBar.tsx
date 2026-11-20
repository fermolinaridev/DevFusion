import { useAppStore } from '../../stores/appStore';

const PLATFORM_LABEL = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', other: 'Outro' } as const;

export function StatusBar() {
  const info = useAppStore((s) => s.info);
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-surface px-3 text-xs text-muted" data-testid="status-bar">
      <span>Git: —</span>
      <span>Sessões ativas: 0</span>
      <span>Diagnóstico: não executado</span>
      {info && (
        <span className="ml-auto" data-testid="status-db">
          DevFusion {info.appVersion} · {PLATFORM_LABEL[info.platform]} {info.arch} · Banco v{info.database.schemaVersion} (SQLite {info.database.sqliteVersion})
        </span>
      )}
    </footer>
  );
}

import type { Settings } from '@shared/settings';
import { useAppStore } from '../../stores/appStore';

const THEMES: Array<{ value: Settings['theme']; label: string }> = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
];

export function SettingsView() {
  const theme = useAppStore((s) => s.settings.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">Configurações</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-muted">Tema</legend>
        {THEMES.map((t) => (
          <label key={t.value} className="flex items-center gap-2">
            <input type="radio" name="theme" value={t.value} checked={theme === t.value} onChange={() => void setTheme(t.value)} data-testid={`theme-${t.value}`} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <p className="text-muted">Caminhos das CLIs, limites, permissões e retenção entram nas próximas fases.</p>
    </div>
  );
}

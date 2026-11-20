import { useState } from 'react';
import type { Settings } from '@shared/settings';
import { useAppStore } from '../../stores/appStore';
import { Button } from '../ui/Modal';

const THEMES: Array<{ value: Settings['theme']; label: string }> = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
];
const TOOLS: Array<{ key: keyof Settings['cliPaths']; label: string }> = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'git', label: 'Git' },
];

export function SettingsView() {
  const settings = useAppStore((s) => s.settings);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <div className="flex flex-col gap-5 p-4">
      <h2 className="text-sm font-semibold">Configurações</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-muted">Tema</legend>
        {THEMES.map((t) => (
          <label key={t.value} className="flex items-center gap-2">
            <input type="radio" name="theme" value={t.value} checked={settings.theme === t.value} onChange={() => void setTheme(t.value)} data-testid={`theme-${t.value}`} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-muted">Caminhos das CLIs</legend>
        <p className="text-xs text-muted">Opcional. Use quando a ferramenta não estiver no PATH. Vazio = detecção automática.</p>
        {TOOLS.map((t) => <CliPathField key={t.key} tool={t.key} label={t.label} value={settings.cliPaths[t.key]} />)}
      </fieldset>
      <MaxRoundsField />
      <p className="text-muted">Retenção do histórico e demais limites entram nas próximas fases.</p>
    </div>
  );
}

function CliPathField({ tool, label, value }: { tool: keyof Settings['cliPaths']; label: string; value: string | null }) {
  const settings = useAppStore((s) => s.settings);
  const setSetting = useAppStore((s) => s.setSetting);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async (next: string | null) => {
    const err = await setSetting('cliPaths', { ...settings.cliPaths, [tool]: next });
    setError(err);
    if (!err && next === null) setDraft('');
  };
  const id = `cli-path-${tool}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs">{label}</label>
      <div className="flex gap-2">
        <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="detecção automática" spellCheck={false}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 font-mono text-xs" data-testid={id} />
        <Button onClick={() => void save(draft.trim() === '' ? null : draft.trim())} data-testid={`${id}-save`}>Salvar</Button>
        {value && <Button variant="ghost" onClick={() => void save(null)}>Limpar</Button>}
      </div>
      {error && <p className="text-xs text-warn" role="alert">{error}</p>}
    </div>
  );
}

function MaxRoundsField() {
  const value = useAppStore((s) => s.settings.maxReviewRounds);
  const setSetting = useAppStore((s) => s.setSetting);
  const [error, setError] = useState<string | null>(null);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-muted">Revisão</legend>
      <label className="flex items-center gap-2 text-xs" htmlFor="max-rounds">Rodadas máximas de revisão por tarefa
        <input id="max-rounds" type="number" min={1} max={10} value={value} data-testid="max-rounds"
          onChange={(e) => void setSetting('maxReviewRounds', Number(e.target.value)).then(setError)}
          className="w-16 rounded border border-border bg-bg px-2 py-1" />
      </label>
      <p className="text-xs text-muted">Vale para tarefas novas. Ao atingir o limite, só restam decisões suas (aprovar, rejeitar, cancelar).</p>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
    </fieldset>
  );
}

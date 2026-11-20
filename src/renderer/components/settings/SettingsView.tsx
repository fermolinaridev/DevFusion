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
      <PersonalizationFields />
      <DiagnosticsFields />
      <p className="text-xs text-muted">Atalhos de teclado: ⌘/Ctrl+Shift+/ mostra a lista.</p>
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

function PersonalizationFields() {
  const settings = useAppStore((s) => s.settings);
  const setSetting = useAppStore((s) => s.setSetting);
  const [error, setError] = useState<string | null>(null);
  const n = settings.notifications;
  const NOTIF: Array<{ key: keyof typeof n; label: string }> = [
    { key: 'agentFailed', label: 'Processo de agente terminou com erro' },
    { key: 'installDone', label: 'Instalação concluída ou com falha' },
    { key: 'usageHigh', label: 'Janela de uso do plano em 90% ou mais' },
  ];
  return (
    <>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-muted">Aparência</legend>
        <label className="flex items-center gap-2 text-xs" htmlFor="font-size">Tamanho da fonte (terminais e editor)
          <input id="font-size" type="number" min={10} max={24} value={settings.terminalFontSize} data-testid="font-size"
            onChange={(e) => void setSetting('terminalFontSize', Number(e.target.value)).then(setError)} className="w-16 rounded border border-border bg-bg px-2 py-1" />
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-muted">Histórico</legend>
        <label className="flex items-center gap-2 text-xs" htmlFor="retention">Apagar mensagens do chat com mais de
          <input id="retention" type="number" min={0} max={3650} value={settings.historyRetentionDays} data-testid="retention"
            onChange={(e) => void setSetting('historyRetentionDays', Number(e.target.value)).then(setError)} className="w-20 rounded border border-border bg-bg px-2 py-1" /> dias
        </label>
        <p className="text-xs text-muted">0 = manter sempre. A limpeza roda ao abrir o app; a auditoria nunca é apagada.</p>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-muted">Notificações do sistema</legend>
        <p className="text-xs text-muted">Só aparecem com o DevFusion em segundo plano e só para fatos (nada é estimado).</p>
        {NOTIF.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={n[o.key]} data-testid={`notif-${o.key}`} onChange={(e) => void setSetting('notifications', { ...n, [o.key]: e.target.checked }).then(setError)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
    </>
  );
}

function DiagnosticsFields() {
  const [msg, setMsg] = useState<string | null>(null);
  const exportDiag = async () => {
    const r = await window.devfusion.diagnostics.exportToFile();
    if (!r.ok) { setMsg(r.error.message); return; }
    setMsg(r.data.ok ? (r.data.value ? `Diagnóstico salvo em ${r.data.value}` : null) : r.data.reason);
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-muted">Diagnóstico (beta)</legend>
      <p className="text-xs text-muted">Para relatar um problema: o arquivo traz versões, resultado do System Doctor, configurações e as últimas linhas do log, tudo sanitizado (sem e-mails, tokens ou chaves).</p>
      <div className="flex gap-1.5">
        <Button onClick={() => void exportDiag()} data-testid="diagnostics-export">Exportar diagnóstico…</Button>
        <Button variant="ghost" onClick={() => void window.devfusion.diagnostics.openLogsFolder()}>Abrir pasta de logs</Button>
      </div>
      {msg && <p role="status" className="text-xs text-muted" data-testid="diagnostics-msg">{msg}</p>}
    </fieldset>
  );
}

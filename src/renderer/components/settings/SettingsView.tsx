import { useState } from 'react';
import type { Settings } from '@shared/settings';
import { useAppStore } from '../../stores/appStore';
import { useUpdateStore } from '../../stores/updateStore';
import { useDoctorStore } from '../../stores/doctorStore';
import { InstallDialog } from '../system-doctor/InstallDialog';
import { Button } from '../ui/Modal';
import { CLAUDE_MODELS, CODEX_MODELS, EFFORTS, EFFORT_LABEL, ORCH_TIERS, TIER_HINT, TIER_LABEL, modelLabel, type OrchestratorSettings } from '@shared/orchestrator';

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
      <OrchestratorFields />
      <AiMemoryFields />
      <UpdateFields />
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

function OrchestratorFields() {
  const o = useAppStore((s) => s.settings.orchestrator);
  const setSetting = useAppStore((s) => s.setSetting);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: OrchestratorSettings) => setError(await setSetting('orchestrator', next));
  const sel = 'rounded border border-border bg-bg px-1 py-0.5 text-xs';
  const models = (list: readonly string[]) => list.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>);
  const efforts = EFFORTS.map((e) => <option key={e} value={e}>{EFFORT_LABEL[e]}</option>);
  return (
    <fieldset className="flex flex-col gap-2" data-testid="orchestrator-settings">
      <legend className="mb-1 text-muted">Dev Orchestrator</legend>
      <p className="text-xs text-muted">Um agente oficial (Claude Code ou Codex) faz o papel de gerente do projeto e dispara workers com o modelo e o esforço da classe de cada tarefa. O DevFusion só inicia as CLIs com flags oficiais e mostra os workers; aprovações continuam com você. Workers gastam a cota do seu plano. Vale para a próxima vez que o orquestrador iniciar.</p>
      <p className="text-xs text-muted">Os modelos abaixo valem no nível de gasto <strong>Alto</strong>. Os outros níveis (barra acima dos agentes) usam modelos prontos, e o Eco reduz qualquer um deles.</p>
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-muted">Orquestrador</span><span className="text-muted">Claude Code</span><span className="text-muted">Codex</span>
        <span>modelo · esforço</span>
        <span className="flex gap-1">
          <select className={sel} value={o.leadClaude.model} aria-label="Modelo do orquestrador Claude" data-testid="orch-lead-claude-model" onChange={(e) => void save({ ...o, leadClaude: { ...o.leadClaude, model: e.target.value as never } })}>{models(CLAUDE_MODELS)}</select>
          <select className={sel} value={o.leadClaude.effort} aria-label="Esforço do orquestrador Claude" onChange={(e) => void save({ ...o, leadClaude: { ...o.leadClaude, effort: e.target.value as never } })}>{efforts}</select>
        </span>
        <span className="flex gap-1">
          <select className={sel} value={o.leadCodex.model} aria-label="Modelo do orquestrador Codex" data-testid="orch-lead-codex-model" onChange={(e) => void save({ ...o, leadCodex: { ...o.leadCodex, model: e.target.value as never } })}>{models(CODEX_MODELS)}</select>
          <select className={sel} value={o.leadCodex.effort} aria-label="Esforço do orquestrador Codex" onChange={(e) => void save({ ...o, leadCodex: { ...o.leadCodex, effort: e.target.value as never } })}>{efforts}</select>
        </span>
        <span className="col-span-3 mt-1 text-muted">Workers por classe de tarefa</span>
        {ORCH_TIERS.map((t) => (
          <div key={t} className="contents" data-testid={`orch-tier-${t}`}>
            <span title={TIER_HINT[t]}>{TIER_LABEL[t]}</span>
            <span className="flex gap-1">
              <select className={sel} value={o.roster[t].claude.model} aria-label={`Modelo Claude (${TIER_LABEL[t]})`} onChange={(e) => void save({ ...o, roster: { ...o.roster, [t]: { ...o.roster[t], claude: { ...o.roster[t].claude, model: e.target.value } } } as never })}>{models(CLAUDE_MODELS)}</select>
              <select className={sel} value={o.roster[t].claude.effort} aria-label={`Esforço Claude (${TIER_LABEL[t]})`} onChange={(e) => void save({ ...o, roster: { ...o.roster, [t]: { ...o.roster[t], claude: { ...o.roster[t].claude, effort: e.target.value } } } as never })}>{efforts}</select>
            </span>
            <span className="flex gap-1">
              <select className={sel} value={o.roster[t].codex.model} aria-label={`Modelo Codex (${TIER_LABEL[t]})`} onChange={(e) => void save({ ...o, roster: { ...o.roster, [t]: { ...o.roster[t], codex: { ...o.roster[t].codex, model: e.target.value } } } as never })}>{models(CODEX_MODELS)}</select>
              <select className={sel} value={o.roster[t].codex.effort} aria-label={`Esforço Codex (${TIER_LABEL[t]})`} onChange={(e) => void save({ ...o, roster: { ...o.roster, [t]: { ...o.roster[t], codex: { ...o.roster[t].codex, effort: e.target.value } } } as never })}>{efforts}</select>
            </span>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        Workers do Codex ao mesmo tempo
        <input type="number" min={1} max={6} value={o.maxParallel} className="w-14 rounded border border-border bg-bg px-1 py-0.5" data-testid="orch-max-parallel"
          onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 6) void save({ ...o, maxParallel: n }); }} />
      </label>
      {error && <p className="text-xs text-warn" role="alert">{error}</p>}
    </fieldset>
  );
}

function AiMemoryFields() {
  const enabled = useAppStore((s) => s.settings.aiMemory.runAgents);
  const setSetting = useAppStore((s) => s.setSetting);
  const check = useDoctorStore((s) => s.report?.results.find((r) => r.id === 'ai-memory') ?? null);
  const runDoctor = useDoctorStore((s) => s.run);
  const openDocs = useDoctorStore((s) => s.openDocs);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installed = check !== null && check.state !== 'optional' && check.state !== 'missing';
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="ai-memory-settings">
      <legend className="mb-1 text-muted">Memória compartilhada (ai-memory)</legend>
      <p className="text-xs text-muted">Integração opcional com o <span className="font-medium">ai-memory</span> (projeto open source de terceiros): os agentes iniciam por <code>ai-memory run</code> e o Codex continua de onde o Claude parou, com a memória num servidor local. Na primeira vez, o próprio ai-memory instala hooks e MCP nas configurações do Claude Code e do Codex.</p>
      <p className="text-xs" data-testid="ai-memory-check">
        {!check ? 'Ainda não verificado pelo System Doctor.' : `${check.version ? `${check.version} — ` : ''}${check.detail}`}
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} disabled={!installed && !enabled} data-testid="ai-memory-run-agents"
          onChange={(e) => void setSetting('aiMemory', { runAgents: e.target.checked }).then(setError)} />
        Iniciar Claude Code e Codex via <code>ai-memory run</code> (vale para as próximas sessões)
      </label>
      <div className="flex gap-1.5">
        {!installed && <Button onClick={() => setInstalling(true)} data-testid="ai-memory-install">Instalar…</Button>}
        <Button variant="ghost" onClick={() => void runDoctor(['ai-memory'])} data-testid="ai-memory-recheck">Verificar de novo</Button>
        <Button variant="ghost" onClick={() => void openDocs('ai-memory')}>Documentação</Button>
      </div>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      <InstallDialog dependency={installing ? 'ai-memory' : null} onClose={() => setInstalling(false)} />
    </fieldset>
  );
}

const UPDATE_TEXT = {
  disabled: 'Verificação desligada.',
  idle: 'Ainda não verificado nesta sessão.',
  checking: 'Consultando o GitHub…',
  'up-to-date': 'Você está na versão mais recente.',
  available: '',
  error: '',
} as const;

function UpdateFields() {
  const enabled = useAppStore((s) => s.settings.updateCheck);
  const setSetting = useAppStore((s) => s.setSetting);
  const status = useUpdateStore((s) => s.status);
  const check = useUpdateStore((s) => s.check);
  const openRelease = useUpdateStore((s) => s.openRelease);
  const toggle = async (on: boolean) => { await setSetting('updateCheck', on); await check(); };
  const text = !status ? '' : status.state === 'available' && status.latest
    ? `Nova versão disponível: ${status.latest.version}${status.latest.prerelease ? ' (beta)' : ''}.`
    : status.state === 'error' ? status.error ?? 'Falha na verificação.' : UPDATE_TEXT[status.state];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-muted">Atualizações</legend>
      <p className="text-xs text-muted">O DevFusion só avisa: consulta a lista pública de releases no GitHub (sem login e sem enviar dados seus) e abre a página da versão. Nada é baixado nem instalado sozinho; confira o SHA-256 publicado antes de instalar.</p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} data-testid="update-check-enabled" onChange={(e) => void toggle(e.target.checked)} />
        Verificar novas versões (no máximo uma vez por dia)
      </label>
      <div className="flex items-center gap-1.5">
        <Button onClick={() => void check()} disabled={!enabled || status?.state === 'checking'} data-testid="update-check-now">Verificar agora</Button>
        {status?.state === 'available' && <Button variant="ghost" onClick={() => void openRelease()} data-testid="update-open-release">Abrir página da versão</Button>}
      </div>
      <p role="status" className="text-xs text-muted" data-testid="update-status">
        {text} {status && <>Versão instalada: {status.currentVersion}.</>}{status?.checkedAt && <> Última verificação: {new Date(status.checkedAt).toLocaleString()}.</>}
      </p>
    </fieldset>
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

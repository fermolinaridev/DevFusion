import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useEditorStore } from '../../stores/editorStore';
import { Button, Modal } from '../ui/Modal';

type MonacoModule = typeof import('../../lib/monaco');

/** Editor de um arquivo; o Monaco é importado só na primeira vez que esta vista aparece. */
export function EditorView({ tabKey }: { tabKey: string }) {
  const tab = useEditorStore((s) => s.tabs.find((t) => t.key === tabKey));
  const { change, save, reload } = useEditorStore();
  const theme = useAppStore((s) => s.settings.theme);
  const fontSize = useAppStore((s) => s.settings.terminalFontSize);
  const host = useRef<HTMLDivElement>(null);
  const [mod, setMod] = useState<MonacoModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const editorRef = useRef<import('monaco-editor/editor/editor.api').editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => { import('../../lib/monaco').then(setMod).catch((e: Error) => setLoadError(e.message)); }, []);

  useEffect(() => {
    if (!mod || !host.current || !tab) return;
    const { monaco, languageFor } = mod;
    const uri = monaco.Uri.parse(`devfusion:/${encodeURIComponent(tab.key)}`);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(tab.content, languageFor(tab.name), uri);
    const ed = monaco.editor.create(host.current, {
      model, automaticLayout: true, fontSize, minimap: { enabled: false }, scrollBeyondLastLine: false,
      theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs', renderWhitespace: 'selection', tabSize: 2,
    });
    editorRef.current = ed;
    const sub = model.onDidChangeContent(() => change(tab.key, model.getValue()));
    // ⌘/Ctrl+S salva.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void doSave(false); });
    ed.focus();
    return () => { sub.dispose(); ed.dispose(); editorRef.current = null; };
  }, [mod, tabKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conteúdo recarregado do disco: atualiza o modelo sem recriar o editor.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && tab && model.getValue() !== tab.content) model.setValue(tab.content);
  }, [tab?.mtimeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { mod?.monaco.editor.setTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs'); }, [theme, mod]);
  useEffect(() => { editorRef.current?.updateOptions({ fontSize }); }, [fontSize]);

  const doSave = async (overwrite: boolean) => {
    const r = await save(tabKey, overwrite);
    if (r === 'conflict') setConflict(true);
  };

  if (!tab) return null;
  const dirty = tab.content !== tab.saved;
  return (
    <div className="flex h-full flex-col" data-testid="editor-view">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 text-xs">
        <span className="font-mono">{tab.rel}</span>
        <span className="text-muted">({tab.locationLabel})</span>
        {dirty && <span className="text-warn" data-testid="editor-dirty">● não salvo</span>}
        <span className="ml-auto flex gap-1.5">
          <Button className="!px-2 !py-0.5 text-xs" disabled={!dirty} onClick={() => void reload(tabKey)} title="Descartar alterações e recarregar do disco">Recarregar</Button>
          <Button variant="primary" className="!px-2 !py-0.5 text-xs" disabled={!dirty} onClick={() => void doSave(false)} data-testid="editor-save">Salvar (⌘/Ctrl+S)</Button>
        </span>
      </div>
      {loadError && <p role="alert" className="p-3 text-warn">Não foi possível carregar o editor: {loadError}</p>}
      {!mod && !loadError && <p className="p-3 text-muted" role="status">Carregando editor…</p>}
      <div ref={host} className="min-h-0 flex-1" data-testid="monaco-host" />
      <Modal title="O arquivo mudou no disco" open={conflict} onClose={() => setConflict(false)} testId="editor-conflict"
        footer={<>
          <Button onClick={() => { setConflict(false); void reload(tabKey); }}>Recarregar do disco (descarta minhas alterações)</Button>
          <Button variant="primary" onClick={() => { setConflict(false); void doSave(true); }} data-testid="editor-overwrite">Sobrescrever com minha versão</Button>
        </>}>
        <p>Desde que você abriu <span className="font-mono">{tab.rel}</span>, o arquivo foi alterado por outro processo (por exemplo, um agente). Nada foi salvo ainda.</p>
      </Modal>
    </div>
  );
}

/** Barra de abas: "Agentes" + arquivos abertos. */
export function EditorTabs() {
  const { tabs, active, activate, close, error } = useEditorStore();
  if (tabs.length === 0 && !error) return null;
  return (
    <div className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-b border-border bg-surface text-xs" role="tablist" aria-label="Abas" data-testid="editor-tabs">
      <button type="button" role="tab" aria-selected={active === 'agents'} onClick={() => activate('agents')} className={`px-3 ${active === 'agents' ? 'bg-bg text-fg' : 'text-muted hover:text-fg'}`} data-testid="tab-agents">Agentes</button>
      {tabs.map((t) => (
        <span key={t.key} role="tab" aria-selected={active === t.key} className={`flex items-center gap-1 pl-3 pr-1 ${active === t.key ? 'bg-bg text-fg' : 'text-muted'}`}>
          <button type="button" onClick={() => activate(t.key)} title={`${t.rel} (${t.locationLabel})`} data-testid={`tab-${t.rel}`}>{t.content !== t.saved ? '● ' : ''}{t.name}</button>
          <button type="button" aria-label={`Fechar ${t.name}`} className="rounded px-1 hover:bg-surface-2"
            onClick={() => { if (t.content === t.saved || window.confirm(`Fechar ${t.name} sem salvar?`)) close(t.key); }}>✕</button>
        </span>
      ))}
      {error && <span role="alert" className="ml-auto self-center px-2 text-warn" data-testid="editor-error">{error}</span>}
    </div>
  );
}

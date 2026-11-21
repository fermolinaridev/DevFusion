import { Fragment, useCallback, useEffect, useState } from 'react';
import { SHORTCUTS, useShortcuts } from './lib/useShortcuts';
import { Modal } from './components/ui/Modal';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { AgentPane } from './components/layout/AgentPane';
import { ChatPanel } from './components/layout/ChatPanel';
import { Header } from './components/layout/Header';
import { SidePanel } from './components/layout/SidePanel';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { DoctorBanner } from './components/system-doctor/DoctorBanner';
import { EditorTabs, EditorView } from './components/editor/EditorView';
import { useEditorStore } from './stores/editorStore';
import { useApplyTheme } from './lib/useTheme';
import { Onboarding } from './pages/Onboarding';
import { useAgentStore } from './stores/agentStore';
import { useAppStore } from './stores/appStore';
import { useChatStore } from './stores/chatStore';
import { useUsageStore } from './stores/usageStore';
import { useUpdateStore } from './stores/updateStore';
import { useGitStore } from './stores/gitStore';
import { useDoctorStore } from './stores/doctorStore';

export function App() {
  const { status, error, settings, load } = useAppStore();
  const activeTab = useEditorStore((s) => s.active);
  const [help, setHelp] = useState(false);
  useShortcuts(useCallback(() => setHelp((h) => !h), []));
  useApplyTheme(settings.theme);
  const initDoctor = useDoctorStore((s) => s.init);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => initDoctor(), [initDoctor]);
  const initAgents = useAgentStore((s) => s.init);
  useEffect(() => initAgents(), [initAgents]);
  const initChat = useChatStore((s) => s.init);
  useEffect(() => initChat(), [initChat]);
  const initUsage = useUsageStore((s) => s.init);
  useEffect(() => initUsage(), [initUsage]);
  const initUpdates = useUpdateStore((s) => s.init);
  useEffect(() => initUpdates(), [initUpdates]);
  const initGit = useGitStore((s) => s.init);
  useEffect(() => initGit(), [initGit]);

  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center text-muted" role="status">Carregando…</div>;
  }
  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" role="alert">
        <p className="text-base font-medium">Não foi possível inicializar o DevFusion.</p>
        <p className="text-muted">{error}</p>
        <button className="rounded border border-border px-3 py-1.5 hover:bg-surface-2" onClick={() => void load()}>Tentar novamente</button>
      </div>
    );
  }

  if (!settings.onboardingCompleted) return <Onboarding />;

  return (
    <div className="flex h-full flex-col">
      <Header />
      <DoctorBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          <Panel id="side" defaultSize="22%" minSize="180px" maxSize="40%" className="border-r border-border bg-surface">
            <SidePanel />
          </Panel>
          <Separator className="w-px" />
          <Panel id="main" minSize="40%">
            <Group orientation="vertical">
              <Panel id="agents" defaultSize="68%" minSize="25%">
                <div className="flex h-full flex-col">
                  <EditorTabs />
                  <div className="relative min-h-0 flex-1">
                    {/* Terminais continuam montados e com tamanho real (invisíveis) enquanto o editor está à frente. */}
                    <div className={activeTab === 'agents' ? 'h-full' : 'invisible absolute inset-0'} aria-hidden={activeTab !== 'agents'}>
                      <Group orientation="horizontal">
                        <Panel id="claude" defaultSize="50%" minSize="20%"><AgentPane agent="claude" /></Panel>
                        <Separator className="w-px" />
                        <Panel id="codex" defaultSize="50%" minSize="20%"><AgentPane agent="codex" /></Panel>
                      </Group>
                    </div>
                    {activeTab !== 'agents' && <div className="absolute inset-0 bg-bg"><EditorView key={activeTab} tabKey={activeTab} /></div>}
                  </div>
                </div>
              </Panel>
              <Separator className="h-px" />
              <Panel id="chat" defaultSize="32%" minSize="120px"><ChatPanel /></Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      <StatusBar />
      <Modal title="Atalhos de teclado" open={help} onClose={() => setHelp(false)} testId="shortcuts-help">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">{SHORTCUTS.map((s) => <Fragment key={s.keys}><dt className="font-mono text-xs whitespace-nowrap">{s.keys}</dt><dd className="text-xs">{s.action}</dd></Fragment>)}</dl>
      </Modal>
      {error && (
        <div role="alert" className="fixed right-4 bottom-10 max-w-sm rounded border border-warn bg-surface px-3 py-2 text-sm shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}

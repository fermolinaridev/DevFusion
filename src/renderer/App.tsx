import { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { AgentPane } from './components/layout/AgentPane';
import { ChatPanel } from './components/layout/ChatPanel';
import { Header } from './components/layout/Header';
import { SidePanel } from './components/layout/SidePanel';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { DoctorBanner } from './components/system-doctor/DoctorBanner';
import { useApplyTheme } from './lib/useTheme';
import { Onboarding } from './pages/Onboarding';
import { useAgentStore } from './stores/agentStore';
import { useAppStore } from './stores/appStore';
import { useDoctorStore } from './stores/doctorStore';

export function App() {
  const { status, error, settings, load } = useAppStore();
  useApplyTheme(settings.theme);
  const initDoctor = useDoctorStore((s) => s.init);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => initDoctor(), [initDoctor]);
  const initAgents = useAgentStore((s) => s.init);
  useEffect(() => initAgents(), [initAgents]);

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
                <Group orientation="horizontal">
                  <Panel id="claude" defaultSize="50%" minSize="20%"><AgentPane agent="claude" /></Panel>
                  <Separator className="w-px" />
                  <Panel id="codex" defaultSize="50%" minSize="20%"><AgentPane agent="codex" /></Panel>
                </Group>
              </Panel>
              <Separator className="h-px" />
              <Panel id="chat" defaultSize="32%" minSize="120px"><ChatPanel /></Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      <StatusBar />
      {error && (
        <div role="alert" className="fixed right-4 bottom-10 max-w-sm rounded border border-warn bg-surface px-3 py-2 text-sm shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}

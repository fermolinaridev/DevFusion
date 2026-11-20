import { useAppStore } from '../../stores/appStore';
import { SettingsView } from '../settings/SettingsView';
import { DoctorPanel } from '../system-doctor/DoctorPanel';
import { TasksView } from '../tasks/TasksView';
import { UsageView } from '../usage/UsageView';
import { ExplorerView } from '../git/ExplorerView';
import { GitView } from '../git/GitView';
import { NotYetAvailable } from './NotYetAvailable';

export function SidePanel() {
  const view = useAppStore((s) => s.view);
  return (
    <div className="h-full overflow-auto" data-testid={`side-${view}`}>
      {view === 'explorer' && <ExplorerView />}
      {view === 'agents' && (
        <div className="flex flex-col gap-2 p-3">
          <h2 className="text-sm font-semibold">System Doctor</h2>
          <DoctorPanel compact />
        </div>
      )}
      {view === 'tasks' && <TasksView />}
      {view === 'usage' && <UsageView />}
      {view === 'git' && <GitView />}
      {view === 'sessions' && <NotYetAvailable title="Sessões" phase={6}>Histórico pesquisável, exportação e exclusão.</NotYetAvailable>}
      {view === 'settings' && <SettingsView />}
    </div>
  );
}

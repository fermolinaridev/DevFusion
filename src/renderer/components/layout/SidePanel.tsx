import { useAppStore } from '../../stores/appStore';
import { SettingsView } from '../settings/SettingsView';
import { NotYetAvailable } from './NotYetAvailable';

export function SidePanel() {
  const view = useAppStore((s) => s.view);
  return (
    <div className="h-full overflow-auto" data-testid={`side-${view}`}>
      {view === 'explorer' && <NotYetAvailable title="Explorer" phase={5}>Árvore de arquivos do workspace selecionado.</NotYetAvailable>}
      {view === 'agents' && (
        <NotYetAvailable title="Agentes" phase={2}>
          Detecção de Claude Code e Codex, versões e status de login pelo System Doctor. Validação manual da Fase 0 em docs/09-FASE0-POC.md.
        </NotYetAvailable>
      )}
      {view === 'tasks' && <NotYetAvailable title="Tarefas" phase={4}>Fila de tarefas, estados e aprovações.</NotYetAvailable>}
      {view === 'git' && <NotYetAvailable title="Git" phase={5}>Branches, worktrees, diffs e conflitos.</NotYetAvailable>}
      {view === 'sessions' && <NotYetAvailable title="Sessões" phase={6}>Histórico pesquisável, exportação e exclusão.</NotYetAvailable>}
      {view === 'settings' && <SettingsView />}
    </div>
  );
}

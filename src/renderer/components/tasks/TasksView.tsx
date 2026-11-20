import { useMemo, useState } from 'react';
import { AGENT_NAMES, type AgentId } from '@shared/agents';
import type { Task, TaskDecision, TaskOutbound, TaskStatus } from '@shared/orchestration';
import { useAgentStore } from '../../stores/agentStore';
import { useChatStore } from '../../stores/chatStore';
import { useGitStore } from '../../stores/gitStore';
import { terminalSelection } from '../agents/TerminalView';
import { OutboundDialog, type OutboundDraft } from '../chat/OutboundDialog';
import { Button } from '../ui/Modal';

const STATUS: Record<TaskStatus, string> = {
  draft: 'rascunho', in_progress: 'em desenvolvimento', in_review: 'em revisão', approved: 'aprovada', rejected: 'rejeitada', cancelled: 'cancelada',
};
const OUTBOUND_TITLE: Record<TaskOutbound, string> = {
  send_to_developer: 'Enviar tarefa ao desenvolvedor', request_review: 'Pedir revisão', send_corrections: 'Enviar correções ao desenvolvedor',
};

export function TasksView() {
  const tasks = useChatStore((s) => s.tasks);
  const workspace = useAgentStore((s) => s.workspace);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const task = useMemo(() => tasks.find((t) => t.id === selected) ?? null, [tasks, selected]);

  if (!workspace) return <div className="p-4 text-muted">Escolha um workspace para criar tarefas.</div>;
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="tasks-view">
      <div className="flex items-center">
        <h2 className="text-sm font-semibold">Tarefas</h2>
        <Button className="ml-auto" onClick={() => { setCreating(!creating); setSelected(null); }} data-testid="task-new">{creating ? 'Fechar' : 'Nova tarefa'}</Button>
      </div>
      <p className="text-xs text-muted">Modo desenvolvedor/revisor: um agente implementa, o outro revisa, e você decide. O app prepara os textos; você confirma cada envio.</p>
      {creating && <TaskForm onCreated={(t) => { setCreating(false); setSelected(t.id); }} />}
      {task && <TaskDetail task={task} onBack={() => setSelected(null)} />}
      {!task && !creating && (
        <ul className="flex flex-col gap-1" data-testid="task-list">
          {tasks.length === 0 && <li className="text-muted">Nenhuma tarefa neste workspace.</li>}
          {tasks.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setSelected(t.id)} className="flex w-full flex-col rounded border border-border px-2 py-1.5 text-left hover:bg-surface-2" data-testid={`task-${t.id}`}>
                <span className="font-medium">{t.title}</span>
                <span className="text-xs text-muted">{STATUS[t.status]} · {AGENT_NAMES[t.developer]} → {AGENT_NAMES[t.reviewer]} · revisões {t.rounds}/{t.maxRounds}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskForm({ onCreated }: { onCreated: (t: Task) => void }) {
  const createTask = useChatStore((s) => s.createTask);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState('');
  const [developer, setDeveloper] = useState<AgentId>('claude');
  const [worktree, setWorktree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewer: AgentId = developer === 'claude' ? 'codex' : 'claude';
  const submit = async () => {
    const r = await createTask({ title, description, criteria: criteria.split('\n').map((c) => c.trim()).filter(Boolean), developer, reviewer, worktree });
    if (!r.ok) { setError(r.reason); return; }
    if (!r.value) { setError('Criação cancelada (worktree não confirmado).'); return; }
    onCreated(r.value);
  };
  const input = 'w-full rounded border border-border bg-bg px-2 py-1';
  return (
    <form className="flex flex-col gap-2 rounded border border-border p-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="task-form">
      <label className="text-xs">Título<input className={input} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="task-title" /></label>
      <label className="text-xs">Descrição<textarea className={input} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="task-description" /></label>
      <label className="text-xs">Critérios de aceitação (um por linha)<textarea className={input} rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} data-testid="task-criteria" /></label>
      <label className="text-xs">Desenvolvedor
        <select className={input} value={developer} onChange={(e) => setDeveloper(e.target.value as AgentId)} data-testid="task-developer">
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} data-testid="task-worktree" />
        <span>Trabalhar em worktree próprio (branch isolado; modo paralelo). A revisão usa o diff desse branch.</span></label>
      <p className="text-xs text-muted">Revisor: {AGENT_NAMES[reviewer]}. Dica: inicie o revisor com permissões “somente leitura”.</p>
      {error && <p role="alert" className="text-xs text-warn" data-testid="task-error">{error}</p>}
      <Button type="submit" variant="primary" data-testid="task-create">Criar tarefa</Button>
    </form>
  );
}

function TaskDetail({ task, onBack }: { task: Task; onBack: () => void }) {
  const { previewTask, sendTask, decideTask } = useChatStore();
  const wt = useGitStore((s) => s.worktrees.find((w) => w.id === task.worktreeId));
  const [draft, setDraft] = useState<OutboundDraft | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const final = ['approved', 'rejected', 'cancelled'].includes(task.status);
  const limitReached = task.rounds >= task.maxRounds;

  const openPreview = async (action: TaskOutbound) => {
    setError(null);
    const r = await previewTask(task.id, action, action === 'send_corrections' ? notes : undefined);
    if (!r.ok) { setError(r.reason); return; }
    setDraft({
      title: OUTBOUND_TITLE[action], target: r.value.target, content: r.value.content, warnings: r.value.warnings,
      confirm: async (content) => { const s = await sendTask(task.id, action, content); if (s.ok && action === 'send_corrections') setNotes(''); return s.ok ? { ok: true } : s; },
    });
  };
  const decide = async (d: TaskDecision) => { setError(null); const r = await decideTask(task.id, d); if (!r.ok) setError(r.reason); };

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-2" data-testid="task-detail" data-status={task.status}>
      <button type="button" className="self-start text-xs text-accent hover:underline" onClick={onBack}>← Tarefas</button>
      <h3 className="font-semibold">{task.title}</h3>
      <p className="text-xs text-muted" data-testid="task-status">{STATUS[task.status]} · {AGENT_NAMES[task.developer]} desenvolve, {AGENT_NAMES[task.reviewer]} revisa · revisões {task.rounds}/{task.maxRounds}</p>
      {wt && <p className="rounded bg-surface-2 px-2 py-1 text-xs" data-testid="task-worktree-info">Worktree <strong>{wt.name}</strong> ({wt.branch}). Inicie {AGENT_NAMES[task.developer]} nele pelo seletor de local no painel do agente; integre pela aba Git depois da aprovação.</p>}
      {task.description && <p className="whitespace-pre-wrap">{task.description}</p>}
      {task.criteria.length > 0 && <ul className="list-disc pl-5 text-xs">{task.criteria.map((c) => <li key={c}>{c}</li>)}</ul>}

      {!final && (
        <div className="flex flex-wrap gap-1.5">
          {(task.status === 'draft' || task.status === 'in_progress') && <Button variant={task.status === 'draft' ? 'primary' : 'secondary'} onClick={() => void openPreview('send_to_developer')} data-testid="task-send-dev">{task.status === 'draft' ? 'Enviar ao desenvolvedor' : 'Reenviar tarefa'}</Button>}
          {task.status === 'in_progress' && <Button variant="primary" disabled={limitReached} onClick={() => void openPreview('request_review')} data-testid="task-request-review" title={limitReached ? 'Limite de rodadas atingido' : ''}>Pedir revisão</Button>}
          {task.status === 'in_review' && <>
            <Button variant="primary" onClick={() => void decide('approve')} data-testid="task-approve">Aprovar</Button>
            <Button disabled={limitReached} onClick={() => void decide('request_changes')} data-testid="task-request-changes" title={limitReached ? 'Limite de rodadas atingido' : ''}>Pedir correções</Button>
          </>}
          {(task.status === 'in_progress' || task.status === 'in_review') && <Button onClick={() => void decide('reject')} data-testid="task-reject">Rejeitar</Button>}
          <Button variant="ghost" onClick={() => void decide('cancel')} data-testid="task-cancel">Cancelar tarefa</Button>
        </div>
      )}
      {task.status === 'in_progress' && task.rounds > 0 && (
        <div className="flex flex-col gap-1 rounded border border-border p-2">
          <label className="text-xs" htmlFor="task-notes">Apontamentos do revisor para enviar ao desenvolvedor</label>
          <textarea id="task-notes" rows={4} className="w-full rounded border border-border bg-bg px-2 py-1 text-xs" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="task-notes" />
          <div className="flex gap-1.5">
            <Button onClick={() => setNotes(terminalSelection(task.reviewer))} data-testid="task-use-selection">Usar seleção do terminal de {AGENT_NAMES[task.reviewer]}</Button>
            <Button variant="primary" disabled={!notes.trim()} onClick={() => void openPreview('send_corrections')} data-testid="task-send-corrections">Enviar correções</Button>
          </div>
        </div>
      )}
      {limitReached && !final && <p className="text-xs text-warn" data-testid="task-limit">Limite de {task.maxRounds} rodada(s) de revisão atingido: só restam decisões suas.</p>}
      {error && <p role="alert" className="text-xs text-warn" data-testid="task-action-error">{error}</p>}
      <OutboundDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

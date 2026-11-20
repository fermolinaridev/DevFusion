import { useState } from 'react';
import { AGENT_NAMES, type AgentId } from '@shared/agents';
import type { GitFileStatus, MergeCheck, WorktreeInfo } from '@shared/git';
import { useAgentStore } from '../../stores/agentStore';
import { useGitStore } from '../../stores/gitStore';
import { Button } from '../ui/Modal';
import { DiffModal } from './DiffModal';

const KIND_MARK: Record<GitFileStatus['kind'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!', other: '?' };
const STATUS_LABEL: Record<WorktreeInfo['status'], string> = { active: 'ativo', merged: 'integrado', reverted: 'integração desfeita', removed: 'removido' };

export function GitView() {
  const workspace = useAgentStore((s) => s.workspace);
  const root = useGitStore((s) => s.root);
  const worktrees = useGitStore((s) => s.worktrees);
  if (!workspace) return <div className="p-4 text-muted">Escolha um workspace.</div>;
  if (root && !root.isRepo) return <div className="flex flex-col gap-2 p-4" data-testid="git-view"><h2 className="text-sm font-semibold">Git</h2><p className="text-muted">O workspace não é um repositório Git. O DevFusion não inicializa repositórios por conta própria; rode <code>git init</code> e faça o primeiro commit se quiser usar worktrees.</p></div>;
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="git-view">
      <h2 className="text-sm font-semibold">Git</h2>
      {root && (
        <section className="rounded border border-border bg-surface p-2 text-xs" data-testid="git-root">
          <div className="flex gap-2"><span className="font-medium">Raiz</span><span className="text-muted">branch {root.branch ?? '(HEAD destacado)'} · {root.headSha ?? 'sem commits'}</span></div>
          <p className={root.clean ? 'text-muted' : 'text-warn'} data-testid="git-root-clean">{root.clean ? 'Sem alterações não commitadas.' : `${root.files.length} arquivo(s) com alterações não commitadas.`}</p>
        </section>
      )}
      {root?.hasCommits ? <NewWorktree branches={root.branches} current={root.branch} /> : root && <p className="text-xs text-muted">Faça o primeiro commit para poder criar worktrees.</p>}
      <ul className="flex flex-col gap-2" data-testid="worktree-list">
        {worktrees.length === 0 && <li className="text-xs text-muted">Nenhum worktree. Use para isolar o trabalho de cada agente em um branch próprio.</li>}
        {worktrees.map((w) => <WorktreeCard key={w.id} w={w} />)}
      </ul>
    </div>
  );
}

function NewWorktree({ branches, current }: { branches: string[]; current: string | null }) {
  const create = useGitStore((s) => s.create);
  const [name, setName] = useState('');
  const [base, setBase] = useState(current ?? branches[0] ?? 'HEAD');
  const [agent, setAgent] = useState<AgentId | ''>('');
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    setMsg(null);
    const r = await create(name.trim(), base, agent || null);
    if (!r.ok) setMsg(r.reason); else if (r.value) setName(''); else setMsg('Criação cancelada.');
  };
  const input = 'rounded border border-border bg-bg px-2 py-1 text-xs';
  return (
    <form className="flex flex-col gap-1.5 rounded border border-border p-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="worktree-form">
      <span className="text-xs font-medium">Novo worktree</span>
      <div className="flex gap-1.5">
        <input className={`${input} min-w-0 flex-1`} placeholder="nome (ex.: login-2fa)" value={name} onChange={(e) => setName(e.target.value)} data-testid="worktree-name" aria-label="Nome do worktree" />
        <select className={`${input} max-w-[40%]`} value={base} onChange={(e) => setBase(e.target.value)} data-testid="worktree-base" aria-label="Branch base">
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5">
        <select className={`${input} flex-1`} value={agent} onChange={(e) => setAgent(e.target.value as AgentId | '')} aria-label="Agente responsável">
          <option value="">sem agente definido</option>
          <option value="claude">para Claude Code</option>
          <option value="codex">para Codex</option>
        </select>
        <Button type="submit" variant="primary" disabled={name.trim().length < 2} data-testid="worktree-create">Criar…</Button>
      </div>
      <p className="text-[11px] text-muted">Cria um branch a partir da base escolhida, numa pasta do app. Alterações não commitadas da raiz não vão junto.</p>
      {msg && <p role="alert" className="text-xs text-warn" data-testid="worktree-form-msg">{msg}</p>}
    </form>
  );
}

function WorktreeCard({ w }: { w: WorktreeInfo }) {
  const { files, commit, checkMerge, merge, revert, remove, openFolder } = useGitStore();
  const [list, setList] = useState<GitFileStatus[] | null>(null);
  const [check, setCheck] = useState<MergeCheck | null>(null);
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [diff, setDiff] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async <T,>(fn: () => Promise<{ ok: true; value: T } | { ok: false; reason: string }>, ok: (v: T) => string | null) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setMsg({ kind: 'error', text: r.reason }); else { const t = ok(r.value); if (t) setMsg({ kind: 'ok', text: t }); }
  };
  const showFile = async (f: GitFileStatus) => {
    const r = await window.devfusion.git.fileDiff({ kind: 'worktree', id: w.id }, f.path);
    if (r.ok && r.data.ok) setDiff({ title: `${f.path} (desde ${w.baseRef})`, text: r.data.value });
    else setMsg({ kind: 'error', text: r.ok && !r.data.ok ? r.data.reason : 'Falha ao abrir o diff.' });
  };
  const active = w.status === 'active';
  return (
    <li className="flex flex-col gap-1.5 rounded border border-border bg-surface p-2 text-xs" data-testid={`worktree-${w.name}`} data-status={w.status}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{w.name}</span>
        <span className="text-muted">{w.branch}</span>
        <span className="ml-auto rounded bg-surface-2 px-1">{STATUS_LABEL[w.status]}</span>
      </div>
      <p className="text-muted" data-testid={`worktree-${w.name}-summary`}>
        base {w.baseRef} ({w.baseSha}) · {w.ahead} commit(s) · {w.uncommitted} não commitado(s){w.behind ? ` · raiz avançou ${w.behind}` : ''}{w.agent ? ` · ${AGENT_NAMES[w.agent]}` : ''}{w.taskId ? ' · tarefa' : ''}
      </p>
      {!w.present && w.status !== 'removed' && <p className="text-warn">A pasta do worktree não existe mais.</p>}
      <p className="truncate font-mono text-[11px] text-muted" title={w.displayPath}>{w.displayPath}</p>
      <div className="flex flex-wrap gap-1">
        <Button className="!px-2 !py-0.5 text-xs" onClick={() => void act(() => files(w.id), (v) => { setList(v); return v.length ? null : 'Nenhuma alteração desde a base.'; })} data-testid={`wt-files-${w.name}`}>Alterações</Button>
        {active && w.present && <Button className="!px-2 !py-0.5 text-xs" onClick={() => void act(() => openFolder(w.id), () => null)}>Abrir pasta</Button>}
        {active && <Button className="!px-2 !py-0.5 text-xs" disabled={busy} onClick={() => void act(() => checkMerge(w.id), (v) => { setCheck(v); return null; })} data-testid={`wt-check-${w.name}`}>Verificar integração</Button>}
        {w.status === 'merged' && <Button className="!px-2 !py-0.5 text-xs" disabled={busy} onClick={() => void act(() => revert(w.id), (v) => (v ? 'Integração desfeita com git revert.' : 'Cancelado.'))} data-testid={`wt-revert-${w.name}`}>Desfazer integração…</Button>}
        <Button variant="ghost" className="!px-2 !py-0.5 text-xs" disabled={busy} onClick={() => void act(() => remove(w.id, w.status !== 'active'), (v) => (v ? null : 'Remoção cancelada.'))} data-testid={`wt-remove-${w.name}`}>Remover…</Button>
      </div>
      {list && list.length > 0 && (
        <ul className="rounded border border-border" data-testid={`wt-filelist-${w.name}`}>
          {list.map((f) => (
            <li key={f.path}><button type="button" className="flex w-full gap-2 px-2 py-0.5 text-left hover:bg-surface-2" onClick={() => void showFile(f)}>
              <span className={`w-3 font-mono ${f.kind === 'conflicted' ? 'text-warn' : 'text-muted'}`}>{KIND_MARK[f.kind]}</span><span className="truncate">{f.path}</span>
            </button></li>
          ))}
        </ul>
      )}
      {active && w.uncommitted > 0 && (
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void act(() => commit(w.id, message), (sha) => { setMessage(''); return `Commit ${sha.slice(0, 10)} criado no branch ${w.branch}.`; }); }}>
          <input className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-0.5" placeholder="mensagem do commit" value={message} onChange={(e) => setMessage(e.target.value)} data-testid={`wt-commit-msg-${w.name}`} aria-label="Mensagem do commit" />
          <Button type="submit" className="!px-2 !py-0.5 text-xs" disabled={busy || message.trim().length < 3} data-testid={`wt-commit-${w.name}`}>Commit</Button>
        </form>
      )}
      {check && active && (
        <div className="flex flex-col gap-1 rounded border border-border p-1.5" data-testid={`wt-check-result-${w.name}`}>
          <span>Integrar em <strong>{check.targetBranch ?? '—'}</strong></span>
          {check.blockers.map((b) => <span key={b} className="text-warn">• {b}</span>)}
          {check.conflicts.length > 0 && <span className="text-warn" data-testid={`wt-conflicts-${w.name}`}>Conflitos previstos: {check.conflicts.join(', ')}. Resolva no worktree (ex.: peça ao agente) e verifique de novo.</span>}
          {check.canMerge && <span className="text-codex">Sem conflitos previstos.</span>}
          <Button variant="primary" className="self-start !px-2 !py-0.5 text-xs" disabled={!check.canMerge || busy}
            onClick={() => void act(() => merge(w.id), (v) => { setCheck(null); return v ? `Integrado em ${check.targetBranch}.` : 'Integração cancelada.'; })} data-testid={`wt-merge-${w.name}`}>Integrar…</Button>
        </div>
      )}
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'text-warn' : 'text-muted'} data-testid={`wt-msg-${w.name}`}>{msg.text}</p>}
      <DiffModal title={diff?.title ?? ''} text={diff?.text ?? null} onClose={() => setDiff(null)} />
    </li>
  );
}

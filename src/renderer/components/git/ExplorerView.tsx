import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExplorerEntry, GitLocation } from '@shared/git';
import { useAgentStore } from '../../stores/agentStore';
import { useGitStore } from '../../stores/gitStore';
import { useEditorStore } from '../../stores/editorStore';
import { DiffModal } from './DiffModal';

const MARK: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!', other: '?' };

export function ExplorerView() {
  const workspace = useAgentStore((s) => s.workspace);
  const allWorktrees = useGitStore((s) => s.worktrees);
  const worktrees = useMemo(() => allWorktrees.filter((w) => w.status !== 'removed' && w.present), [allWorktrees]);
  const [loc, setLoc] = useState<string>('root');
  const location: GitLocation = loc === 'root' ? { kind: 'root' } : { kind: 'worktree', id: loc };
  const [diff, setDiff] = useState<{ title: string; text: string } | null>(null);
  const openInEditor = useEditorStore((s) => s.open);
  const locationLabel = loc === 'root' ? `raiz: ${workspace?.name ?? ''}` : `worktree: ${worktrees.find((w) => w.id === loc)?.name ?? ''}`;
  const [error, setError] = useState<string | null>(null);
  if (!workspace) return <div className="p-4 text-muted">Escolha um workspace.</div>;
  const showDiff = async (rel: string) => {
    const r = await window.devfusion.git.fileDiff(location, rel);
    if (r.ok && r.data.ok) setDiff({ title: rel, text: r.data.value }); else setError(r.ok && !r.data.ok ? r.data.reason : 'Falha ao abrir.');
  };
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="explorer-view">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Explorer</h2>
        <select className="ml-auto max-w-[60%] rounded border border-border bg-bg px-1 py-0.5 text-xs" value={loc} onChange={(e) => setLoc(e.target.value)} data-testid="explorer-location" aria-label="Local">
          <option value="root">raiz: {workspace.name}</option>
          {worktrees.map((w) => <option key={w.id} value={w.id}>worktree: {w.name}</option>)}
        </select>
      </div>
      <p className="text-[11px] text-muted">Clique num arquivo para abrir no editor; ± mostra o diff{loc === 'root' ? ' contra HEAD' : ' desde a base do worktree'}. Letras: M modificado, A adicionado, U novo, D apagado.</p>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      <Dir key={loc} location={location} rel="" depth={0} onOpen={(r) => void openInEditor(location, locationLabel, r)} onDiff={(r) => void showDiff(r)} />
      <DiffModal title={diff?.title ?? ''} text={diff?.text ?? null} onClose={() => setDiff(null)} />
    </div>
  );
}

function Dir({ location, rel, depth, onOpen, onDiff }: { location: GitLocation; rel: string; depth: number; onOpen: (rel: string) => void; onDiff: (rel: string) => void }) {
  const tick = useGitStore((s) => s.fsTick);
  const [entries, setEntries] = useState<ExplorerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    const r = await window.devfusion.git.list(location, rel);
    if (r.ok && r.data.ok) { setEntries(r.data.value); setError(null); } else setError(r.ok && !r.data.ok ? r.data.reason : 'Falha ao listar.');
  }, [location.kind, location.kind === 'worktree' ? location.id : '', rel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, tick]);
  if (error) return <p className="text-xs text-warn" style={{ paddingLeft: depth * 12 }}>{error}</p>;
  if (!entries) return <p className="text-xs text-muted" style={{ paddingLeft: depth * 12 }}>…</p>;
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} className="text-xs" data-testid={depth === 0 ? 'explorer-tree' : undefined}>
      {entries.map((e) => (
        <li key={e.rel} role="treeitem" aria-expanded={e.type === 'dir' ? Boolean(open[e.rel]) : undefined}>
          <div className="flex items-center">
          <button type="button" style={{ paddingLeft: depth * 12 + 4 }} className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 pr-1 text-left hover:bg-surface-2"
            onClick={() => (e.type === 'dir' ? setOpen((o) => ({ ...o, [e.rel]: !o[e.rel] })) : e.type === 'file' ? onOpen(e.rel) : undefined)}
            title={e.type === 'symlink' ? 'Link simbólico para fora do workspace (bloqueado)' : e.rel} data-testid={`explorer-item-${e.rel}`}>
            <span aria-hidden="true" className="w-3 text-muted">{e.type === 'dir' ? (open[e.rel] ? '▾' : '▸') : e.type === 'symlink' ? '↗' : ''}</span>
            <span className={`truncate ${e.type === 'symlink' ? 'text-muted italic' : ''}`}>{e.name}</span>
            {e.status && <span className={`ml-auto font-mono ${e.status === 'conflicted' ? 'text-warn' : 'text-accent'}`} data-testid={`explorer-status-${e.rel}`}>{MARK[e.status]}</span>}
          </button>
          {e.type === 'file' && e.status && <button type="button" className="rounded px-1 text-muted hover:bg-surface-2 hover:text-fg" title={`Ver diff de ${e.name}`} aria-label={`Ver diff de ${e.name}`} onClick={() => onDiff(e.rel)} data-testid={`explorer-diff-${e.rel}`}>±</button>}
          </div>

          {e.type === 'dir' && open[e.rel] && <Dir location={location} rel={e.rel} depth={depth + 1} onOpen={onOpen} onDiff={onDiff} />}
        </li>
      ))}
      {entries.length === 0 && <li className="text-muted" style={{ paddingLeft: depth * 12 + 16 }}>(vazia)</li>}
    </ul>
  );
}

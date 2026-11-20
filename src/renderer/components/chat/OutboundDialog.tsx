import { useEffect, useState } from 'react';
import { AGENT_NAMES, type AgentId } from '@shared/agents';
import { MAX_MESSAGE_CHARS } from '@shared/orchestration';
import { focusTerminal } from '../agents/TerminalView';
import { Button, Modal } from '../ui/Modal';

export interface OutboundDraft {
  title: string;
  target: AgentId;
  content: string;
  warnings: string[];
  /** Texto fixo que o app acrescenta (ex.: cabeçalho de procedência), só exibido. */
  prefix?: string;
  confirm: (content: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

/**
 * Pré-visualização obrigatória de tudo que sai para um agente. O usuário pode editar;
 * ao confirmar, o texto é colado no terminal e o envio final é o Enter dele.
 */
export function OutboundDialog({ draft, onClose }: { draft: OutboundDraft | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(draft?.content ?? ''); setError(null); }, [draft]);
  const total = (draft?.prefix ? draft.prefix.length + 2 : 0) + text.length;

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    const r = await draft.confirm(text);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    onClose();
    focusTerminal(draft.target);
  };

  return (
    <Modal title={draft?.title ?? ''} open={draft !== null} onClose={onClose} testId="outbound-dialog"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={busy || !text.trim() || total > MAX_MESSAGE_CHARS} onClick={() => void confirm()} data-testid="outbound-confirm">
          Colar no terminal de {draft ? AGENT_NAMES[draft.target] : ''}
        </Button>
      </>}>
      {draft && (
        <div className="flex flex-col gap-2">
          <p className="text-muted">Revise o texto. Ele será colado no terminal de <strong>{AGENT_NAMES[draft.target]}</strong>; nada é enviado até você pressionar Enter lá.</p>
          {draft.warnings.map((w) => <p key={w} role="alert" className="rounded border border-warn px-2 py-1 text-xs text-warn" data-testid="outbound-warning">{w}</p>)}
          {draft.prefix && <pre className="rounded bg-surface-2 px-2 py-1 text-xs whitespace-pre-wrap text-muted" data-testid="outbound-prefix">{draft.prefix}</pre>}
          <label className="sr-only" htmlFor="outbound-text">Conteúdo</label>
          <textarea id="outbound-text" value={text} onChange={(e) => setText(e.target.value)} rows={14} spellCheck={false}
            className="w-full rounded border border-border bg-bg p-2 font-mono text-xs" data-testid="outbound-text" />
          <p className={`text-right text-xs ${total > MAX_MESSAGE_CHARS ? 'text-warn' : 'text-muted'}`}>{total.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()} caracteres</p>
          {error && <p role="alert" className="text-warn" data-testid="outbound-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

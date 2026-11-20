import { Modal } from '../ui/Modal';

/** Diff somente leitura com cores por linha (+/-/@@). */
export function DiffModal({ title, text, onClose }: { title: string; text: string | null; onClose: () => void }) {
  return (
    <Modal title={title} open={text !== null} onClose={onClose} testId="diff-modal">
      <pre className="overflow-auto rounded bg-bg p-2 font-mono text-xs leading-5" data-testid="diff-text">
        {(text ?? '').split('\n').map((l, i) => (
          <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-codex' : l.startsWith('-') && !l.startsWith('---') ? 'text-claude' : l.startsWith('@@') ? 'text-accent' : ''}>{l || ' '}</div>
        ))}
      </pre>
    </Modal>
  );
}

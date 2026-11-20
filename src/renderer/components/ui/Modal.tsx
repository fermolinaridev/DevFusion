import { useEffect, useRef, type ReactNode } from 'react';

/** Diálogo modal acessível usando <dialog> nativo (foco preso e Esc fecham). */
export function Modal({ title, open, onClose, children, footer, testId }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      aria-labelledby="modal-title"
      data-testid={testId}
      className="m-auto w-[min(720px,92vw)] rounded-lg border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      {/* Conteúdo só existe enquanto aberto: evita elementos duplicados/ocultos no DOM. */}
      {open && <>
        <div className="flex items-center border-b border-border px-4 py-3">
          <h2 id="modal-title" className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="ml-auto rounded px-2 text-muted hover:bg-surface-2 hover:text-fg">✕</button>
        </div>
        <div className="max-h-[65vh] overflow-auto px-4 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </>}
    </dialog>
  );
}

export function Button({ variant = 'secondary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary: 'bg-accent text-accent-contrast hover:opacity-90',
    secondary: 'border border-border bg-surface hover:bg-surface-2',
    ghost: 'text-accent hover:underline',
  }[variant];
  return <button type="button" {...props} className={`rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`} />;
}

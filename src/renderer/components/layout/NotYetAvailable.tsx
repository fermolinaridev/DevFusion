/** Placeholder honesto: diz o que ainda não existe e em qual fase do roadmap entra. */
export function NotYetAvailable({ title, phase, children }: { title: string; phase: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-muted">Ainda não implementado — previsto para a Fase {phase} do roadmap.</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}

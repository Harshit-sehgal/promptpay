import { type ReactNode } from 'react';

/** A glass panel: the one container every dashboard section sits in. */
export function Panel({
  children,
  label,
  flush = false,
  className = '',
}: {
  children: ReactNode;
  /** Accessible name when the panel has no visible PanelHeader. */
  label?: string;
  /** Drop the inner padding, for tables and divided lists. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`dash-panel ${flush ? 'dash-panel--flush' : ''} ${className}`.trim()}
    >
      {children}
    </section>
  );
}

export function PanelHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="dash-panel__head">
      <h2 className="dash-panel__title">{title}</h2>
      {action}
    </div>
  );
}

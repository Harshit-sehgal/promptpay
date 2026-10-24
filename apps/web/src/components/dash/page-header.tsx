import { type ReactNode } from 'react';

/** The top of every dashboard page: mono eyebrow, display title, lede, actions. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="dash-head">
      <div className="dash-head__text">
        {eyebrow && <p className="dash-eyebrow">{eyebrow}</p>}
        <h1 className="dash-title">{title}</h1>
        {lede && <p className="dash-lede">{lede}</p>}
      </div>
      {actions && <div className="dash-head__actions">{actions}</div>}
    </header>
  );
}

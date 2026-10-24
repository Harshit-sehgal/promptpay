import { type ReactNode } from 'react';

/** The top of every dashboard page: title, optional lede, actions. */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="dash-head">
      <div className="dash-head__text">
        <h1 className="dash-title">{title}</h1>
        {lede && <p className="dash-lede">{lede}</p>}
      </div>
      {actions && <div className="dash-head__actions">{actions}</div>}
    </header>
  );
}

import { type ReactNode } from 'react';

import { type Tone } from './pill';

/** A glass strip with a tone bar, for errors, holds and beta disclosures. */
export function Notice({
  tone = 'neutral',
  title,
  children,
  actions,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className="dash-notice" data-tone={tone} role={role}>
      <div className="dash-notice__body">
        {title && <p className="dash-notice__title">{title}</p>}
        {children && <div className="dash-notice__text">{children}</div>}
      </div>
      {actions && <div className="dash-notice__actions">{actions}</div>}
    </div>
  );
}

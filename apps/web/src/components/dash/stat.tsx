import { type ReactNode } from 'react';

/** A labelled figure. `chip` puts the value in the ink clock chip from the
    homepage hero: one per page, for the number that matters most. */
export function Stat({
  label,
  value,
  detail,
  chip = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  chip?: boolean;
}) {
  return (
    <div className="dash-stat">
      <p className="dash-stat__label">{label}</p>
      <p className={`dash-stat__value ${chip ? 'dash-stat__value--chip' : ''}`.trim()}>{value}</p>
      {detail && <p className="dash-stat__detail">{detail}</p>}
    </div>
  );
}

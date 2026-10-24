import { type ReactNode } from 'react';

/** The legacy stat signature, drawn as the dashboard Stat. `valueColor` and
    `variant` are accepted for existing call sites but no longer tint: figures
    stay ink, and status lives in Pills. */
export function StatCard({
  label,
  value,
  subtitle,
  icon,
}: {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  valueColor?: string;
  variant?: 'dark' | 'light';
  icon?: ReactNode;
}) {
  return (
    <div className="dash-stat app-stat-card">
      <div className="dash-stat__top">
        <p className="dash-stat__label">{label}</p>
        {icon && (
          <span className="dash-stat__icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <p className="dash-stat__value app-stat-card__value">{value}</p>
      {subtitle && <p className="dash-stat__detail">{subtitle}</p>}
    </div>
  );
}

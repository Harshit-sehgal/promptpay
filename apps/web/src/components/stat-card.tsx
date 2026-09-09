import { type ReactNode } from 'react';

export function StatCard({
  label,
  value,
  subtitle,
  valueColor,
  variant = 'light',
  icon,
}: {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  valueColor?: string;
  variant?: 'dark' | 'light';
  icon?: ReactNode;
}) {
  const isLight = variant === 'light';

  const defaultValColor = valueColor || (isLight ? 'text-surface-900' : 'text-white');

  return (
    <div className={`app-stat-card ${isLight ? 'app-stat-card--light' : 'app-stat-card--dark'}`}>
      <div className="flex items-center justify-between mb-1">
        <p className={`text-sm font-medium ${isLight ? 'text-surface-600' : 'text-ink-200'}`}>
          {label}
        </p>
        {icon && <span className="shrink-0">{icon}</span>}
      </div>
      <p
        className={`app-stat-card__value text-3xl font-medium font-mono tabular-nums ${defaultValColor}`}
      >
        {value}
      </p>
      {subtitle && (
        <p
          className={`app-stat-card__subtitle text-xs mt-1.5 ${isLight ? 'text-surface-600' : 'text-ink-300'}`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

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
    <div
      className={`rounded-2xl p-6 border shadow-sm transition-all duration-200 motion-reduce:transition-none ${
        isLight
          ? 'bg-white border-surface-200/80 shadow-surface-100/50'
          : 'bg-ink-800 border-ink-600/30'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <p className={`text-sm font-medium ${isLight ? 'text-surface-600' : 'text-ink-200'}`}>
          {label}
        </p>
        {icon && <span className="shrink-0">{icon}</span>}
      </div>
      <p className={`text-3xl font-bold font-mono tabular-nums ${defaultValColor}`}>{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1.5 ${isLight ? 'text-surface-600' : 'text-ink-300'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

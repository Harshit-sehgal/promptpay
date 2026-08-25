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
      className={`rounded-[20px] p-6 border transition-all duration-200 motion-reduce:transition-none ${
        isLight
          ? 'bg-white border-surface-200/70 shadow-[0_0_0_1px_rgba(4,23,43,0.04),0_8px_24px_-12px_rgba(0,0,0,0.1)]'
          : 'bg-ink-800 border-ink-600/30'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <p className={`text-sm font-medium ${isLight ? 'text-surface-600' : 'text-ink-200'}`}>
          {label}
        </p>
        {icon && <span className="shrink-0">{icon}</span>}
      </div>
      <p className={`text-3xl font-medium font-mono tabular-nums ${defaultValColor}`}>{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1.5 ${isLight ? 'text-surface-600' : 'text-ink-300'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

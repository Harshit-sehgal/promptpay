export function StatCard({
  label,
  value,
  subtitle,
  valueColor,
  variant = 'light',
}: {
  label: string;
  value: string;
  subtitle?: string;
  valueColor?: string;
  variant?: 'dark' | 'light';
}) {
  const isLight = variant === 'light';

  const defaultValColor = valueColor || (isLight ? 'text-surface-900' : 'text-white');

  return (
    <div
      className={`rounded-2xl p-6 transition-all duration-200 border shadow-sm ${
        isLight
          ? 'bg-white border-surface-200/80 shadow-surface-100/50'
          : 'bg-ink-800 border-ink-600/30'
      }`}
    >
      <p className={`text-sm mb-1 ${isLight ? 'text-surface-500' : 'text-ink-300'}`}>{label}</p>
      <p className={`text-3xl font-bold font-mono tabular-nums ${defaultValColor}`}>{value}</p>
      {subtitle && (
        <p className={`text-xs mt-1.5 ${isLight ? 'text-surface-500' : 'text-ink-400'}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  subtitle,
  valueColor = 'text-white',
}: {
  label: string;
  value: string;
  subtitle?: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
      <p className="text-ink-300 text-sm mb-1">{label}</p>
      <p className={`text-3xl font-bold font-mono ${valueColor}`}>{value}</p>
      {subtitle && <p className="text-ink-400 text-xs mt-1">{subtitle}</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    // Campaign statuses
    draft: 'bg-ink-600 text-ink-200',
    submitted: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-blue-500/20 text-blue-400',
    active: 'bg-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/20 text-amber-400',
    rejected: 'bg-red-500/20 text-red-400',
    archived: 'bg-ink-600 text-ink-400',
    // Payout statuses
    requested: 'bg-yellow-500/20 text-yellow-400',
    under_review: 'bg-blue-500/20 text-blue-400',
    processing: 'bg-purple-500/20 text-purple-400',
    paid: 'bg-emerald-500/20 text-emerald-400',
    failed: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-ink-600 text-ink-400',
    // Fraud statuses
    open: 'bg-red-500/20 text-red-400',
    reviewing: 'bg-yellow-500/20 text-yellow-400',
    resolved_valid: 'bg-orange-500/20 text-orange-400',
    resolved_invalid: 'bg-emerald-500/20 text-emerald-400',
    escalated: 'bg-red-500/20 text-red-400',
    // Earning statuses
    estimated: 'bg-ink-600 text-ink-200',
    pending: 'bg-yellow-500/20 text-yellow-400',
    confirmed: 'bg-emerald-500/20 text-emerald-400',
    held: 'bg-amber-500/20 text-amber-400',
    reversed: 'bg-red-500/20 text-red-400',
    void: 'bg-ink-600 text-ink-400',
    // Trust levels
    new: 'bg-ink-600 text-ink-200',
    normal: 'bg-blue-500/20 text-blue-400',
    high_trust: 'bg-emerald-500/20 text-emerald-400',
    low_trust: 'bg-amber-500/20 text-amber-400',
    restricted: 'bg-red-500/20 text-red-400',
    banned: 'bg-red-500/20 text-red-400',
  };

  const colorClass = colors[status] || 'bg-ink-600 text-ink-200';

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colorClass}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase();

  // Group statuses into semantic buckets for clean, professional, and accessible badges
  const getBadgeStyle = (s: string) => {
    switch (s) {
      // Positive / Success
      case 'active':
      case 'paid':
      case 'confirmed':
      case 'approved':
      case 'resolved_invalid':
      case 'high_trust':
        return 'bg-emerald-50 border-emerald-200/60 text-emerald-700';

      // Warning / Pending
      case 'submitted':
      case 'requested':
      case 'reviewing':
      case 'pending':
      case 'paused':
      case 'held':
      case 'low_trust':
        // Yellow rather than amber: amber-700 (#b45309) against rose-700
        // (#be123c) separates by only ΔE 11.5 for NORMAL colour vision, under
        // the ΔE 15 floor, so "pending" and "rejected" read as the same colour.
        // yellow-700 (#a16207) lifts that to 15.6. Red/yellow still converge
        // under deuteranopia; the badge's text label is the mitigation, which
        // is why status colour is never the sole carrier of meaning here.
        return 'bg-yellow-50 border-yellow-200/60 text-yellow-700';

      // Error / Critical
      case 'rejected':
      case 'failed':
      case 'open':
      case 'escalated':
      case 'reversed':
      case 'restricted':
      case 'banned':
        return 'bg-rose-50 border-rose-200/60 text-rose-700';

      // Neutral / Informational
      case 'draft':
      case 'archived':
      case 'under_review':
      case 'processing':
      case 'cancelled':
      case 'void':
      case 'new':
      case 'normal':
      default:
        return 'bg-slate-50 border-slate-200 text-slate-600';
    }
  };

  const badgeStyle = getBadgeStyle(normalizedStatus);

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeStyle} tracking-tight`}
      aria-label={`Status: ${normalizedStatus}`}
    >
      {normalizedStatus.replace(/_/g, ' ')}
    </span>
  );
}

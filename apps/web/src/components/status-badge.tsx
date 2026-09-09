export function StatusBadge({
  status,
  kind = 'status',
}: {
  status: string;
  kind?: 'status' | 'metadata';
}) {
  const normalizedStatus = status.trim().toLowerCase();

  // Keep status semantics available without turning every table value into a
  // decorative capsule. The text remains the source of truth; tone is a
  // restrained visual hint only.
  const getTone = (s: string): 'success' | 'warning' | 'danger' | 'neutral' => {
    switch (s) {
      // Positive / Success
      case 'active':
      case 'paid':
      case 'confirmed':
      case 'approved':
      case 'resolved_invalid':
      case 'high_trust':
        return 'success';

      // Warning / Pending
      case 'submitted':
      case 'requested':
      case 'reviewing':
      case 'pending':
      case 'paused':
      case 'held':
      case 'low_trust':
      case 'medium':
        return 'warning';

      // Error / Critical
      case 'rejected':
      case 'failed':
      case 'open':
      case 'escalated':
      case 'reversed':
      case 'restricted':
      case 'banned':
      case 'critical':
      case 'high':
        return 'danger';

      // Neutral / Informational
      case 'draft':
      case 'archived':
      case 'under_review':
      case 'processing':
      case 'cancelled':
      case 'void':
      case 'new':
      case 'normal':
      case 'low':
      default:
        return 'neutral';
    }
  };

  const tone = getTone(normalizedStatus);

  return (
    <span
      className={`status-badge ${kind === 'metadata' ? 'status-badge--metadata' : ''}`}
      data-status-tone={tone}
      data-status-kind={kind}
      aria-label={kind === 'metadata' ? normalizedStatus : `Status: ${normalizedStatus}`}
    >
      {kind === 'status' && <span className="status-badge__dot" aria-hidden="true" />}
      {normalizedStatus.replace(/_/g, ' ')}
    </span>
  );
}

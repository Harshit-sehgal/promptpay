import type { PayoutProviderReadiness } from '@ateva/shared';

export type { PayoutProviderReadiness } from '@ateva/shared';

/** Runtime-selectable providers. Missing or internally inconsistent state fails closed. */
export function selectablePayoutProviders(
  readiness: PayoutProviderReadiness[] | undefined,
): PayoutProviderReadiness[] {
  if (!readiness) return [];
  return readiness.filter((entry) => entry.available && entry.status === 'available');
}

export function payoutProviderStatusLabel(
  status: PayoutProviderReadiness['status'],
  available = status === 'available',
): string {
  if (!available && status === 'available') return 'Unavailable';
  switch (status) {
    case 'available':
      return 'Available';
    case 'coming_soon':
      return 'Coming soon';
    case 'temporarily_disabled':
      return 'Temporarily unavailable';
    case 'unconfigured':
      return 'Not configured';
    case 'unimplemented':
      return 'Not supported';
  }
}

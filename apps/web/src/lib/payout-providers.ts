// A-030: the web re-exports the shared provider catalogue + override logic so
// the web UI and the API honour the SAME operator gate (single source of truth
// in @waitlayer/shared). The resolved lists are computed at module load from
// the web-only NEXT_PUBLIC_* env var (inlined by the Next.js build).

import { applyPayoutProviderOverrides, PAYOUT_PROVIDERS } from '@waitlayer/shared';

export { applyPayoutProviderOverrides, PAYOUT_PROVIDERS };
export type { PayoutProviderInfo, PayoutProviderLaunchStatus } from '@waitlayer/shared';

// Resolved at module load. In the browser, only NEXT_PUBLIC_* env vars are
// inlined by the Next.js build, so operators set that variable in the web
// deploy environment.
export const RESOLVED_PAYOUT_PROVIDERS = applyPayoutProviderOverrides(
  PAYOUT_PROVIDERS,
  process.env.NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS,
);

export const AVAILABLE_PAYOUT_PROVIDERS = RESOLVED_PAYOUT_PROVIDERS.filter(
  (p) => p.status === 'available',
);

export const COMING_SOON_PAYOUT_PROVIDERS = RESOLVED_PAYOUT_PROVIDERS.filter(
  (p) => p.status === 'coming_soon',
);

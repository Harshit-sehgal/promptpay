'use client';

import { useEffect, useState } from 'react';

/**
 * Persistent product-mode marker for WL-013. The public build only renders
 * this when the deployment explicitly identifies itself as `sandbox`; missing
 * or malformed values remain visually unchanged rather than guessing.
 */
type SandboxBannerProps = {
  /** Optional override keeps unit tests deterministic; production uses build-time env. */
  environmentKind?: string;
};

export default function SandboxBanner({ environmentKind }: SandboxBannerProps = {}) {
  const localKind =
    environmentKind ??
    process.env.NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND ??
    process.env.NEXT_PUBLIC_WAITLAYER_ENVIRONMENT_KIND;
  const [serverKind, setServerKind] = useState<string | null>(
    environmentKind ? environmentKind : null,
  );

  useEffect(() => {
    if (environmentKind !== undefined) return;
    let active = true;
    void fetch('/api/platform-health', { cache: 'no-store' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('health unavailable')),
      )
      .then((health: { environmentKind?: string }) => {
        if (active) setServerKind(health.environmentKind ?? null);
      })
      .catch(() => {
        if (active) setServerKind('unverified');
      });
    return () => {
      active = false;
    };
  }, [environmentKind]);

  const verified = serverKind === 'sandbox';
  const unverified = serverKind === null || serverKind === 'unverified';
  const mismatch = !unverified && localKind !== serverKind;
  const shouldShow = verified || localKind === 'sandbox';
  if (!shouldShow) return null;

  return (
    <div
      role="status"
      aria-label={verified ? 'Sandbox environment' : 'Environment verification warning'}
      className={`sticky top-0 z-[70] border-b px-4 py-2 text-center text-xs font-semibold tracking-wide shadow-sm ${
        verified && !mismatch
          ? 'border-amber-300 bg-amber-100 text-amber-950'
          : 'border-red-300 bg-red-100 text-red-950'
      }`}
    >
      {verified && !mismatch
        ? 'SANDBOX · Test credits only · No cash value'
        : mismatch
          ? `ENVIRONMENT MISMATCH · Client ${localKind ?? 'unset'}, server ${serverKind}`
          : 'ENVIRONMENT UNVERIFIED · API environment was not confirmed'}
    </div>
  );
}

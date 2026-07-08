import type { Ad } from './api-client';

/**
 * Dependencies the ad flow needs from an API client. Isolated behind an
 * interface so the flow can be unit-tested with a mock client without any
 * network access (A-040).
 */
export interface AdFlowClient {
  requestAd(input: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    toolType: string;
    idempotencyKey: string;
  }): Promise<Ad | null>;
  recordAdRendered(input: {
    impressionToken: string;
    renderedAt: string;
    idempotencyKey: string;
  }): Promise<void>;
  recordImpressionQualified(input: {
    impressionToken: string;
    qualifiedAt: string;
    visibleDurationMs: number;
    idempotencyKey: string;
  }): Promise<void>;
}

/**
 * Minimum visible duration (ms) an ad must be shown before it can qualify for
 * earnings. Mirrors the server-side `MINIMUM_VISIBLE_DURATION_MS` invariant.
 */
export const MINIMUM_VISIBLE_DURATION_MS = 5000;

export interface AdFlowParams {
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  toolType: string;
  idempotencyKey: string;
  /** How long the wait state (and therefore the ad) was visible, in ms. */
  durationMs: number;
}

/**
 * Drive one terminal wait-state through the ad-serving money loop:
 * request → render → (if shown long enough) qualify. Returns whether an ad
 * was served. Click is intentionally omitted for the privacy-sensitive
 * terminal surface; the server still bills on qualified impressions.
 *
 * The flow is idempotent per `idempotencyKey` (enforced server-side), so a
 * re-used wait state cannot double-credit earnings.
 */
export async function runAdFlow(
  client: AdFlowClient,
  params: AdFlowParams,
): Promise<{ served: boolean; impressionToken?: string }> {
  const ad = await client.requestAd({
    deviceId: params.deviceId,
    sessionId: params.sessionId,
    waitStateId: params.waitStateId,
    toolType: params.toolType,
    idempotencyKey: params.idempotencyKey,
  });
  if (!ad) return { served: false };

  await client.recordAdRendered({
    impressionToken: ad.impressionToken,
    renderedAt: new Date().toISOString(),
    idempotencyKey: `render-${ad.impressionToken}`,
  });

  if (params.durationMs >= MINIMUM_VISIBLE_DURATION_MS) {
    await client.recordImpressionQualified({
      impressionToken: ad.impressionToken,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: params.durationMs,
      idempotencyKey: `imp-${ad.impressionToken}`,
    });
  }

  return { served: true, impressionToken: ad.impressionToken };
}

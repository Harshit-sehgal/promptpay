import { describe, expect, it } from 'vitest';

import { AdRequestResponse } from './contracts';

describe('AdRequestResponse launch modes', () => {
  it('accepts the explicit telemetry_only non-billable beta mode', () => {
    expect(
      AdRequestResponse.parse({
        ad: null,
        mode: 'telemetry_only',
        reason: 'earnings_not_available',
      }),
    ).toMatchObject({ mode: 'telemetry_only' });
  });

  it('accepts an explicitly non-cash sandbox placement response', () => {
    expect(
      AdRequestResponse.parse({
        ad: {
          impressionToken: 'sandbox-1',
          campaignId: 'campaign-1',
          creativeId: 'creative-1',
          title: 'Sandbox ad',
          message: 'Test credits only',
          label: 'Sponsored · Sandbox',
          displayDomain: 'sandbox.waitlayer.test',
          destinationUrl: 'https://sandbox.waitlayer.test/ad',
          ctaText: 'Learn more',
        },
        mode: 'sandbox',
        hasCashValue: false,
      }),
    ).toMatchObject({ mode: 'sandbox', hasCashValue: false });
  });

  it('rejects the misleading legacy ads_only mode', () => {
    expect(() => AdRequestResponse.parse({ ad: null, mode: 'ads_only' })).toThrow();
  });
});

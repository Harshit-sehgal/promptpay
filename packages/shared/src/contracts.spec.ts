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

  it('rejects the misleading legacy ads_only mode', () => {
    expect(() => AdRequestResponse.parse({ ad: null, mode: 'ads_only' })).toThrow();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { AdFlowClient, MINIMUM_VISIBLE_DURATION_MS, runAdFlow } from './ad-flow';

function makeClient(ad: { impressionToken: string } | null) {
  return {
    requestAd: vi.fn().mockResolvedValue(ad),
    recordAdRendered: vi.fn().mockResolvedValue(undefined),
    recordImpressionQualified: vi.fn().mockResolvedValue(undefined),
  } as unknown as AdFlowClient;
}

const params = {
  deviceId: 'dev_1',
  sessionId: 's_1',
  waitStateId: 'ws_1',
  toolType: 'terminal',
  idempotencyKey: 'key_1',
};

describe('runAdFlow (A-040)', () => {
  it('reports no ad served when the API returns no ad', async () => {
    const client = makeClient(null);
    const res = await runAdFlow(client, { ...params, durationMs: 10_000 });
    expect(res.served).toBe(false);
    expect(client.recordAdRendered).not.toHaveBeenCalled();
  });

  it('requests, renders, and qualifies a long enough wait state', async () => {
    const client = makeClient({ impressionToken: 'imp_1' });
    const res = await runAdFlow(client, { ...params, durationMs: 8000 });

    expect(res.served).toBe(true);
    expect(res.impressionToken).toBe('imp_1');
    expect(client.requestAd).toHaveBeenCalledOnce();
    expect(client.recordAdRendered).toHaveBeenCalledWith(
      expect.objectContaining({ impressionToken: 'imp_1' }),
    );
    expect(client.recordImpressionQualified).toHaveBeenCalledWith(
      expect.objectContaining({ impressionToken: 'imp_1', visibleDurationMs: 8000 }),
    );
  });

  it('does not qualify an impression below the minimum visible duration', async () => {
    const client = makeClient({ impressionToken: 'imp_1' });
    await runAdFlow(client, { ...params, durationMs: MINIMUM_VISIBLE_DURATION_MS - 1 });

    expect(client.recordAdRendered).toHaveBeenCalledOnce();
    expect(client.recordImpressionQualified).not.toHaveBeenCalled();
  });
});

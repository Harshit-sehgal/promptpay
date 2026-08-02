import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisBackedThrottlerStorage } from './redis-throttler.storage';
import { RedisWindowCounter } from './redis-window-counter';

function makeCounter() {
  return {
    hit: vi.fn().mockResolvedValue({
      totalHits: 4,
      timeToExpireMs: 50_000,
      isBlocked: false,
      timeToBlockExpireMs: 0,
    }),
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisWindowCounter;
}

describe('RedisBackedThrottlerStorage', () => {
  let counter: ReturnType<typeof makeCounter>;

  beforeEach(() => {
    counter = makeCounter();
  });

  it('delegates to the Redis counter and converts the record shape', async () => {
    const storage = new RedisBackedThrottlerStorage(counter, false);
    const record = await storage.increment('ip:1.2.3.4', 60_000, 5, 120_000, 'auth-short');

    expect(counter.hit).toHaveBeenCalledWith('auth-short:ip:1.2.3.4', 60_000, 5, 120_000);
    expect(record).toEqual({
      totalHits: 4,
      timeToExpire: 50,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('falls back to in-memory storage when Redis hits fail and not fail-closed', async () => {
    counter.hit.mockRejectedValue(new Error('ECONNRESET'));
    const storage = new RedisBackedThrottlerStorage(counter, false);
    const first = await storage.increment('ip:1.2.3.4', 60_000, 5, 120_000, 'default');
    const second = await storage.increment('ip:1.2.3.4', 60_000, 5, 120_000, 'default');

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
  });

  it('re-throws Redis failures when fail-closed (production)', async () => {
    counter.hit.mockRejectedValue(new Error('ECONNRESET'));
    const storage = new RedisBackedThrottlerStorage(counter, true);
    await expect(
      storage.increment('ip:1.2.3.4', 60_000, 5, 120_000, 'auth-short'),
    ).rejects.toThrow('ECONNRESET');
  });

  it('uses in-memory storage when no Redis counter is configured', async () => {
    const storage = new RedisBackedThrottlerStorage(null, true);
    const record = await storage.increment('ip:9.9.9.9', 60_000, 5, 60_000, 'default');
    expect(record.totalHits).toBe(1);
  });
});

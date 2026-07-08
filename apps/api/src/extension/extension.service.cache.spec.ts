import { describe, expect, it } from 'vitest';

import { adCacheKey, adIdempotencyCacheKey } from './extension.service';

describe('ad-request cache key scoping (A-038)', () => {
  it('namespaces the cache by userId+deviceId so two users sharing a waitStateId get different keys', () => {
    const a = adCacheKey('userA', 'dev1', 'ws-1');
    const b = adCacheKey('userB', 'dev2', 'ws-1');
    expect(a).not.toBe(b);
    // Same user+device+waitState is stable (enables same-user retries).
    expect(a).toBe(adCacheKey('userA', 'dev1', 'ws-1'));
  });

  it('idempotency key is also namespaced by user+device', () => {
    const a = adIdempotencyCacheKey('userA', 'dev1', 'idem-1');
    const b = adIdempotencyCacheKey('userB', 'dev1', 'idem-1');
    expect(a).not.toBe(b);
  });
});

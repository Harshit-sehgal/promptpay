import { describe, expect, it, vi } from 'vitest';

import { CircuitBreaker, CircuitBreakerOpenError } from './provider-resilience';

describe('CircuitBreaker', () => {
  it('reports an open circuit as a known no-call failure', async () => {
    const breaker = new CircuitBreaker();
    const failingCall = vi.fn().mockRejectedValue(new Error('provider unavailable'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(breaker.call('provider', failingCall)).rejects.toThrow('provider unavailable');
    }

    const blockedCall = vi.fn();
    await expect(breaker.call('provider', blockedCall)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
    expect(blockedCall).not.toHaveBeenCalled();
  });
});

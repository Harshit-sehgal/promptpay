import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from 'redis';

import { RedisHealthService } from './redis-health.service';

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    isReady: false,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    isReady: false,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('RedisHealthService (A-053)', () => {
  let service: RedisHealthService;

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    vi.mocked(createClient).mockReset();
    vi.mocked(createClient).mockImplementation(
      () =>
        ({
          isReady: false,
          on: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
          ping: vi.fn().mockResolvedValue('PONG'),
          quit: vi.fn().mockResolvedValue(undefined),
        }) as never,
    );
    service = new RedisHealthService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('reports not_configured when REDIS_URL is absent', async () => {
    delete process.env.REDIS_URL;
    const svc = new RedisHealthService();
    expect(await svc.check()).toEqual({ status: 'not_configured' });
  });

  it('recovers after an initial connection failure (does not latch the rejected promise)', async () => {
    const failing = makeClient({
      connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    vi.mocked(createClient).mockReturnValueOnce(failing as never);

    const first = await service.check();
    expect(first.status).toBe('error');

    const recovered = makeClient({ isReady: true });
    vi.mocked(createClient).mockReturnValueOnce(recovered as never);

    const second = await service.check();
    expect(second.status).toBe('connected');
  });

  it('drops a stale client and reconnects on the next check after a ping failure', async () => {
    const firstClient = makeClient({ isReady: true });
    vi.mocked(createClient).mockReturnValueOnce(firstClient as never);

    expect((await service.check()).status).toBe('connected');

    // The same cached client now fails to respond.
    firstClient.ping = vi.fn().mockRejectedValue(new Error('connection closed'));

    expect((await service.check()).status).toBe('error');

    const fresh = makeClient({ isReady: true });
    vi.mocked(createClient).mockReturnValueOnce(fresh as never);

    expect((await service.check()).status).toBe('connected');
    expect(fresh.connect).toHaveBeenCalled();
  });
});

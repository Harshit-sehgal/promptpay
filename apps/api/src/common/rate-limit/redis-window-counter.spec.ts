import { createClient } from 'redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisWindowCounter } from './redis-window-counter';

function makeClient() {
  return {
    isReady: false,
    isOpen: false,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('redis', () => ({
  createClient: vi.fn(() => makeClient()),
}));

describe('RedisWindowCounter', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
    vi.mocked(createClient).mockReturnValueOnce(client);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses an EVAL reply into a window-counter result', async () => {
    client.sendCommand.mockResolvedValue(['3', '45000', '0', '0']);
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    const result = await counter.hit('user:1', 60_000, 5, 120_000);

    expect(result).toEqual({
      totalHits: 3,
      timeToExpireMs: 45_000,
      isBlocked: false,
      timeToBlockExpireMs: 0,
    });
    expect(client.sendCommand).toHaveBeenCalledWith([
      'EVAL',
      expect.stringContaining('local ttlMs'),
      '2',
      'wl:throttle:hits:user:1',
      'wl:throttle:block:user:1',
      '60000',
      '5',
      '120000',
    ]);
  });

  it('reports a blocked window and its remaining TTL', async () => {
    client.sendCommand.mockResolvedValue(['6', '10000', '1', '90000']);
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    const result = await counter.hit('user:2', 60_000, 5, 120_000);

    expect(result.isBlocked).toBe(true);
    expect(result.timeToBlockExpireMs).toBe(90_000);
  });

  it('isBlocked reads the block-key PTTL', async () => {
    client.sendCommand.mockResolvedValue('120000');
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    const result = await counter.isBlocked('user:3');

    expect(result).toEqual({ blocked: true, ttlMs: 120_000 });
    expect(client.sendCommand).toHaveBeenCalledWith(['PTTL', 'wl:throttle:block:user:3']);
  });

  it('isBlocked reports not-blocked when PTTL is -2 (key absent)', async () => {
    client.sendCommand.mockResolvedValue('-2');
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    const result = await counter.isBlocked('user:4');

    expect(result).toEqual({ blocked: false, ttlMs: 0 });
  });

  it('reset deletes both the hit and block keys for each key', async () => {
    client.sendCommand.mockResolvedValue(2);
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    await counter.reset(['a', 'b']);

    expect(client.sendCommand).toHaveBeenCalledWith([
      'DEL',
      'wl:throttle:hits:a',
      'wl:throttle:block:a',
      'wl:throttle:hits:b',
      'wl:throttle:block:b',
    ]);
  });

  it('disconnects cleanly', async () => {
    client.isOpen = true;
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    await counter.connect();
    await counter.disconnect();

    expect(client.quit).toHaveBeenCalledOnce();
  });

  it('reports readiness after connect', async () => {
    const counter = new RedisWindowCounter('redis://localhost:6379', 'wl:throttle');
    expect(counter.isReady()).toBe(false);
    await counter.connect();
    client.isReady = true;
    expect(counter.isReady()).toBe(true);
  });
});

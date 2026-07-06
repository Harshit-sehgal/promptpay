import { createClient, RedisClientType } from 'redis';

export interface WindowCounterResult {
  totalHits: number;
  timeToExpireMs: number;
  isBlocked: boolean;
  timeToBlockExpireMs: number;
}

type RedisCommandClient = RedisClientType & {
  sendCommand(args: string[]): Promise<unknown>;
};

const HIT_SCRIPT = `
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  local hitTtl = redis.call('PTTL', KEYS[1])
  if hitTtl < 0 then hitTtl = 0 end
  return { hits, hitTtl, 1, blockTtl }
end

local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ttlMs)
end

local hitTtl = redis.call('PTTL', KEYS[1])
if hitTtl < 0 then
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  hitTtl = ttlMs
end

if hits > limit then
  redis.call('SET', KEYS[2], '1', 'PX', blockMs)
  return { hits, hitTtl, 1, blockMs }
end

return { hits, hitTtl, 0, 0 }
`;

export class RedisWindowCounter {
  private client: RedisCommandClient | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(
    private readonly redisUrl: string,
    private readonly namespace: string,
  ) {}

  async connect(): Promise<void> {
    if (this.client?.isReady) return;
    if (this.connectPromise) return this.connectPromise;

    const client = createClient({ url: this.redisUrl }) as RedisCommandClient;
    client.on('error', () => {
      // Connection errors are surfaced by command/connect promises. Keep the
      // event handler attached so node-redis does not emit an unhandled error.
    });
    this.client = client;
    this.connectPromise = client
      .connect()
      .then(() => undefined)
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
  }

  isReady(): boolean {
    return !!this.client?.isReady;
  }

  async hit(
    key: string,
    ttlMs: number,
    limit: number,
    blockDurationMs: number,
  ): Promise<WindowCounterResult> {
    await this.connect();
    const reply = await this.command([
      'EVAL',
      HIT_SCRIPT,
      '2',
      this.hitKey(key),
      this.blockKey(key),
      String(ttlMs),
      String(limit),
      String(blockDurationMs),
    ]);
    const values = Array.isArray(reply) ? reply.map(Number) : [0, 0, 0, 0];
    return {
      totalHits: values[0] || 0,
      timeToExpireMs: Math.max(0, values[1] || 0),
      isBlocked: values[2] === 1,
      timeToBlockExpireMs: Math.max(0, values[3] || 0),
    };
  }

  async isBlocked(key: string): Promise<{ blocked: boolean; ttlMs: number }> {
    await this.connect();
    const ttl = Number(await this.command(['PTTL', this.blockKey(key)]));
    return { blocked: ttl > 0, ttlMs: Math.max(0, ttl) };
  }

  async reset(keys: string[]): Promise<void> {
    await this.connect();
    const redisKeys = keys.flatMap((key) => [this.hitKey(key), this.blockKey(key)]);
    if (redisKeys.length > 0) {
      await this.command(['DEL', ...redisKeys]);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  private async command(args: string[]): Promise<unknown> {
    if (!this.client) throw new Error('Redis client is not initialized');
    return this.client.sendCommand(args);
  }

  private hitKey(key: string): string {
    return `${this.namespace}:hits:${key}`;
  }

  private blockKey(key: string): string {
    return `${this.namespace}:block:${key}`;
  }
}

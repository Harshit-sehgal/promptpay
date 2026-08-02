import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

import { RedisWindowCounter } from './redis-window-counter';

type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

export const THROTTLER_STORAGE = 'THROTTLER_STORAGE';

/**
 * Global provider for the shared throttler storage instance. A `@Global()`
 * module is required because `ThrottlerModule.forRootAsync`'s `inject` list
 * resolves tokens in ThrottlerModule's own context — an AppModule-local
 * provider is invisible there. Global exports (like `ConfigModule`'s) resolve
 * everywhere, so the factory and any consumer share one instance, and Nest
 * runs its `onModuleDestroy` lifecycle hook (Redis disconnect) on shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: THROTTLER_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => RedisBackedThrottlerStorage.create(config),
    },
  ],
  exports: [THROTTLER_STORAGE],
})
export class ThrottlerStorageModule {}

export class RedisBackedThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly memory = new ThrottlerStorageService();

  constructor(
    private readonly counter: RedisWindowCounter | null,
    private readonly failClosed: boolean,
  ) {}

  static async create(config: ConfigService): Promise<ThrottlerStorage> {
    const redisUrl = config.get<string>('REDIS_URL');
    const failClosed = config.get<string>('NODE_ENV') === 'production';
    if (!redisUrl) {
      if (failClosed) {
        throw new Error('REDIS_URL is required in production for distributed rate limiting');
      }
      return new ThrottlerStorageService();
    }

    const storage = new RedisBackedThrottlerStorage(
      new RedisWindowCounter(redisUrl, 'wl:throttle'),
      failClosed,
    );

    try {
      await storage.connect();
    } catch (err) {
      if (failClosed) throw err;
      return new ThrottlerStorageService();
    }

    return storage;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    if (!this.counter) {
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    try {
      const result = await this.counter.hit(
        `${throttlerName}:${key}`,
        ttl,
        limit,
        blockDuration || ttl,
      );
      return {
        totalHits: result.totalHits,
        timeToExpire: Math.ceil(result.timeToExpireMs / 1000),
        isBlocked: result.isBlocked,
        timeToBlockExpire: Math.ceil(result.timeToBlockExpireMs / 1000),
      };
    } catch (err) {
      if (this.failClosed) throw err;
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  private async connect(): Promise<void> {
    await this.counter?.connect();
  }

  /** Release the Redis connection on shutdown (event-loop hang guard). */
  async onModuleDestroy(): Promise<void> {
    await this.counter?.disconnect();
  }
}

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

export interface RedisHealthResult {
  status: 'connected' | 'error' | 'not_configured';
  latencyMs?: number;
  error?: string;
}

/**
 * Lightweight Redis connectivity probe used by the health endpoint.
 *
 * It maintains a single shared connection (lazily connected on first use)
 * so repeated health checks don't open a new socket each time. The client
 * is health-check-only: connection errors are reported, never thrown, so a
 * Redis outage surfaces as a degraded health status rather than a 500.
 */
@Injectable()
export class RedisHealthService implements OnModuleDestroy {
  private client: RedisClientType | null = null;
  private connectPromise: Promise<RedisClientType> | null = null;
  private readonly redisUrl = process.env.REDIS_URL;

  get configured(): boolean {
    return Boolean(this.redisUrl);
  }

  private ensureClient(): Promise<RedisClientType> | null {
    if (!this.redisUrl) return null;
    if (this.client?.isReady) return Promise.resolve(this.client);
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      const client = createClient({ url: this.redisUrl });
      client.on('error', () => {
        // Health-only client: never surface raw Redis errors as exceptions.
      });
      await client.connect();
      this.client = client;
      return client;
    })();
    return this.connectPromise;
  }

  async check(): Promise<RedisHealthResult> {
    const ensure = this.ensureClient();
    if (!ensure) {
      return { status: 'not_configured' };
    }
    const start = Date.now();
    try {
      const client = await ensure;
      await client.ping();
      return { status: 'connected', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}

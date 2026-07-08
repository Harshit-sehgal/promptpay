import { createClient, RedisClientType } from 'redis';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

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

  /** Drop any current connection and clear the cached connect promise so the
   *  next check starts fresh. Called on connect failure or ping failure so a
   *  transient Redis outage cannot permanently latch the probe into the failed
   *  state (see A-053). */
  private async disposeClient(): Promise<void> {
    this.connectPromise = null;
    const client = this.client;
    this.client = null;
    if (client) {
      await client.quit().catch(() => undefined);
    }
  }

  private ensureClient(): Promise<RedisClientType> | null {
    if (!this.redisUrl) return null;
    if (this.client?.isReady) return Promise.resolve(this.client);
    // A previous connection is either absent or not ready (closed, or still
    // handshaking a dead socket). Drop it before attempting a fresh connect.
    void this.disposeClient();
    const connectPromise = (async () => {
      const client = createClient({ url: this.redisUrl });
      client.on('error', () => {
        // Health-only client: never surface raw Redis errors as exceptions.
      });
      await client.connect();
      this.client = client;
      return client;
    })();
    this.connectPromise = connectPromise;
    // On failure, clear the cached promise so a later check retries with a new
    // socket instead of awaiting the same rejected promise forever (A-053).
    connectPromise.catch(() => {
      this.connectPromise = null;
      this.client = null;
    });
    return connectPromise;
  }

  async check(): Promise<RedisHealthResult> {
    if (!this.redisUrl) {
      return { status: 'not_configured' };
    }
    const start = Date.now();
    try {
      const client = await this.ensureClient();
      if (!client?.isReady) {
        throw new Error('Redis client not ready');
      }
      await client.ping();
      return { status: 'connected', latencyMs: Date.now() - start };
    } catch (err) {
      // Any failure — connect rejection or ping error — tears down the client
      // so the next probe reconnects rather than reusing a dead connection.
      await this.disposeClient();
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disposeClient();
  }
}

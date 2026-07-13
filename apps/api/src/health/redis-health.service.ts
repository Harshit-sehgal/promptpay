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
  private static readonly PROBE_TIMEOUT_MS = 2_000;
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
    // Coalesce concurrent readiness/liveness probes onto one connection
    // attempt. Without this guard each probe creates a new Redis client while
    // the first socket is still handshaking, then only the last client remains
    // reachable for shutdown (the other sockets leak).
    if (this.connectPromise) return this.connectPromise;
    // A previous connection is either absent or not ready (closed, or still
    // handshaking a dead socket). Drop it before attempting a fresh connect.
    const staleClient = this.client;
    this.client = null;
    if (staleClient) void staleClient.quit().catch(() => undefined);
    const connectPromise = (async () => {
      const client = createClient({
        url: this.redisUrl,
        socket: { connectTimeout: RedisHealthService.PROBE_TIMEOUT_MS },
      });
      client.on('error', () => {
        // Health-only client: never surface raw Redis errors as exceptions.
      });
      try {
        await client.connect();
        this.client = client;
        return client;
      } catch (error) {
        await client.quit().catch(() => undefined);
        throw error;
      }
    })();
    this.connectPromise = connectPromise;
    // On failure, clear the cached promise so a later check retries with a new
    // socket instead of awaiting the same rejected promise forever (A-053).
    void connectPromise.then(
      () => {
        if (this.connectPromise === connectPromise) this.connectPromise = null;
      },
      () => {
        if (this.connectPromise === connectPromise) this.connectPromise = null;
        this.client = null;
      },
    );
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
      let probeTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          client.ping(),
          new Promise<never>((_resolve, reject) => {
            probeTimeout = setTimeout(
              () => reject(new Error('Redis health probe timed out')),
              RedisHealthService.PROBE_TIMEOUT_MS,
            );
            probeTimeout.unref();
          }),
        ]);
      } finally {
        if (probeTimeout) clearTimeout(probeTimeout);
      }
      return { status: 'connected', latencyMs: Date.now() - start };
    } catch {
      // Any failure — connect rejection or ping error — tears down the client
      // so the next probe reconnects rather than reusing a dead connection.
      await this.disposeClient();
      return {
        status: 'error',
        // Health endpoints are public infrastructure surfaces. Do not expose
        // socket details (hostnames, ports, TLS errors) to unauthenticated
        // callers; operators get the dependency name and request correlation
        // from server-side logs/telemetry instead.
        error: 'Redis unreachable',
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disposeClient();
  }
}

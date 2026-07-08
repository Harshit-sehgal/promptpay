import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@waitlayer/db';

/**
 * Ensure the Prisma connection string carries an explicit pool configuration.
 * Without these, Prisma defaults to a connection_limit derived from the
 * available parallelism and an unbounded pool_timeout — under burst load that
 * can exhaust Postgres connections or hang requests indefinitely waiting for
 * a free connection. We set conservative, overridable defaults and only fill
 * params the operator hasn't already specified.
 */
function withPoolParams(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    const defaults: Record<string, string> = {
      connection_limit: '10',
      pool_timeout: '10',
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (!u.searchParams.has(key)) u.searchParams.set(key, value);
    }
    return u.toString();
  } catch {
    // Not a parseable URL (e.g. a Prisma env placeholder) — leave as-is.
    return url;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: withPoolParams(process.env.DATABASE_URL ?? '') },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

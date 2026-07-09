import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { createPrismaAdapter, PrismaClient } from '@waitlayer/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma 7 requires a driver adapter instead of the old
    // `datasources: { db: { url } }` option. Pool limits are handled inside
    // `createPrismaAdapter` (mapped onto pg Pool options).
    super({
      adapter: createPrismaAdapter(process.env.DATABASE_URL ?? ''),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

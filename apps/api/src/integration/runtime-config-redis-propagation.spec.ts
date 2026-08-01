import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

import {
  RUNTIME_CONFIG_KEYS,
  RuntimeConfigService,
} from '../runtime-config/runtime-config.service';

const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)('RuntimeConfigService Redis propagation', () => {
  const settings = new Map<string, { enabled: boolean }>();
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { scope_target: { scope: string; target: string } } }) => {
          const { scope, target } = where.scope_target;
          const value = settings.get(`${scope}:${target}`);
          return value ? { value } : null;
        },
      ),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const scope = String(create.scope);
          const target = String(create.target);
          const value = (update.value ?? create.value) as { enabled: boolean };
          settings.set(`${scope}:${target}`, value);
          return { id: `${scope}:${target}`, scope, target, value };
        },
      ),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: string) => (key === 'REDIS_URL' ? redisUrl : undefined)),
  } as unknown as ConfigService;

  let writer: RuntimeConfigService;
  let reader: RuntimeConfigService;

  beforeAll(async () => {
    writer = new RuntimeConfigService(prisma as never, audit as never, config);
    reader = new RuntimeConfigService(prisma as never, audit as never, config);
    await writer.onModuleInit();
    await reader.onModuleInit();
  });

  afterAll(async () => {
    await Promise.all([writer?.onModuleDestroy(), reader?.onModuleDestroy()]);
  });

  it('invalidates a cached kill switch in another API replica', async () => {
    settings.set('ads:global', { enabled: false });
    await expect(reader.isAdsEnabled()).resolves.toBe(false);

    await writer.setBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, true, 'admin-redis-test', 'test');

    await vi.waitFor(
      async () => {
        await expect(reader.isAdsEnabled()).resolves.toBe(true);
      },
      { timeout: 2_000, interval: 25 },
    );
  });
});

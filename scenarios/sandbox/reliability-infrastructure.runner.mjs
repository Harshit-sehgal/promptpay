#!/usr/bin/env node
const mode = process.argv[2];

function event(eventType, metadata = {}) {
  return { eventId: `scenario-${mode}-${eventType}`, eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata };
}

const { RuntimeConfigService } = await import('../../apps/api/dist/apps/api/src/runtime-config/runtime-config.service.js');

if (mode === 'redis-offline') {
  const service = new RuntimeConfigService(
    { systemSetting: { findUnique: async () => ({ value: { enabled: false } }) } },
    { log: async () => undefined },
    { get: (key, fallback) => (key === 'REDIS_URL' ? 'redis://127.0.0.1:6399' : key === 'REDIS_CONNECT_TIMEOUT_MS' ? 100 : fallback) },
  );
  // Keep the fixture's stdout machine-readable; the service's warning is
  // asserted by successful completion and is intentionally not emitted as a
  // scenario event.
  service.logger = { warn: () => undefined };
  await Promise.race([
    service.onModuleInit(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('redis boundary timed out')), 2000)),
  ]);
  await service.onModuleDestroy();
  process.stdout.write(`${JSON.stringify([event('reliability.redis_offline', { cacheFallback: true })])}\n`);
} else if (mode === 'database-timeout') {
  const service = new RuntimeConfigService(
    { systemSetting: { findUnique: async () => { throw new Error('database timeout'); } } },
    { log: async () => undefined },
    { get: (_key, fallback) => fallback },
  );
  try {
    await service.isAdsEnabled();
  } catch (error) {
    if (!String(error?.message ?? error).includes('database timeout')) throw error;
    process.stdout.write(`${JSON.stringify([event('reliability.database_timeout', { requestFailed: true })])}\n`);
  }
} else throw new Error(`unknown infrastructure mode: ${mode}`);

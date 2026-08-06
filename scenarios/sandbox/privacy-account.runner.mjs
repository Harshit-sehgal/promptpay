import { createRequire } from 'node:module';

const requireApiDependency = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const bcrypt = requireApiDependency('bcryptjs');

import { AdvertiserService } from '../../apps/api/dist/apps/api/src/advertiser/advertiser.service.js';

const mode = process.argv[2];
const userId = 'scenario-privacy-user';

function event(eventType, metadata) {
  return {
    eventId: `scenario-${mode}-${eventType}`,
    eventType,
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
    metadata,
  };
}

function makeAudit(calls = []) {
  return {
    log: async () => undefined,
    logStrict: async () => calls.push('strict'),
  };
}

async function runExport() {
  const prisma = {
    advertiser: { findUnique: async () => ({ id: 'scenario-advertiser', userId }) },
    user: {
      findUnique: async () => ({ id: userId, email: 'redacted@example.test', role: 'advertiser' }),
    },
    campaign: {
      findMany: async () => Array.from({ length: 1001 }, (_, index) => ({ id: `campaign-${index}` })),
    },
    adCreative: { findMany: async () => [{ id: 'creative-1' }] },
    advertiserLedger: {
      findMany: async () => Array.from({ length: 10001 }, (_, index) => ({ id: `ledger-${index}` })),
    },
    consent: { findMany: async () => Array.from({ length: 1001 }, (_, index) => ({ id: `consent-${index}` })) },
  };
  const service = new AdvertiserService(prisma, {}, makeAudit(), {}, {});
  const exported = await service.exportData(userId);
  if (!exported.exportMeta?.truncated || exported.exportMeta.complete !== false)
    throw new Error('export did not expose truncation metadata');
  if (exported.campaigns.length !== 1000 || exported.billingLedger.length !== 10000)
    throw new Error('export limits were not enforced');
  if (JSON.stringify(exported).includes('prompt') || JSON.stringify(exported).includes('sourceCode'))
    throw new Error('export included forbidden private fields');
  process.stdout.write(`${JSON.stringify([event('privacy.export.completed', {
    truncated: true,
    campaignCount: exported.campaigns.length,
    billingLedgerCount: exported.billingLedger.length,
  })])}\n`);
}

async function runDeletion() {
  const passwordHash = await bcrypt.hash('scenario-password', 4);
  const user = {
    id: userId,
    email: 'advertiser@example.test',
    status: 'active',
    passwordHash,
    googleId: null,
  };
  const prisma = {
    user: {
      findUnique: async () => user,
      update: async ({ data }) => ({ ...user, ...data }),
    },
    advertiser: {
      findUnique: async () => ({ id: 'scenario-advertiser' }),
      update: async () => ({ id: 'scenario-advertiser' }),
    },
    earningsLedger: {
      aggregate: async () => ({ _sum: { amountMinor: 0n } }),
      findFirst: async () => null,
    },
    recoveryDebtCase: { findFirst: async () => null },
    payoutRequest: { findFirst: async () => null },
    advertiserLedger: {
      groupBy: async () => [],
      findFirst: async () => null,
    },
    campaign: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
    deviceRecoveryToken: { updateMany: async () => ({ count: 0 }) },
    session: { updateMany: async () => ({ count: 0 }) },
    apiKey: { updateMany: async () => ({ count: 0 }) },
    payoutAccount: { updateMany: async () => ({ count: 0 }) },
    userSettings: { updateMany: async () => ({ count: 0 }) },
    waitStateEvent: { updateMany: async () => ({ count: 0 }) },
    adImpression: { updateMany: async () => ({ count: 0 }) },
    adClick: { updateMany: async () => ({ count: 0 }) },
    auditLog: { updateMany: async () => ({ count: 0 }) },
    $executeRaw: async () => 1,
    $transaction: async (callback) => callback(prisma),
  };
  const auditCalls = [];
  const audit = makeAudit(auditCalls);
  const service = new AdvertiserService(prisma, {}, audit, {}, {});
  const result = await service.deleteAccount(userId, { currentPassword: 'scenario-password' });
  if (!result.deleted || auditCalls.length !== 1)
    throw new Error('account deletion did not complete through the strict audit path');
  process.stdout.write(`${JSON.stringify([event('privacy.deletion.completed', {
    identityErased: true,
    financialRecordsRetained: true,
  })])}\n`);
}

if (mode === 'export') await runExport();
else if (mode === 'delete') await runDeletion();
else throw new Error(`unknown privacy account mode: ${mode}`);

#!/usr/bin/env node
const mode = process.argv[2];

function event(eventType, metadata = {}) {
  return { eventId: `scenario-${mode}-${eventType}`, eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata };
}

const { LedgerService } = await import('../../apps/api/dist/apps/api/src/ledger/ledger.service.js');
const service = Object.create(LedgerService.prototype);

if (mode === 'split-cpm' || mode === 'split-cpc') {
  const amount = mode === 'split-cpm' ? 1000n : 500n;
  const split = service.calculateSplit(amount, false);
  if (split.userShare + split.platformShare + split.reserveShare !== amount)
    throw new Error('revenue split did not conserve the bid amount');
  process.stdout.write(`${JSON.stringify([event(mode === 'split-cpm' ? 'finance.cpm_split' : 'finance.cpc_split', { userShare: split.userShare.toString(), platformShare: split.platformShare.toString(), reserveShare: split.reserveShare.toString() })])}\n`);
} else if (mode === 'hold') {
  const normal = service.getHoldDays('normal');
  const unverified = service.getHoldDays('normal', true);
  if (normal !== 14 || unverified !== 60) throw new Error('earning hold policy was not extended for unverified source');
  process.stdout.write(`${JSON.stringify([event('finance.earning_hold', { normalDays: normal, unverifiedDays: unverified })])}\n`);
} else if (mode === 'release') {
  let query;
  service.prisma = { earningsLedger: { updateMany: async (args) => { query = args; return { count: 2 }; } } };
  const result = await service.releaseEarnings('scenario-user', { flagId: 'scenario-flag' });
  if (result.count !== 2 || query.where.heldByFlagId !== 'scenario-flag' || query.data.status !== 'confirmed')
    throw new Error('flag-scoped earning release was not applied');
  process.stdout.write(`${JSON.stringify([event('finance.hold_released', { count: result.count })])}\n`);
} else if (mode === 'reversal') {
  const writes = [];
  const tx = {
    advertiserLedger: {
      findUnique: async () => ({ advertiserId: 'scenario-advertiser', campaignId: 'scenario-campaign', amountMinor: 100n, currency: 'XTS', idempotencyKey: 'imp-scenario-impression-adv' }),
      upsert: async (args) => { writes.push(args); return args.create; },
    },
    platformLedger: {
      findUnique: async ({ where }) => ({ campaignId: 'scenario-campaign', amountMinor: where.idempotencyKey.includes('-res') ? 10n : 30n, currency: 'XTS', idempotencyKey: where.idempotencyKey }),
      upsert: async (args) => { writes.push(args); return args.create; },
    },
    earningsLedger: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [],
      upsert: async (args) => { writes.push(args); return args.create; },
    },
  };
  service.prisma = { $transaction: async (callback) => callback(tx) };
  service.audit = { log: async () => undefined, logStrict: async () => undefined };
  const result = await service.reverseEarnings({ impressionId: 'scenario-impression' }, 'scenario reversal');
  if (result.reversed !== 1 || writes.length !== 3) throw new Error('reversal did not write developer, advertiser, and platform compensation');
  process.stdout.write(`${JSON.stringify([event('finance.reversed', { reversed: result.reversed, compensationRows: writes.length })])}\n`);
} else throw new Error(`unknown ledger boundary mode: ${mode}`);

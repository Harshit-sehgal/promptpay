#!/usr/bin/env node
const { ReferralService } = await import('../../apps/api/dist/apps/api/src/referral/referral.service.js');
const users = new Map([
  ['A-CODE', { id: 'user-a', email: 'a@example.test', status: 'active', referralCode: 'A-CODE' }],
  ['B-CODE', { id: 'user-b', email: 'b@example.test', status: 'active', referralCode: 'B-CODE' }],
]);
const referrals = [];
const service = new ReferralService({
  user: { findUnique: async ({ where }) => users.get(where.referralCode) ?? null },
  referral: {
    findFirst: async ({ where }) => referrals.find((r) => r.referredId === where.referredId) ?? null,
    create: async ({ data }) => { const row = { id: `ref-${referrals.length + 1}`, ...data }; referrals.push(row); return row; },
  },
}, { audit: { log: async () => undefined } }, { get: () => 'http://localhost:3000' });

await service.applyReferralCode('user-b', 'A-CODE');
let rejected = false;
try { await service.applyReferralCode('user-a', 'B-CODE'); } catch (error) { rejected = /loop/i.test(String(error?.message)); }
if (!rejected || referrals.length !== 1) throw new Error('reciprocal referral loop was not rejected');
process.stdout.write(`${JSON.stringify([{ eventId: 'scenario-referral-loop', eventType: 'adversarial.referral_loop', mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata: { rejected: true, referralsCreated: 1 } }])}\n`);

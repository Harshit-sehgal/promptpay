#!/usr/bin/env node
const mode = process.argv[2];
const userId = 'scenario-finance-user';

function event(eventType, metadata = {}) {
  return { eventId: `scenario-${mode}-${eventType}`, eventType, mode: 'sandbox', financialMode: 'sandbox', hasCashValue: false, metadata };
}

const { ExtensionAdTrait } = await import('../../apps/api/dist/apps/api/src/extension/extension-ad.trait.js');
const trait = new ExtensionAdTrait();
const impression = {
  id: 'scenario-impression',
  userId,
  deviceId: '00000000-0000-4000-8000-000000000121',
  sessionId: 'scenario-session',
  waitStateId: 'scenario-wait',
  impressionTokenHash: 'scenario-hash',
  impressionToken: 'sandbox-token',
  renderedAt: new Date('2026-08-06T00:00:00.000Z'),
  campaignId: 'scenario-campaign',
  creativeId: 'scenario-creative',
  qualifiedAt: null,
  campaign: { id: 'scenario-campaign', bidAmountMinor: 100n, currency: 'XTS', advertiserId: 'scenario-advertiser', bidType: 'cpc' },
  user: { status: 'active' },
};
const prisma = {
  adImpression: { findUnique: async () => impression },
  adClick: { findUnique: async () => ({ id: 'scenario-click', userId, impressionId: impression.id }) },
};
Object.assign(trait, {
  prisma,
  enforcePrivacyOn: () => undefined,
  verifyDeviceSignature: async () => true,
});

if (mode === 'duplicate-impression') {
  const result = await trait.recordRendered(userId, { impressionToken: impression.impressionToken, renderedAt: '2026-08-06T00:00:01.000Z', visibleSurface: 1, idempotencyKey: 'render-duplicate', signature: 'signature' });
  if (result !== impression || !result.renderedAt) throw new Error('duplicate render did not replay the existing impression');
  process.stdout.write(`${JSON.stringify([event('finance.duplicate_impression', { idempotent: true })])}\n`);
} else if (mode === 'duplicate-click') {
  const result = await trait.recordClick(userId, { impressionToken: impression.impressionToken, clickedAt: '2026-08-06T00:00:02.000Z', idempotencyKey: 'click-duplicate', signature: 'signature' });
  if (!result.clicked || !result.isDuplicate) throw new Error('duplicate click was not acknowledged idempotently');
  process.stdout.write(`${JSON.stringify([event('finance.duplicate_click', { idempotent: true })])}\n`);
} else throw new Error(`unknown finance duplicate mode: ${mode}`);

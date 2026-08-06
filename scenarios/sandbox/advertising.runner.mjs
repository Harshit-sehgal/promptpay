#!/usr/bin/env node
import { ExtensionAdTrait } from '../../apps/api/dist/apps/api/src/extension/extension-ad.trait.js';

const mode = process.argv[2];
const userId = 'scenario-ad-user';
const deviceId = '00000000-0000-4000-8000-000000000101';
const request = {
  deviceId,
  sessionId: 'scenario-ad-session',
  waitStateId: 'scenario-ad-wait',
  toolType: 'cli',
  idempotencyKey: 'scenario-ad-request',
  signature: 'scenario-signature',
};
const waitStart = {
  id: 'scenario-wait-start',
  createdAt: new Date('2026-08-06T00:00:00.000Z'),
  confidence: 0.9,
  isFalsePositive: false,
  detectorVersion: '1.0.0',
  signals: [{ type: 'ai_generation' }, { type: 'active_task' }],
  evidence: [],
};
const creative = {
  id: 'scenario-creative',
  title: 'Sandbox test ad',
  sponsoredMessage: 'Test credits only',
  displayDomain: 'sandbox.waitlayer.test',
  destinationUrl: 'https://sandbox.waitlayer.test/ad',
  ctaText: 'Learn more',
};

function event(eventType, metadata = {}) {
  return {
    eventId: `scenario-${mode}-${eventType}`,
    eventType,
    mode: 'sandbox',
    financialMode: 'sandbox',
    hasCashValue: false,
    metadata,
  };
}

function placement(category = 'general', overrides = {}) {
  return {
    bidAmountMinor: 25n,
    minAttentionScore: null,
    minIntegrationScore: null,
    frequencyCapPerHour: null,
    frequencyCapPerDay: null,
    campaign: {
      id: 'scenario-campaign',
      currency: 'XTS',
      category,
      creatives: [creative],
      ...overrides,
    },
  };
}

function makeTrait({ settings = {}, countryAllowed = true, exposureCount = 0, platformAdsEnabled = true } = {}) {
  const opportunity = {
    findFirst: async () => ({ id: 'scenario-opportunity', attentionConfidence: 0.9, integrationConfidence: 0.9 }),
    findMany: async () => [],
    count: async () => exposureCount,
    updateMany: async () => ({ count: 1 }),
  };
  const campaignPlacement = {
    findMany: async (args = {}) => {
      const blocked = args.where?.campaign?.category?.notIn ?? [];
      return blocked.includes('finance') ? [] : [placement()];
    },
  };
  const adCreative = { findUnique: async () => creative };
  const tx = { adOpportunity: opportunity, adCreative, campaignPlacement };
  const trait = new ExtensionAdTrait();
  Object.assign(trait, {
    prisma: {
      userSettings: { findUnique: async () => ({ waitTelemetryEnabled: true, adsEnabled: true, ...settings }) },
      device: { findUnique: async () => ({ id: deviceId, userId, user: { status: 'active' } }) },
      waitStateEvent: { findFirst: async ({ where }) => (where?.eventType === 'wait_state_end' ? null : waitStart) },
      user: { findUnique: async () => ({ country: 'US' }) },
      agentSession: { findUnique: async () => ({ id: 'scenario-db-session', userId, deviceId }) },
      adImpression: { findFirst: async () => null },
      adOpportunity: opportunity,
      adCreative,
      campaignPlacement,
      $transaction: async (callback) => callback(tx),
    },
    runtimeConfig: {
      getWaitLaunchMode: async () => 'sandbox',
      getEnvironmentKind: () => 'sandbox',
      isDetectorVersionEnabled: async () => true,
      isAdsEnabled: async () => platformAdsEnabled,
      getVerifiedDetectorVersions: () => '1.0.0',
      isCountryAllowed: async () => countryAllowed,
    },
    compliance: { isConsented: async () => false },
    audit: { log: async () => undefined },
    metrics: { increment: () => undefined },
    logger: { warn: () => undefined },
    enforcePrivacyOn: () => undefined,
    verifyDeviceSignature: async () => true,
  });
  return { trait, opportunity, campaignPlacement };
}

async function run() {
  if (mode === 'foreground') {
    const { trait } = makeTrait();
    const result = await trait.requestAd(userId, request);
    if (!result.ad || result.mode !== 'sandbox' || result.hasCashValue !== false)
      throw new Error('foreground sandbox opportunity was not served safely');
    process.stdout.write(`${JSON.stringify([event('opportunity.foreground', { served: true })])}\n`);
    return;
  }
  if (mode === 'completion-return') {
    const { trait } = makeTrait();
    const result = await trait.requestSandboxPlacement(userId, {
      deviceId,
      correlationId: 'scenario-provider-correlation',
      placementType: 'completion_return',
      idempotencyKey: 'scenario-completion-request',
      signature: 'scenario-signature',
    });
    if (!result.ad || result.mode !== 'sandbox' || result.hasCashValue !== false)
      throw new Error('completion-return opportunity was not served safely');
    process.stdout.write(`${JSON.stringify([event('opportunity.completion_return', { served: true })])}\n`);
    return;
  }
  if (mode === 'repeated-return') {
    const { trait, opportunity, campaignPlacement } = makeTrait();
    let claimed = false;
    let token;
    opportunity.findFirst = async (args) => {
      if (args.where?.claimIdempotencyKey && !claimed) return null;
      if (args.where?.state === 'candidate') return claimed ? null : { id: 'scenario-opportunity', attentionConfidence: 0.9, integrationConfidence: 0.9 };
      return claimed ? { id: 'scenario-opportunity', selectedCampaignId: 'scenario-campaign', selectedCreativeId: creative.id, sandboxImpressionToken: token } : null;
    };
    opportunity.updateMany = async (args) => {
      claimed = true;
      token = args.data.sandboxImpressionToken;
      return { count: 1 };
    };
    const first = await trait.requestAd(userId, request);
    const replay = await trait.requestAd(userId, request);
    if (!first.ad?.impressionToken || replay.ad?.impressionToken !== first.ad.impressionToken)
      throw new Error('repeated return did not replay the same opportunity');
    if (campaignPlacement.findMany !== undefined && !claimed) throw new Error('opportunity was not claimed');
    process.stdout.write(`${JSON.stringify([event('opportunity.replayed', { sameToken: true })])}\n`);
    return;
  }
  if (mode === 'expiry') {
    const { trait, opportunity } = makeTrait();
    opportunity.findFirst = async () => null;
    const result = await trait.requestAd(userId, request);
    if (result.reason !== 'no_sandbox_placement' || result.hasCashValue !== false)
      throw new Error('expired opportunity was not suppressed');
    process.stdout.write(`${JSON.stringify([event('opportunity.expired', { served: false })])}\n`);
    return;
  }
  if (mode === 'category-block') {
    const { trait, campaignPlacement } = makeTrait({ settings: { blockedCategories: ['finance'] } });
    campaignPlacement.findMany = async (args = {}) =>
      args.where?.campaign?.category?.notIn?.includes('finance') ? [] : [placement('finance')];
    const result = await trait.requestAd(userId, request);
    if (result.reason !== 'no_sandbox_placement' || result.ad)
      throw new Error('blocked category was served');
    process.stdout.write(`${JSON.stringify([event('opportunity.category_blocked', { served: false })])}\n`);
    return;
  }
  if (mode === 'country-block') {
    const { trait } = makeTrait({ countryAllowed: false });
    const result = await trait.requestAd(userId, request);
    if (result.reason !== 'country_blocked' || result.ad)
      throw new Error('blocked country was served');
    process.stdout.write(`${JSON.stringify([event('opportunity.country_blocked', { served: false })])}\n`);
    return;
  }
  if (mode === 'frequency-cap') {
    const { trait } = makeTrait({ settings: { maxAdsPerHour: 6 }, exposureCount: 6 });
    const result = await trait.requestAd(userId, request);
    if (result.reason !== 'no_sandbox_placement' || result.ad)
      throw new Error('frequency cap did not suppress placement');
    process.stdout.write(`${JSON.stringify([event('opportunity.frequency_capped', { served: false })])}\n`);
    return;
  }
  if (mode === 'kill-switch') {
    const { trait } = makeTrait({ platformAdsEnabled: false });
    const result = await trait.requestAd(userId, request);
    if (result.reason !== 'platform_ads_paused' || result.ad)
      throw new Error('active opportunity bypassed the platform ad kill switch');
    process.stdout.write(`${JSON.stringify([event('opportunity.kill_switch', { served: false })])}\n`);
    return;
  }
  if (mode === 'consent-before-render') {
    try {
      await makeTrait({ settings: { waitTelemetryEnabled: false, adsEnabled: true } }).trait.requestAd(userId, request);
    } catch (error) {
      const response = error?.getResponse?.();
      if (response === 'wait_telemetry_consent_required' || response?.message === 'wait_telemetry_consent_required') {
        process.stdout.write(`${JSON.stringify([event('opportunity.consent_revoked_before_render', { served: false })])}\n`);
        return;
      }
      throw error;
    }
    throw new Error('revoked consent reached ad rendering');
  }
  throw new Error(`unknown advertising mode: ${mode}`);
}

await run();

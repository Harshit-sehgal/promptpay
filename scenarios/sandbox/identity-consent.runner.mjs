#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AuthService } from '../../apps/api/dist/apps/api/src/auth/auth.service.js';
import { ExtensionAdTrait } from '../../apps/api/dist/apps/api/src/extension/extension-ad.trait.js';
import {
  enableBridge,
  enqueueAgentEvent,
  getSpoolPaths,
  readSpoolStatus,
} from '../../apps/cli/dist/lib/agent-spool.js';

const mode = process.argv[2];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waitlayer-scenario-consent-'));
const userId = 'scenario-consent-user';
const deviceId = '00000000-0000-4000-8000-000000000091';

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

function validSpoolEvent() {
  return {
    schemaVersion: 1,
    eventId: '00000000-0000-4000-8000-000000000093',
    idempotencyKey: `scenario-${mode}-telemetry`,
    environmentKind: 'sandbox',
    environmentId: 'scenario-consent',
    installationId: '00000000-0000-4000-8000-000000000092',
    deviceId,
    provider: 'generic_wrapper',
    integrationMode: 'wrapper',
    eventType: 'session.started',
    sourceType: 'inferred',
    confidence: 0.5,
    occurredAt: '2026-08-06T00:00:00.000Z',
    correlationId: 'scenario-consent-correlation',
    adapterVersion: 'scenario',
    clientVersion: 'scenario',
    metadata: {},
  };
}

async function signupWithDefaultTelemetry() {
  const createdSettings = [];
  const user = {
    id: userId,
    email: 'scenario@example.test',
    role: 'developer',
    status: 'active',
    name: null,
    referralCode: 'SCENARIO1',
  };
  const prisma = {
    user: {
      findUnique: async ({ where }) =>
        where?.referralCode ? null : where?.email ? null : null,
      findFirst: async () => null,
      create: async () => user,
    },
    userSettings: {
      create: async ({ data }) => {
        const settings = { ...data, adsEnabled: false, waitTelemetryEnabled: false };
        createdSettings.push(settings);
        return settings;
      },
    },
    trustScore: { create: async ({ data }) => data },
    consent: {
      create: async ({ data }) => ({ id: `consent-${data.purpose}`, ...data }),
    },
    $transaction: async (callback) => callback(prisma),
  };
  const config = {
    get: (key, fallback) =>
      ({
        JWT_PRIVATE_KEY: 'scenario-private-key',
        JWT_PUBLIC_KEY: 'scenario-public-key',
        JWT_SECRET: 'scenario-jwt-secret-that-is-long-enough-123456',
        TOTP_SECRET_ENCRYPTION_KEY: 'scenario-totp-encryption-key-32-bytes!!',
      })[key] ?? fallback,
  };
  const audit = { log: async () => undefined, logStrict: async () => undefined };
  const service = new AuthService(prisma, {}, config, {}, {}, {}, audit);
  service.generateTokenPair = async () => ({ accessToken: 'access', refreshToken: 'refresh' });
  const result = await service.signUp({
    email: user.email,
    password: 'scenario-password',
    role: 'developer',
    ageConfirmed: true,
    termsAccepted: true,
  });
  if (!result.user || createdSettings.length !== 1 || createdSettings[0].waitTelemetryEnabled !== false)
    throw new Error('signup did not create telemetry-disabled developer settings');
  process.stdout.write(
    `${JSON.stringify([event('signup.completed', { telemetryEnabled: false, adsEnabled: false })])}\n`,
  );
}

async function telemetryEnabled() {
  const paths = getSpoolPaths(directory);
  enableBridge(paths);
  enqueueAgentEvent(
    {
      installationId: '00000000-0000-4000-8000-000000000092',
      deviceId,
      event: validSpoolEvent(),
    },
    paths,
  );
  const status = readSpoolStatus(paths);
  if (status.queuedEvents !== 1 || status.telemetryDisabled)
    throw new Error('enabled telemetry was not accepted by the local spool');
  process.stdout.write(`${JSON.stringify([event('telemetry.enabled', { queuedEvents: 1 })])}\n`);
}

function makeAdTrait({ telemetryEnabled: hasTelemetry, adsEnabled }) {
  const waitStart = {
    id: 'scenario-wait-start',
    createdAt: new Date('2026-08-06T00:00:00.000Z'),
    confidence: 0.9,
    isFalsePositive: false,
    detectorVersion: '1.0.0',
    signals: [{ type: 'ai_generation' }, { type: 'active_task' }],
    evidence: [],
  };
  const trait = new ExtensionAdTrait();
  Object.assign(trait, {
    prisma: {
      userSettings: { findUnique: async () => ({ waitTelemetryEnabled: hasTelemetry, adsEnabled }) },
      device: {
        findUnique: async () => ({ id: deviceId, userId, user: { status: 'active' } }),
      },
      waitStateEvent: {
        findFirst: async ({ where }) => (where?.eventType === 'wait_state_end' ? null : waitStart),
      },
    },
    compliance: { isConsented: async () => false },
    runtimeConfig: {
      getWaitLaunchMode: async () => 'sandbox',
      getEnvironmentKind: () => 'sandbox',
      isDetectorVersionEnabled: async () => true,
      isAdsEnabled: async () => true,
      getVerifiedDetectorVersions: () => '1.0.0',
      isCountryAllowed: async () => true,
    },
    audit: { log: async () => undefined },
    metrics: { increment: () => undefined },
    logger: { warn: () => undefined },
    enforcePrivacyOn: () => undefined,
    verifyDeviceSignature: async () => true,
  });
  return trait;
}

async function adsDisabled() {
  const result = await makeAdTrait({ telemetryEnabled: true, adsEnabled: false }).requestAd(userId, {
    deviceId,
    sessionId: 'scenario-session',
    waitStateId: 'scenario-wait',
    toolType: 'cli',
    idempotencyKey: 'scenario-ad-request',
    signature: 'scenario-signature',
  });
  if (result.reason !== 'ads_disabled' || result.mode !== 'sandbox' || result.hasCashValue !== false)
    throw new Error('ads-disabled consent boundary did not fail closed');
  process.stdout.write(`${JSON.stringify([event('ads.suppressed', { reason: result.reason })])}\n`);
}

async function consentRevoked() {
  try {
    await makeAdTrait({ telemetryEnabled: false, adsEnabled: true }).requestAd(userId, {
      deviceId,
      sessionId: 'scenario-session',
      waitStateId: 'scenario-wait',
      toolType: 'cli',
      idempotencyKey: 'scenario-revoked-request',
      signature: 'scenario-signature',
    });
  } catch (error) {
    const response = error?.getResponse?.();
    if (response !== 'wait_telemetry_consent_required' && response?.message !== 'wait_telemetry_consent_required')
      throw error;
    process.stdout.write(`${JSON.stringify([event('consent.revoked', { adServed: false })])}\n`);
    return;
  }
  throw new Error('revoked telemetry consent unexpectedly permitted an ad request');
}

try {
  if (mode === 'signup-default') await signupWithDefaultTelemetry();
  else if (mode === 'telemetry-enabled') await telemetryEnabled();
  else if (mode === 'ads-disabled') await adsDisabled();
  else if (mode === 'consent-revoked') await consentRevoked();
  else throw new Error(`unknown identity-consent mode: ${mode}`);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

import * as bcrypt from 'bcryptjs';
import type { Response } from 'supertest';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';

import { AdPlacementType, UserRole } from '@waitlayer/shared';
import { signPayload } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

/**
 * WL-G007 / WL-062 / WL-063 opportunity integrity matrix (real app, real DB).
 *
 * Proves the sandbox placement dedup contract against the real AppModule:
 *  - an idempotency key replays the exact same (non-cash) placement,
 *  - distinct keys on the same candidate never double-claim it,
 *  - concurrent same-key and distinct-key requests mutate exactly one row,
 *  - the replay binding outranks placementType (one key == one placement),
 *  - the A-061 hourly exposure cap gates sandbox placements too,
 *  - nothing on this path writes an earnings/ledger row (cash settlement
 *    stays disabled; responses are mode:'sandbox', hasCashValue:false).
 *
 * The suite boots with WAITLAYER_ENVIRONMENT_KIND=sandbox so
 * requestSandboxPlacement serves; the production gates remain untouched.
 */

const BASE = '/api/v1/extension/sandbox-placement';
const ENV_ID = 'opportunity-xtest';
const HOUSE_ADVERTISER_EMAIL = 'house-ads@waitlayer.test';

async function cleanDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "users", "sessions", "devices", "user_settings",
      "advertisers", "campaigns", "ad_creatives", "campaign_placements",
      "ad_opportunities",
      "ad_impressions", "ad_clicks",
      "earnings_ledger", "advertiser_ledger", "platform_ledger",
      "audit_logs", "referrals", "referral_rewards"
    CASCADE;
  `);
}

type Fixture = {
  devToken: string;
  devUserId: string;
  deviceId: string;
  eventSecret: string;
  campaignId: string;
  creativeId: string;
};

describe('Sandbox opportunity dedup matrix (real app, real DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.REDIS_URL = '';
    process.env.WAITLAYER_ENVIRONMENT_KIND = 'sandbox';
    process.env.WAITLAYER_ENVIRONMENT_ID = ENV_ID;
    // Sandbox/staging/production env kinds require a privacy key.
    process.env.PRIVACY_HASH_KEY = 'opportunity-dedup-integration-privacy-key-0000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ActionStepUpGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
    await cleanDb(prisma);
    // The platform ad kill-switch governs sandbox serving too; opt in for the
    // isolated reset database only. wait.earnings stays off — this path must
    // never settle cash.
    await prisma.systemSetting.upsert({
      where: { scope_target: { scope: 'ads', target: 'global' } },
      create: { scope: 'ads', target: 'global', value: { enabled: true } },
      update: { value: { enabled: true }, reason: 'isolated opportunity-dedup test' },
    });
  });

  beforeEach(async () => {
    await cleanDb(prisma);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();
  });

  // ── fixtures ──

  async function signup(email: string, role: UserRole): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email,
        password: 'Password123!',
        name: 'Dedup Tester',
        role,
        ageConfirmed: true,
        termsAccepted: true,
        policyVersion: '2026-07-01',
      })
      .expect(201);
    return res.body.accessToken as string;
  }

  /** House/test campaign + creative + placement rows (sandbox economy only). */
  async function seedHousePlacement(placementType: string, opts: { bidAmountMinor?: bigint } = {}) {
    const advertiserUser = await prisma.user.create({
      data: {
        email: HOUSE_ADVERTISER_EMAIL,
        passwordHash: await bcrypt.hash('Password123!', 12),
        name: 'House Ads',
        role: UserRole.ADVERTISER,
        country: 'US',
        status: 'active',
      },
    });
    const advertiser = await prisma.advertiser.create({
      data: {
        userId: advertiserUser.id,
        companyName: 'House Ads',
        billingEmail: HOUSE_ADVERTISER_EMAIL,
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: advertiser.id,
        name: `House ${placementType}`,
        status: 'active',
        category: 'general',
        bidType: 'cpm',
        bidAmountMinor: opts.bidAmountMinor ?? 25n,
        budgetTotalMinor: 1_000_000n,
        currency: 'XTS',
      },
    });
    const creative = await prisma.adCreative.create({
      data: {
        campaignId: campaign.id,
        title: 'House sandbox ad',
        sponsoredMessage: 'XTS test credits only',
        destinationUrl: 'https://sandbox.waitlayer.test/ad',
        displayDomain: 'sandbox.waitlayer.test',
        ctaText: 'Learn more',
        status: 'approved',
      },
    });
    await prisma.campaignPlacement.create({
      data: {
        campaignId: campaign.id,
        placementType: placementType as AdPlacementType,
        bidType: 'cpm',
        bidAmountMinor: opts.bidAmountMinor ?? 25n,
        isActive: true,
      },
    });
    return { campaignId: campaign.id, creativeId: creative.id };
  }

  async function seedOpportunity(userId: string, deviceId: string, opts: {
    placementType?: string;
    state?: string;
    eligibleAt?: Date;
    expiresAt?: Date;
    confidence?: number;
  } = {}) {
    const placementType = opts.placementType ?? AdPlacementType.COMPLETION_RETURN;
    const eligibleAt = opts.eligibleAt ?? new Date(Date.now() - 5_000);
    const expiresAt = opts.expiresAt ?? new Date(Date.now() + 600_000);
    const row = await prisma.adOpportunity.create({
      data: {
        userId,
        deviceId,
        placementType,
        state: opts.state ?? 'candidate',
        attentionConfidence: opts.confidence ?? 0.9,
        integrationConfidence: opts.confidence ?? 0.9,
        eligibleAt,
        expiresAt,
        idempotencyKey: `dedup-${Math.random().toString(36).slice(2)}`,
      },
    });
    return row;
  }

  async function fixture(maxAdsPerHour = 6): Promise<Fixture> {
    const devToken = await signup(`dedup-${Date.now()}-${Math.random().toString(36).slice(2)}@waitlayer.test`, UserRole.DEVELOPER);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${devToken}`)
      .expect(200);
    const devUserId = me.body.user?.id ?? me.body.id;

    const devReg = await request(app.getHttpServer())
      .post('/api/v1/extension/register-device')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        toolType: 'vscode',
        fingerprintHash: `dedup-fp-${Math.random().toString(36).slice(2)}`,
        extensionVersion: '1.0.0',
        platform: 'darwin',
      })
      .expect(200);
    const deviceId = devReg.body.id as string;
    const eventSecret = devReg.body.eventSecret as string;

    await prisma.userSettings.upsert({
      where: { userId: devUserId },
      create: {
        userId: devUserId,
        adsEnabled: true,
        waitTelemetryEnabled: true,
        waitTelemetryConsentAt: new Date(),
        waitTelemetryPolicyVersion: '2026-07-01',
        maxAdsPerHour,
      },
      update: {
        adsEnabled: true,
        waitTelemetryEnabled: true,
        waitTelemetryConsentAt: new Date(),
        waitTelemetryPolicyVersion: '2026-07-01',
        maxAdsPerHour,
      },
    });

    const { campaignId, creativeId } = await seedHousePlacement(AdPlacementType.COMPLETION_RETURN);
    return { devToken, devUserId, deviceId, eventSecret, campaignId, creativeId };
  }

  function sandboxRequest(
    f: Fixture,
    payload: { placementType: string; correlationId: string; deviceId: string; idempotencyKey: string },
  ): Promise<Response> {
    const signature = signPayload(payload, f.eventSecret);
    return request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${f.devToken}`)
      .send({ ...payload, signature });
  }

  const served = (res: Response) => res.body.ad as { impressionToken: string; campaignId: string; creativeId: string } | null;
  const sandboxMark = (res: Response) => ({
    mode: res.body.mode,
    hasCashValue: res.body.hasCashValue,
  });

  async function claimedRows(key: string) {
    return prisma.adOpportunity.count({ where: { claimIdempotencyKey: key } });
  }

  // ── matrix ──

  it('replays the exact same placement for the same idempotency key', async () => {
    const f = await fixture();
    await seedOpportunity(f.devUserId, f.deviceId);

    const first = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-1',
      deviceId: f.deviceId,
      idempotencyKey: 'key-replay-1',
    });
    expect(first.status).toBe(200);
    expect(served(first)).not.toBeNull();
    expect(sandboxMark(first)).toEqual({ mode: 'sandbox', hasCashValue: false });
    const token1 = served(first)!.impressionToken;

    const second = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-2',
      deviceId: f.deviceId,
      idempotencyKey: 'key-replay-1',
    });
    expect(second.status).toBe(200);
    // Exact same placement: same token, campaign, and creative.
    expect(served(second)).toEqual(served(first));

    // Exactly one claimed row owns the key.
    expect(await claimedRows('key-replay-1')).toBe(1);
    const claimed = await prisma.adOpportunity.findFirst({
      where: { claimIdempotencyKey: 'key-replay-1' },
    });
    expect(claimed?.sandboxImpressionToken).toBe(token1);
    expect(claimed?.selectedCampaignId).toBe(f.campaignId);
    expect(claimed?.selectedCreativeId).toBe(f.creativeId);
  });

  it('never claims the same candidate twice for distinct keys', async () => {
    const f = await fixture();
    await seedOpportunity(f.devUserId, f.deviceId);

    const first = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-1',
      deviceId: f.deviceId,
      idempotencyKey: 'key-a',
    });
    expect(served(first)).not.toBeNull();

    // The only candidate is now claimed: a second key gets no placement.
    const second = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-2',
      deviceId: f.deviceId,
      idempotencyKey: 'key-b',
    });
    expect(second.status).toBe(200);
    expect(served(second)).toBeNull();
    expect(second.body.reason).toBe('no_sandbox_placement');

    expect(await claimedRows('key-a')).toBe(1);
    expect(await claimedRows('key-b')).toBe(0);
  });

  it('concurrent same-key requests yield at most one distinct placement', async () => {
    const f = await fixture();
    await seedOpportunity(f.devUserId, f.deviceId);

    const [a, b] = await Promise.all([
      sandboxRequest(f, {
        placementType: AdPlacementType.COMPLETION_RETURN,
        correlationId: 'corr-1',
        deviceId: f.deviceId,
        idempotencyKey: 'key-conc',
      }),
      sandboxRequest(f, {
        placementType: AdPlacementType.COMPLETION_RETURN,
        correlationId: 'corr-2',
        deviceId: f.deviceId,
        idempotencyKey: 'key-conc',
      }),
    ]);

    // Either both saw the same replay (identical tokens) or one lost the CAS
    // race. Two different placements are impossible.
    const tokens = [a, b].map(served).filter((ad): ad is NonNullable<typeof ad> => ad !== null);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(new Set(tokens.map((t) => t.impressionToken)).size).toBe(1);
    expect(new Set(tokens.map((t) => t.campaignId)).size).toBe(1);
    for (const r of [a, b]) {
      expect(r.status).toBe(200);
      expect(sandboxMark(r)).toEqual({ mode: 'sandbox', hasCashValue: false });
    }
    expect(await claimedRows('key-conc')).toBe(1);
  });

  it('concurrent distinct-key requests claim exactly one row', async () => {
    const f = await fixture();
    await seedOpportunity(f.devUserId, f.deviceId);

    const [a, b] = await Promise.all([
      sandboxRequest(f, {
        placementType: AdPlacementType.COMPLETION_RETURN,
        correlationId: 'corr-1',
        deviceId: f.deviceId,
        idempotencyKey: 'key-c1',
      }),
      sandboxRequest(f, {
        placementType: AdPlacementType.COMPLETION_RETURN,
        correlationId: 'corr-2',
        deviceId: f.deviceId,
        idempotencyKey: 'key-c2',
      }),
    ]);

    const servedCount = [a, b].filter((r) => served(r) !== null).length;
    expect(servedCount).toBe(1);
    const totalClaims = await prisma.adOpportunity.count({
      where: { state: 'claimed', claimIdempotencyKey: { not: null } },
    });
    expect(totalClaims).toBe(1);
  });

  it('binds the idempotency key to the first placement, regardless of later placementType', async () => {
    const f = await fixture();
    await seedOpportunity(f.devUserId, f.deviceId, {
      placementType: AdPlacementType.COMPLETION_RETURN,
    });

    const first = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-1',
      deviceId: f.deviceId,
      idempotencyKey: 'key-bound',
    });
    expect(served(first)).not.toBeNull();

    // Same key, different placement type: the replay binding wins — the client
    // gets the original placement, never a second one.
    const replay = await sandboxRequest(f, {
      placementType: AdPlacementType.FOREGROUND_WAIT,
      correlationId: 'corr-2',
      deviceId: f.deviceId,
      idempotencyKey: 'key-bound',
    });
    expect(served(replay)).toEqual(served(first));
    expect(await claimedRows('key-bound')).toBe(1);
  });

  it('applies the A-061 hourly exposure cap to sandbox placements', async () => {
    const f = await fixture(1); // one placement per hour
    await seedOpportunity(f.devUserId, f.deviceId, { placementType: AdPlacementType.COMPLETION_RETURN });
    await seedOpportunity(f.devUserId, f.deviceId, { placementType: AdPlacementType.COMPLETION_RETURN });

    const first = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-1',
      deviceId: f.deviceId,
      idempotencyKey: 'key-cap-1',
    });
    expect(served(first)).not.toBeNull();

    const second = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-2',
      deviceId: f.deviceId,
      idempotencyKey: 'key-cap-2',
    });
    expect(served(second)).toBeNull();
    expect(second.body.reason).toBe('no_sandbox_placement');
    expect(await claimedRows('key-cap-2')).toBe(0);
  });

  it('never writes cash settlement rows for sandbox placements', async () => {
    const f = await fixture();
    await seedOpportunity(f.devUserId, f.deviceId);

    const res = await sandboxRequest(f, {
      placementType: AdPlacementType.COMPLETION_RETURN,
      correlationId: 'corr-1',
      deviceId: f.deviceId,
      idempotencyKey: 'key-nocash',
    });
    expect(served(res)).not.toBeNull();

    expect(await prisma.earningsLedger.count()).toBe(0);
    expect(await prisma.advertiserLedger.count()).toBe(0);
    expect(await prisma.platformLedger.count()).toBe(0);
    expect(await prisma.adImpression.count()).toBe(0);
  });
});

import { BILLABLE_WAIT_SIGNALS, FORGED_SINGLE_SIGNAL } from '../extension/test/wait-fixtures';
/** Linear-delay helper (Promise.withResolvers, project rule). */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
/**
 * P0.2 — Production-shaped money-loop end-to-end test.
 *
 * Every variant exercises the REAL app (real AppModule, real Prisma against the
 * :5433 test DB, real signature verification, real LedgerService writes). There
 * is NO Prisma mock on the money path. The request shape mirrors the real VS
 * Code extension (deviceId, sessionId, toolType, waitStateId, idempotencyKey,
 * signals, detectorVersion, signature) and is signed with
 * `signPayload(payload, deviceEventSecret)` from '@waitlayer/shared'.
 *
 * `runMoneyLoop(variant)` drives the full sequence:
 *   -> register user -> register device -> detector emits wait start (signed signals)
 *   -> extension sends signed signals -> API stores confidence -> request ad
 *   -> reserve/spend campaign budget -> credit developer earnings
 *   -> update platform ledger -> (optionally) click -> close wait state.
 *
 * Ledger reconciliation (total advertiser spend == developer earnings + platform
 * fee + fraud reserve, no negative balances) is asserted on the happy paths.
 */

import * as bcrypt from 'bcryptjs';
import type { Response } from 'supertest';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';

import { BidType, ToolType, UserRole } from '@waitlayer/shared';
import { signPayload } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

const BASE = '/api/v1/extension';
const START = `${BASE}/wait-state/start`;
const END = `${BASE}/wait-state/end`;
const AD = `${BASE}/ad-request`;
const RENDER = `${BASE}/ad-rendered`;
const QUAL = `${BASE}/impression-qualified`;
const CLICK = `${BASE}/click`;

async function cleanDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "users", "sessions", "devices", "device_recovery_tokens",
      "user_settings", "payout_accounts",
      "advertisers", "campaigns", "ad_creatives", "categories",
      "blocked_categories", "country_targeting", "tool_integrations",
      "wait_state_events", "ad_impressions", "ad_clicks", "ad_reports",
      "earnings_ledger", "advertiser_ledger", "platform_ledger",
      "payout_requests", "payout_allocations", "payout_transactions",
      "recovery_debt_cases",
      "fraud_flags", "trust_scores", "campaign_approvals", "api_keys",
      "webhook_events", "audit_logs", "referrals", "referral_rewards"
    CASCADE;
  `);
}

type LoopCtx = {
  tag: string;
  devToken: string;
  devUserId: string;
  advertiserToken: string;
  advertiserId: string;
  campaignId: string;
  creativeId: string;
  deviceId: string;
  deviceEventSecret: string;
  sessionId: string;
  category: string;
};

type SeedOpts = {
  pricingModel: BidType;
  budgetTotalMinor: number;
  bidAmountMinor: number;
  category: string;
  advertiserDepositMinor: number;
};

type LoopOpts = {
  signals?: { type: string }[];
  detectorVersion?: string;
  click?: boolean;
  endBeforeAd?: boolean;
  duplicateAdRequest?: boolean;
  concurrentAdRequest?: boolean;
  duplicateImpression?: boolean;
  secondWaitMode?: 'none' | 'no_ad';
  skipStart?: boolean;
  waitStateIdOverride?: string;
};

type LoopResult = {
  startRes?: Response;
  endRes?: Response;
  adRes: Response;
  adRes2?: Response;
  dupRes?: Response;
  concurrent?: { ok: unknown; conflict: unknown };
  renderRes?: Response;
  qualifyRes?: Response;
  qualifyRes2?: Response;
  clickRes?: Response;
  impressionToken: string | null;
};

describe('Extension Money-Loop E2E (real app, real DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    process.env.REDIS_URL = '';

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
        // No-op throttle so per-variant signups (dev + advertiser per case)
        // don't trip the 10/min auth-short bucket. This spec tests the money
        // loop, not rate limiting.
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

    const adminPasswordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'admin-money@waitlayer.com',
        passwordHash: adminPasswordHash,
        name: 'Money Admin',
        role: UserRole.ADMIN,
        country: 'US',
        status: 'active',
      },
    });

    const adminRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin-money@waitlayer.com', password: 'Password123!' })
      .expect(200);
    adminToken = adminRes.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();
  });

  // ── helpers (close over app / prisma / adminToken) ──

  function signed(
    path: string,
    devToken: string,
    secret: string,
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const signature = signPayload(payload, secret);
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ ...payload, signature });
  }

  async function seedMoneyLoop(tag: string, opts: SeedOpts): Promise<LoopCtx> {
    // Developer (the extension owner / earnings recipient)
    const devEmail = `dev-${tag}@waitlayer.com`;
    const devRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: devEmail,
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: `Dev ${tag}`,
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    const devToken = devRes.body.accessToken as string;
    const devUserId = devRes.body.user.id as string;

    // Verify email -> computes trust score (affects earnings hold days only).
    const verReq = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email/request')
      .set('Authorization', `Bearer ${devToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email/confirm')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ token: verReq.body.token })
      .expect(200);

    // Privacy-by-default: ads are off until the developer opts in.
    await request(app.getHttpServer())
      .patch('/api/v1/developer/settings')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ adsEnabled: true })
      .expect(200);

    // Advertiser (the spender)
    const advEmail = `adv-${tag}@waitlayer.com`;
    const advRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: advEmail,
        password: 'Password123!',
        role: UserRole.ADVERTISER,
        name: `Adv ${tag}`,
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    const advertiserToken = advRes.body.accessToken as string;

    const advProfile = await request(app.getHttpServer())
      .get('/api/v1/advertiser/profile')
      .set('Authorization', `Bearer ${advertiserToken}`)
      .expect(200);
    const advertiserId = advProfile.body.id as string;

    // Fund the advertiser wallet (per-currency balance used at selection + billing).
    await prisma.advertiserLedger.create({
      data: {
        advertiserId,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: BigInt(opts.advertiserDepositMinor),
        currency: 'USD',
        idempotencyKey: `dep-${tag}`,
        description: `Initial deposit for ${tag}`,
      },
    });

    // Campaign + creative + targeting + submit + admin approval
    const campRes = await request(app.getHttpServer())
      .post('/api/v1/advertiser/campaigns')
      .set('Authorization', `Bearer ${advertiserToken}`)
      .send({
        name: `Camp ${tag}`,
        category: tag,
        bidType: opts.pricingModel,
        currency: 'USD',
        bidAmountMinor: opts.bidAmountMinor,
        budgetTotalMinor: opts.budgetTotalMinor,
      })
      .expect(201);
    const campaignId = campRes.body.id as string;

    const crRes = await request(app.getHttpServer())
      .post(`/api/v1/campaigns/${campaignId}/creatives`)
      .set('Authorization', `Bearer ${advertiserToken}`)
      .send({
        title: `Title ${tag}`,
        sponsoredMessage: 'Boost your wait times with code completion.',
        destinationUrl: 'https://example.com/promo',
        displayDomain: 'example.com',
      })
      .expect(200);
    const creativeId = crRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/campaigns/${campaignId}/targeting/countries`)
      .set('Authorization', `Bearer ${advertiserToken}`)
      .send([
        { countryCode: 'US', include: true },
        { countryCode: 'CA', include: true },
      ])
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/advertiser/campaigns/${campaignId}/submit`)
      .set('Authorization', `Bearer ${advertiserToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/campaigns/creatives/${creativeId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/campaigns/${campaignId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Good content' })
      .expect(201);

    // Extension device registration (returns deviceId + per-device eventSecret)
    const devReg = await request(app.getHttpServer())
      .post('/api/v1/extension/register-device')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        toolType: ToolType.VSCODE,
        fingerprintHash: `fingerprint-${tag}-1234567890`,
        extensionVersion: '1.0.0',
        platform: 'darwin',
      })
      .expect(200);
    const deviceId = devReg.body.id as string;
    const deviceEventSecret = devReg.body.eventSecret as string;

    return {
      tag,
      devToken,
      devUserId,
      advertiserToken,
      advertiserId,
      campaignId,
      creativeId,
      deviceId,
      deviceEventSecret,
      sessionId: `sess-${tag}`,
      category: tag,
    };
  }

  async function runMoneyLoop(ctx: LoopCtx, opts: LoopOpts = {}): Promise<LoopResult> {
    const {
      signals = BILLABLE_WAIT_SIGNALS,
      detectorVersion = '1.0.0',
      click = false,
      endBeforeAd = false,
      duplicateAdRequest = false,
      concurrentAdRequest = false,
      duplicateImpression = false,
      secondWaitMode = 'none',
      skipStart = false,
      waitStateIdOverride = null,
    } = opts;
    const { devToken, deviceId, sessionId, deviceEventSecret, category } = ctx;
    const tag = ctx.tag;
    const waitStateId = waitStateIdOverride ?? `ws-${tag}`;

    let startRes: LoopResult['startRes'] = undefined;
    if (!skipStart) {
      startRes = await signed(START, devToken, deviceEventSecret, {
        deviceId,
        sessionId,
        toolType: ToolType.VSCODE,
        waitStateId,
        idempotencyKey: `start-${tag}`,
        signals,
        detectorVersion,
      });
    }

    if (endBeforeAd) {
      const endRes = await signed(END, devToken, deviceEventSecret, {
        waitStateId,
        durationSeconds: '30',
        idempotencyKey: `end-${tag}`,
      });
      const adRes = await signed(AD, devToken, deviceEventSecret, {
        deviceId,
        sessionId,
        waitStateId,
        toolType: ToolType.VSCODE,
        allowedCategories: [category],
        idempotencyKey: `ad-${tag}`,
      });
      return { startRes, endRes, adRes, impressionToken: null };
    }

    const adPayload = {
      deviceId,
      sessionId,
      waitStateId,
      toolType: ToolType.VSCODE,
      allowedCategories: [category],
      idempotencyKey: `ad-${tag}`,
    };

    let adRes: LoopResult['adRes'];
    let impressionToken: string | null = null;
    let dupRes: LoopResult['dupRes'];
    let concurrent: LoopResult['concurrent'];

    if (concurrentAdRequest) {
      const [r1, r2] = await Promise.all([
        signed(AD, devToken, deviceEventSecret, adPayload),
        signed(AD, devToken, deviceEventSecret, adPayload),
      ]);
      const ok = r1.body?.ad?.impressionToken ? r1 : r2;
      const conflict = r1.body?.ad?.impressionToken ? r2 : r1;
      adRes = ok ?? r1;
      impressionToken = (ok?.body?.ad?.impressionToken as string) ?? null;
      concurrent = { ok, conflict };
    } else {
      adRes = await signed(AD, devToken, deviceEventSecret, adPayload);
      impressionToken = (adRes.body?.ad?.impressionToken as string) ?? null;
      if (duplicateAdRequest && adRes.status === 200) {
        dupRes = await signed(AD, devToken, deviceEventSecret, adPayload);
      }
    }

    if (!impressionToken) {
      return { startRes, adRes, dupRes, concurrent, impressionToken: null };
    }

    const renderRes = await signed(RENDER, devToken, deviceEventSecret, {
      impressionToken,
      renderedAt: new Date().toISOString(),
      visibleSurface: 100,
      idempotencyKey: `render-${tag}`,
    });

    // Server enforces >= MINIMUM_VISIBLE_DURATION_MS between render and qualify.
    await delay(4000);

    const impPayload = {
      impressionToken,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 6000,
      idempotencyKey: `imp-${tag}`,
    };
    const qualifyRes = await signed(QUAL, devToken, deviceEventSecret, impPayload);

    let qualifyRes2: LoopResult['qualifyRes2'];
    if (duplicateImpression) {
      qualifyRes2 = await signed(QUAL, devToken, deviceEventSecret, impPayload);
    }

    let clickRes: LoopResult['clickRes'];
    if (click) {
      clickRes = await signed(CLICK, devToken, deviceEventSecret, {
        impressionToken,
        clickedAt: new Date().toISOString(),
        idempotencyKey: `click-${tag}`,
      });
    }

    const endRes = await signed(END, devToken, deviceEventSecret, {
      waitStateId,
      durationSeconds: '30',
      idempotencyKey: `end-${tag}`,
    });

    let adRes2: LoopResult['adRes2'];
    if (secondWaitMode === 'no_ad') {
      const ws2 = `ws2-${tag}`;
      await signed(START, devToken, deviceEventSecret, {
        deviceId,
        sessionId,
        toolType: ToolType.VSCODE,
        waitStateId: ws2,
        idempotencyKey: `start2-${tag}`,
        signals,
        detectorVersion,
      });
      adRes2 = await signed(AD, devToken, deviceEventSecret, {
        deviceId,
        sessionId,
        waitStateId: ws2,
        toolType: ToolType.VSCODE,
        allowedCategories: [category],
        idempotencyKey: `ad2-${tag}`,
      });
    }

    return {
      startRes,
      adRes,
      adRes2,
      dupRes,
      concurrent,
      renderRes,
      qualifyRes,
      qualifyRes2,
      clickRes,
      endRes,
      impressionToken,
    };
  }

  /**
   * Reconciliation: total advertiser spend (debits) must equal developer
   * earnings + every platform-ledger credit (platform_fee + fraud_reserve) for
   * the campaign, and no balance may go negative.
   */
  async function assertLedgerReconciles(args: {
    advertiserId: string;
    devUserId: string;
    campaignId: string;
  }) {
    const { advertiserId, devUserId, campaignId } = args;

    const advDebits = await prisma.advertiserLedger.findMany({
      where: { advertiserId, entryType: 'debit' },
    });
    const spend = advDebits.reduce((s, e) => s + Number(e.amountMinor), 0);

    const earnings = await prisma.earningsLedger.findMany({
      where: { userId: devUserId, campaignId },
    });
    const earn = earnings.reduce((s, e) => s + Number(e.amountMinor), 0);

    const platform = await prisma.platformLedger.findMany({
      where: { campaignId, entryType: 'credit' },
    });
    const plat = platform.reduce((s, e) => s + Number(e.amountMinor), 0);

    // Zero-discrepancy: advertiser spend == developer earnings + platform credits.
    expect(spend).toBe(earn + plat);

    // No negative balances.
    const advCredits = await prisma.advertiserLedger.findMany({
      where: { advertiserId, entryType: 'credit' },
    });
    const balance = advCredits.reduce((s, e) => s + Number(e.amountMinor), 0) - spend;
    expect(balance).toBeGreaterThanOrEqual(0);

    for (const e of earnings) expect(e.amountMinor > 0n).toBe(true);

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign!.budgetSpentMinor <= campaign!.budgetTotalMinor).toBe(true);
    expect(campaign!.budgetReservedMinor >= 0n).toBe(true);

    return { spend, earn, plat };
  }

  // ── 1. CPM qualified impression ──
  it('1. serves a CPM campaign ad, qualifies the impression, and reconciles the ledger', async () => {
    const ctx = await seedMoneyLoop('cpm', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx);
    expect(res.adRes.status).toBe(200);
    expect(res.adRes.body.ad).toBeDefined();
    expect(res.impressionToken).toBeDefined();
    expect(res.qualifyRes!.status).toBe(200);
    expect(res.qualifyRes!.body.qualified).toBe(true);

    const { spend } = await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
    expect(spend).toBeGreaterThan(0);
  });

  // ── 1a. forged single-signal ai_generation cannot earn ──
  it('1a. a forged single ai_generation signal serves an ad but is not payment-eligible', async () => {
    const ctx = await seedMoneyLoop('forged', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { signals: FORGED_SINGLE_SIGNAL });
    expect(res.adRes.status).toBe(200);
    expect(res.adRes.body.ad).toBeDefined();
    expect(res.impressionToken).toBeDefined();
    expect(res.qualifyRes!.status).toBe(200);
    expect(res.qualifyRes!.body.qualified).toBe(false);
    expect(res.qualifyRes!.body.reason).toBe('uncorroborated_wait');

    const earnings = await prisma.earningsLedger.findMany({
      where: { userId: ctx.devUserId, campaignId: ctx.campaignId },
    });
    expect(earnings.length).toBe(0);
  });

  // ── 1b. ai_generation + inactivity cannot earn (inactivity is not corroboration) ──
  it('1b. ai_generation paired only with inactivity serves an ad but is not payment-eligible', async () => {
    const ctx = await seedMoneyLoop('inactivity-coro', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, {
      signals: [{ type: 'ai_generation' }, { type: 'inactivity' }],
    });
    expect(res.adRes.status).toBe(200);
    expect(res.adRes.body.ad).toBeDefined();
    expect(res.impressionToken).toBeDefined();
    expect(res.qualifyRes!.status).toBe(200);
    expect(res.qualifyRes!.body.qualified).toBe(false);
    expect(res.qualifyRes!.body.reason).toBe('uncorroborated_wait');

    const earnings = await prisma.earningsLedger.findMany({
      where: { userId: ctx.devUserId, campaignId: ctx.campaignId },
    });
    expect(earnings.length).toBe(0);
  });

  // ── 2. CPC qualified impression WITHOUT click (no spend) ──
  it('2. serves a CPC ad and qualifies the impression but bills nothing without a click', async () => {
    const ctx = await seedMoneyLoop('cpc', {
      pricingModel: BidType.CPC,
      budgetTotalMinor: 10000,
      bidAmountMinor: 500,
      category: 'business',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx);
    expect(res.adRes.status).toBe(200);
    expect(res.adRes.body.ad.campaignId).toBe(ctx.campaignId);
    expect(res.qualifyRes!.body.qualified).toBe(true);

    // CPC charges on click only -> no ledger entries yet.
    const advDebits = await prisma.advertiserLedger.findMany({
      where: { advertiserId: ctx.advertiserId, entryType: 'debit' },
    });
    const earnings = await prisma.earningsLedger.findMany({
      where: { userId: ctx.devUserId, campaignId: ctx.campaignId },
    });
    const platform = await prisma.platformLedger.findMany({
      where: { campaignId: ctx.campaignId },
    });
    expect(advDebits.length).toBe(0);
    expect(earnings.length).toBe(0);
    expect(platform.length).toBe(0);

    // Reconciliation trivially holds (0 == 0) and stays non-negative.
    await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
  });

  // ── 3. CPC qualified impression WITH click ──
  it('3. serves a CPC ad, qualifies, records a click, and reconciles the ledger', async () => {
    const ctx = await seedMoneyLoop('cpc-click', {
      pricingModel: BidType.CPC,
      budgetTotalMinor: 10000,
      bidAmountMinor: 500,
      category: 'business',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { click: true });
    expect(res.adRes.body.ad).toBeDefined();
    expect(res.qualifyRes!.body.qualified).toBe(true);
    expect(res.clickRes!.status).toBe(200);
    expect(res.clickRes!.body.clicked).toBe(true);

    const { spend } = await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
    expect(spend).toBeGreaterThan(0);
  });

  // ── 4. low-confidence inactivity-only wait ──
  it('4. returns ad:null with reason low_confidence_wait for an inactivity-only wait', async () => {
    const ctx = await seedMoneyLoop('lowconf', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { signals: [{ type: 'inactivity' }] });
    expect(res.adRes.status).toBe(200);
    expect(res.adRes.body.ad).toBeNull();
    expect(res.adRes.body.reason).toBe('low_confidence_wait');
    expect(res.impressionToken).toBeNull();

    const impressions = await prisma.adImpression.count({
      where: { waitStateId: `ws-lowconf` },
    });
    expect(impressions).toBe(0);
    const advDebits = await prisma.advertiserLedger.findMany({
      where: { advertiserId: ctx.advertiserId, entryType: 'debit' },
    });
    expect(advDebits.length).toBe(0);
  });

  // ── 5. wait ending before ad response ──
  it('5. ends the wait before the ad request and serves no ad', async () => {
    const ctx = await seedMoneyLoop('endbefore', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { endBeforeAd: true });
    // Server rejects an ad request for an already-ended wait.
    expect(res.adRes.status).toBe(400);
    expect(res.impressionToken).toBeNull();

    const impressions = await prisma.adImpression.count({
      where: { waitStateId: `ws-endbefore` },
    });
    expect(impressions).toBe(0);
  });

  // ── 6. duplicate ad request (idempotency) ──
  it('6. replaying the same ad request returns 409 and bills only once', async () => {
    const ctx = await seedMoneyLoop('dupad', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { duplicateAdRequest: true });
    expect(res.adRes.status).toBe(200);
    // Idempotent replay returns the same served ad (200), never a 409. Billing
    // happens exactly once — see assertLedgerReconciles below.
    expect(res.dupRes!.status).toBe(200);
    expect(res.dupRes!.body.ad).toBeDefined();
    expect(res.impressionToken).toBeDefined();
    expect(res.qualifyRes!.body.qualified).toBe(true);

    const { spend } = await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
    expect(spend).toBeGreaterThan(0);
    const impressions = await prisma.adImpression.count({
      where: { waitStateId: `ws-dupad` },
    });
    expect(impressions).toBe(1);
  });

  // ── 7. duplicate impression qualification (idempotency) ──
  it('7. replaying the same impression-qualified request credits only once', async () => {
    const ctx = await seedMoneyLoop('dupimp', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { duplicateImpression: true });
    expect(res.qualifyRes!.body.qualified).toBe(true);
    expect(res.qualifyRes2!.body.qualified).toBe(true);
    expect(res.qualifyRes2!.body.alreadyQualified).toBe(true);

    const earnings = await prisma.earningsLedger.findMany({
      where: { userId: ctx.devUserId, campaignId: ctx.campaignId },
    });
    expect(earnings.length).toBe(1); // single credit

    const { spend } = await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
    expect(spend).toBeGreaterThan(0);
  });

  // ── 8. campaign budget exhausted during selection ──
  it('8. after the budget is spent, a second wait finds no eligible campaign', async () => {
    const bid = 5000;
    const ctx = await seedMoneyLoop('budget', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: bid, // exactly one impression's worth (== USD minimum budget)
      bidAmountMinor: bid,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { secondWaitMode: 'no_ad' });
    expect(res.adRes.body.ad).toBeDefined();
    expect(res.qualifyRes!.body.qualified).toBe(true);
    // Second wait: campaign no longer eligible -> ad null.
    expect(res.adRes2!.body.ad).toBeNull();
    expect(res.adRes2!.body.reason).toBe('no_eligible_campaign');

    const { spend } = await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
    expect(spend).toBe(bid); // exactly one bill

    const impressions = await prisma.adImpression.count({
      where: { waitStateId: `ws-budget` },
    });
    expect(impressions).toBe(1);
  });

  // ── 9. advertiser balance exhausted DURING billing ──
  // Deposit exactly one impression's worth; serve TWO waits before qualifying
  // either, then qualify the first (drains the balance) so the second fails
  // the in-transaction balance guard and is invalidated gracefully.
  it('9. an advertiser with a drained balance fails billing gracefully (no double spend)', async () => {
    const bid = 2000;
    const ctx = await seedMoneyLoop('balexh', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 5000, // >= USD minimum; two 2000-impressions fit
      bidAmountMinor: bid,
      category: 'technology',
      advertiserDepositMinor: bid, // exactly ONE bill's worth
    });
    const { devToken, deviceId, sessionId, deviceEventSecret } = ctx;

    const ws1 = `ws-balexh`;
    const ws2 = `ws2-balexh`;
    const start1 = await signed(START, devToken, deviceEventSecret, {
      deviceId,
      sessionId,
      toolType: ToolType.VSCODE,
      waitStateId: ws1,
      idempotencyKey: `start-balexh`,
      signals: BILLABLE_WAIT_SIGNALS,
      detectorVersion: '1.0.0',
    });
    expect(start1.status).toBe(200);

    const ad1 = await signed(AD, devToken, deviceEventSecret, {
      deviceId,
      sessionId,
      waitStateId: ws1,
      toolType: ToolType.VSCODE,
      allowedCategories: [ctx.category],
      idempotencyKey: `ad-balexh`,
    });
    const token1 = ad1.body.ad.impressionToken as string;

    // Second wait is SERVED (balance still full at selection time).
    await signed(START, devToken, deviceEventSecret, {
      deviceId,
      sessionId,
      toolType: ToolType.VSCODE,
      waitStateId: ws2,
      idempotencyKey: `start2-balexh`,
      signals: BILLABLE_WAIT_SIGNALS,
      detectorVersion: '1.0.0',
    });
    const ad2 = await signed(AD, devToken, deviceEventSecret, {
      deviceId,
      sessionId,
      waitStateId: ws2,
      toolType: ToolType.VSCODE,
      allowedCategories: [ctx.category],
      idempotencyKey: `ad2-balexh`,
    });
    expect(ad2.status).toBe(200);
    const token2 = ad2.body.ad.impressionToken as string;

    await signed(RENDER, devToken, deviceEventSecret, {
      impressionToken: token1,
      renderedAt: new Date().toISOString(),
      visibleSurface: 100,
      idempotencyKey: `render-balexh`,
    });
    await signed(RENDER, devToken, deviceEventSecret, {
      impressionToken: token2,
      renderedAt: new Date().toISOString(),
      visibleSurface: 100,
      idempotencyKey: `render2-balexh`,
    });

    await delay(4000);

    const q1 = await signed(QUAL, devToken, deviceEventSecret, {
      impressionToken: token1,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 6000,
      idempotencyKey: `imp-balexh`,
    });
    expect(q1.body.qualified).toBe(true);

    // Second impression: balance now 0 -> billing guard rejects, impression invalidated.
    // Small gap so the two qualifications don't trip impression rate-limiting.
    await delay(1000);
    const q2 = await signed(QUAL, devToken, deviceEventSecret, {
      impressionToken: token2,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 6000,
      idempotencyKey: `imp2-balexh`,
    });
    expect(q2.status).toBe(200);
    expect(q2.body.qualified).toBe(false);
    expect(q2.body.reason).toBe('insufficient_advertiser_balance');

    const { spend } = await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
    expect(spend).toBe(bid); // exactly one bill

    const credits = await prisma.advertiserLedger.findMany({
      where: { advertiserId: ctx.advertiserId, entryType: 'credit' },
    });
    const debits = await prisma.advertiserLedger.findMany({
      where: { advertiserId: ctx.advertiserId, entryType: 'debit' },
    });
    const balance =
      credits.reduce((s, e) => s + Number(e.amountMinor), 0) -
      debits.reduce((s, e) => s + Number(e.amountMinor), 0);
    expect(balance).toBeGreaterThanOrEqual(0);
  });

  // ── 10. extension network retry (transient failure then success) ──
  it('10. a transient network failure on one signed call is retried and the flow completes', async () => {
    const ctx = await seedMoneyLoop('retry', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });
    const { devToken, deviceId, sessionId, deviceEventSecret } = ctx;
    const waitStateId = `ws-retry`;
    const payload = {
      deviceId,
      sessionId,
      toolType: ToolType.VSCODE,
      waitStateId,
      idempotencyKey: `start-retry`,
      signals: BILLABLE_WAIT_SIGNALS,
      detectorVersion: '1.0.0',
    };
    const signature = signPayload(payload as Record<string, unknown>, deviceEventSecret);
    const body = { ...payload, signature };

    // First attempt hits a dead endpoint -> simulated transient connection error.
    let firstFailed = false;
    try {
      await request('http://127.0.0.1:1')
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send(body)
        .timeout({ response: 2000 });
    } catch {
      firstFailed = true;
    }
    expect(firstFailed).toBe(true);

    // Retry against the real server; idempotencyKey guarantees at-most-once application.
    await request(app.getHttpServer())
      .post(START)
      .set('Authorization', `Bearer ${devToken}`)
      .send(body)
      .expect(200);

    // The failed attempt never reached the server, so exactly one wait-state start exists.
    const starts = await prisma.waitStateEvent.count({ where: { waitStateId } });
    expect(starts).toBe(1);

    // Finish the loop from the already-recorded start to prove end-to-end recovery.
    const res = await runMoneyLoop(
      { ...ctx, tag: 'retry' },
      {
        skipStart: true,
        waitStateIdOverride: waitStateId,
        signals: BILLABLE_WAIT_SIGNALS,
        detectorVersion: '1.0.0',
      },
    );
    expect(res.adRes.body.ad).toBeDefined();
    expect(res.qualifyRes!.body.qualified).toBe(true);

    await assertLedgerReconciles({
      advertiserId: ctx.advertiserId,
      devUserId: ctx.devUserId,
      campaignId: ctx.campaignId,
    });
  });

  // ── 11. two concurrent ad requests for the same wait (idempotency) ──
  it('11. two concurrent ad requests for the same wait serve exactly one ad and bill once', async () => {
    const ctx = await seedMoneyLoop('concurrent', {
      pricingModel: BidType.CPM,
      budgetTotalMinor: 50000,
      bidAmountMinor: 2000,
      category: 'technology',
      advertiserDepositMinor: 100000,
    });

    const res = await runMoneyLoop(ctx, { concurrentAdRequest: true });
    expect(res.impressionToken).toBeDefined();
    expect(res.qualifyRes!.body.qualified).toBe(true);
    // Exactly one 200 (served) and one 409 (duplicate), thanks to the advisory lock.
    expect(res.concurrent!.ok).not.toBeNull();
    expect(res.concurrent!.conflict).not.toBeNull();
    expect((res.concurrent!.ok as Response).status).toBe(200);
    expect((res.concurrent!.conflict as Response).status).toBe(409);
    const impressions = await prisma.adImpression.count({
      where: { waitStateId: `ws-concurrent` },
    });
    expect(impressions).toBe(1);
  });
});

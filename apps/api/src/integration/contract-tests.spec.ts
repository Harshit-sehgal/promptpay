import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll,beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { BidType, canonicalJson, PayoutProvider, UserRole, verifySignature } from '@waitlayer/shared';
import { signPayload } from '@waitlayer/shared';
import {
  AdClickResponse,
  AdRenderedResponse,
  AdRequestResponse,
  CreateCampaignResponse,
  CreativeResponse,
  LedgerBalanceResponse,
  LoginResponse,
  MeResponse,
  PayoutAvailableResponse,
  PayoutMethodResponse,
  PayoutRequestResponse,
  QualifiedImpressionResponse,
  RefreshResponse,
  RegisterDeviceResponse,
  SignupResponse,
  WaitStateEndResponse,
  WaitStateStartResponse,
} from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

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

describe('API Contract Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previousRedisUrl: string | undefined;

  beforeAll(async () => {
    // Integration tests run many auth requests quickly and may be repeated
    // within one Redis TTL. Force per-process in-memory throttling so local
    // verification does not inherit counters from a previous test run.
    previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = '';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
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

    // Seed an admin directly in the DB. Public self-service signup rejects
    // privileged roles (SIGNUP_ALLOWED_ROLES = developer, advertiser); the
    // contract test exercises the (forbidden) admin signup below purely to
    // assert that control returns 400, then logs in with this seeded admin.
    const adminPasswordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'contract-admin@test.com',
        passwordHash: adminPasswordHash,
        name: 'Contract Admin',
        role: UserRole.ADMIN,
        country: 'US',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanDb(prisma);
    if (app) await app.close();
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  });

  // ── Shared state ──
  let devToken: string;
  let advertiserToken: string;
  let adminToken: string;
  let campaignId: string;
  let creativeId: string;
  let deviceId: string;
  let deviceEventSecret: string;
  let impressionToken: string;

  // ══════════════════════════════════════════════════════
  // 1. Auth API Contracts
  // ══════════════════════════════════════════════════════

  describe('Auth API', () => {
    it('POST /auth/signup → matches SignupResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'contract-dev@test.com', password: 'Password123!', role: UserRole.DEVELOPER, name: 'Contract Dev', country: 'US' })
        .expect(201);
      expect(() => SignupResponse.parse(res.body)).not.toThrow();
      devToken = res.body.accessToken;

      // Privacy-by-default: ads are off until the developer opts in. Enable
      // ads so the extension ad-serving contract flow can be exercised.
      await request(app.getHttpServer())
        .patch('/api/v1/developer/settings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ adsEnabled: true })
        .expect(200);
    });

    it('POST /auth/login → matches LoginResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'contract-dev@test.com', password: 'Password123!' })
        .expect(200);
      expect(() => LoginResponse.parse(res.body)).not.toThrow();
    });

    it('POST /auth/refresh → matches RefreshResponse schema', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'contract-dev@test.com', password: 'Password123!' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken })
        .expect(200);
      expect(() => RefreshResponse.parse(res.body)).not.toThrow();
    });

    it('GET /auth/me → matches MeResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);
      expect(() => MeResponse.parse(res.body)).not.toThrow();
    });

    // ── Admin + Advertiser (needed for campaign creation before ad-serving) ──
    it('registers admin and advertiser for downstream flows', async () => {
      // Admin self-service signup must be rejected — the admin was seeded in
      // beforeAll. Login with the seeded admin to obtain a token.
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'contract-admin@test.com', password: 'Password123!', role: UserRole.ADMIN, name: 'Contract Admin', country: 'US' })
        .expect(400);
      const adminLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'contract-admin@test.com', password: 'Password123!' })
        .expect(200);
      adminToken = adminLogin.body.accessToken;

      const advRes = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'contract-adv@test.com', password: 'Password123!', role: UserRole.ADVERTISER, name: 'Contract Adv', country: 'US' })
        .expect(201);
      advertiserToken = advRes.body.accessToken;

      // Fund the advertiser balance so campaigns are eligible to serve
      const advertiser = await prisma.advertiser.findUnique({
        where: { userId: advRes.body.user.id },
      });
      if (advertiser) {
        await prisma.advertiserLedger.create({
          data: {
            advertiserId: advertiser.id,
            entryType: 'credit',
            status: 'confirmed',
            amountMinor: 100000,
            currency: 'USD',
            idempotencyKey: 'contract-deposit-initial',
            description: 'Initial deposit for contract tests',
          },
        });
      }
    });
  });

  // ══════════════════════════════════════════════════════
  // 2. Campaign & Creative API Contracts
  // (Runs before Extension so ad-request finds an eligible campaign)
  // ══════════════════════════════════════════════════════

  describe('Campaign API', () => {
    it('POST /advertiser/campaigns → matches CreateCampaignResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/advertiser/campaigns')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({ name: 'Contract CPM Campaign', category: 'technology', bidType: BidType.CPM, currency: 'USD', bidAmountMinor: 1000, budgetTotalMinor: 50000 })
        .expect(201);
      expect(() => CreateCampaignResponse.parse(res.body)).not.toThrow();
      campaignId = res.body.id;
    });

    it('POST /campaigns/:id/creatives → matches CreativeResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignId}/creatives`)
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({ title: 'Contract Creative', sponsoredMessage: 'Test sponsored message', destinationUrl: 'https://test.com', displayDomain: 'test.com' })
        .expect(200);
      expect(() => CreativeResponse.parse(res.body)).not.toThrow();
      creativeId = res.body.id;
    });

    it('approves creative and campaign so ads can be served', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/creatives/${creativeId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/advertiser/campaigns/${campaignId}/submit`)
        .set('Authorization', `Bearer ${advertiserToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/admin/campaigns/${campaignId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Good' })
        .expect(201);
    });
  });

  // ══════════════════════════════════════════════════════
  // 3. Extension API Contracts
  // ══════════════════════════════════════════════════════

  describe('Extension API', () => {
    it('POST /extension/register-device → matches RegisterDeviceResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/register-device')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ toolType: 'vscode', fingerprintHash: 'contract-fingerprint-abc', extensionVersion: '1.0.0', platform: 'linux' })
        .expect(200);
      expect(() => RegisterDeviceResponse.parse(res.body)).not.toThrow();
      expect(res.body.eventSecret).toBeDefined(); // per-device secret issued
      deviceId = res.body.id;
      deviceEventSecret = res.body.eventSecret; // sign extension events with the per-device secret
    });

    it('POST /extension/wait-state/start → matches WaitStateStartResponse schema', async () => {
      const payload = { deviceId, sessionId: 'contract-session', toolType: 'vscode', waitStateId: 'contract-ws', idempotencyKey: 'contract-ws-start' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => WaitStateStartResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/wait-state/end → matches WaitStateEndResponse schema', async () => {
      // DTO field is `durationSeconds` (string, 1-16 chars) carrying seconds.
      // Value must be within 30s tolerance of the server-computed duration (server
      // computes elapsed seconds since the wait_state_start event, created moments
      // ago — so 1 second works).
      const payload = { waitStateId: 'contract-ws', durationSeconds: '1', idempotencyKey: 'contract-ws-end' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/end')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => WaitStateEndResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/ad-request → matches AdRequestResponse schema', async () => {
      // Need a fresh wait-state start for each ad-request (ad-request validates active wait)
      const wsPayload = { deviceId, sessionId: 'contract-session', toolType: 'vscode', waitStateId: 'contract-ad-ws', idempotencyKey: 'contract-ad-ws-start' };
      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...wsPayload, signature: signPayload(wsPayload, deviceEventSecret) })
        .expect(200);

      const payload = { deviceId, sessionId: 'contract-session', waitStateId: 'contract-ad-ws', toolType: 'vscode', idempotencyKey: 'contract-ad-req' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => AdRequestResponse.parse(res.body)).not.toThrow();
      impressionToken = res.body.ad?.impressionToken ?? '';
    });

    it('POST /extension/ad-rendered → matches AdRenderedResponse schema', async () => {
      const payload = { impressionToken, renderedAt: new Date().toISOString(), idempotencyKey: 'contract-render' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig });
      if (res.status !== 200) {
        console.error('ad-rendered error body:', res.body);
      }
      expect(res.status).toBe(200);
      expect(() => AdRenderedResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/impression-qualified → matches QualifiedImpressionResponse schema', async () => {
      const payload = { impressionToken, qualifiedAt: new Date().toISOString(), visibleDurationMs: 6000, idempotencyKey: 'contract-qual' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => QualifiedImpressionResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/impression-qualified (duplicate) → does not double spend or duplicate ledger entries', async () => {
      const campaignBefore = await prisma.campaign.findUnique({ where: { id: campaignId } });
      const advertiserLedgerCountBefore = await prisma.advertiserLedger.count();
      const earningsLedgerCountBefore = await prisma.earningsLedger.count();
      const platformLedgerCountBefore = await prisma.platformLedger.count();

      const payload = { impressionToken, qualifiedAt: new Date().toISOString(), visibleDurationMs: 6000, idempotencyKey: 'contract-qual-dup' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);

      expect(() => QualifiedImpressionResponse.parse(res.body)).not.toThrow();
      expect(res.body.qualified).toBe(true);
      expect(res.body.alreadyQualified).toBe(true);

      const campaignAfter = await prisma.campaign.findUnique({ where: { id: campaignId } });
      expect(campaignAfter?.budgetSpentMinor).toBe(campaignBefore?.budgetSpentMinor);

      const advertiserLedgerCountAfter = await prisma.advertiserLedger.count();
      const earningsLedgerCountAfter = await prisma.earningsLedger.count();
      const platformLedgerCountAfter = await prisma.platformLedger.count();

      expect(advertiserLedgerCountAfter).toBe(advertiserLedgerCountBefore);
      expect(earningsLedgerCountAfter).toBe(earningsLedgerCountBefore);
      expect(platformLedgerCountAfter).toBe(platformLedgerCountBefore);
    });

    it('POST /extension/impression-qualified (concurrent) → handles concurrent requests atomically, billing only once', async () => {
      // Mark previous impressions as non-billable to bypass frequency cap
      await prisma.adImpression.updateMany({
        data: { isBillable: false },
      });

      const wsPayload = { deviceId, sessionId: 'contract-session-concurrent', toolType: 'vscode', waitStateId: 'concurrent-ws', idempotencyKey: 'concurrent-ws-start' };
      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...wsPayload, signature: signPayload(wsPayload, deviceEventSecret) })
        .expect(200);

      const adReqPayload = { deviceId, sessionId: 'contract-session-concurrent', waitStateId: 'concurrent-ws', toolType: 'vscode', idempotencyKey: 'concurrent-ad-req' };
      const adRes = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature: signPayload(adReqPayload, deviceEventSecret) })
        .expect(200);
      const token = adRes.body.ad.impressionToken;

      const renderPayload = { impressionToken: token, renderedAt: new Date().toISOString(), idempotencyKey: 'concurrent-render' };
      await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...renderPayload, signature: signPayload(renderPayload, deviceEventSecret) })
        .expect(200);

      const payload1 = { impressionToken: token, qualifiedAt: new Date().toISOString(), visibleDurationMs: 6000, idempotencyKey: 'concurrent-qual-1' };
      const payload2 = { impressionToken: token, qualifiedAt: new Date().toISOString(), visibleDurationMs: 6000, idempotencyKey: 'concurrent-qual-2' };

      const campaignBefore = await prisma.campaign.findUnique({ where: { id: campaignId } });
      const advCountBefore = await prisma.advertiserLedger.count();

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/extension/impression-qualified')
          .set('Authorization', `Bearer ${devToken}`)
          .send({ ...payload1, signature: signPayload(payload1, deviceEventSecret) }),
        request(app.getHttpServer())
          .post('/api/v1/extension/impression-qualified')
          .set('Authorization', `Bearer ${devToken}`)
          .send({ ...payload2, signature: signPayload(payload2, deviceEventSecret) }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      expect(res1.body.qualified).toBe(true);
      expect(res2.body.qualified).toBe(true);

      const alreadyQual1 = !!res1.body.alreadyQualified;
      const alreadyQual2 = !!res2.body.alreadyQualified;
      expect(alreadyQual1 !== alreadyQual2).toBe(true);

      const campaignAfter = await prisma.campaign.findUnique({ where: { id: campaignId } });
      expect(campaignAfter?.budgetSpentMinor).toBe((campaignBefore?.budgetSpentMinor ?? 0) + campaignBefore?.bidAmountMinor!);

      const advCountAfter = await prisma.advertiserLedger.count();
      expect(advCountAfter).toBe(advCountBefore + 1);
    });

    it('POST /extension/click → matches AdClickResponse schema', async () => {
      const payload = { impressionToken, clickedAt: new Date().toISOString(), idempotencyKey: 'contract-click' };
      const sig = signPayload(payload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/click')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => AdClickResponse.parse(res.body)).not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════
  // 4. Payout API Contracts
  // ══════════════════════════════════════════════════════

  describe('Payout API', () => {
    it('POST /payout/method → matches PayoutMethodResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/payout/method')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ provider: PayoutProvider.PAYPAL_EMAIL, destination: 'contract-dev@paypal.com', currency: 'USD' })
        .expect(201);
      expect(() => PayoutMethodResponse.parse(res.body)).not.toThrow();
      expect(res.body.id).toBeDefined();
    });

    it('GET /payout/available → matches PayoutAvailableResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payout/available')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);
      expect(() => PayoutAvailableResponse.parse(res.body)).not.toThrow();
    });

    // Payout request requires confirmed earnings — validate schema only (no balance needed)
    it('POST /payout/request schema is structurally valid', () => {
      // Verify the schema itself parses a valid-looking object. The schema now
      // marks `payoutAccountId` as required (the database FK is NOT NULL) so
      // the mock must include it.
      const mock = {
        id: 'req-1',
        userId: 'u-1',
        payoutAccountId: 'pa-1',
        status: 'requested',
        requestedAmountMinor: 1000,
        currency: 'USD',
        allocations: [{ id: 'a-1', earningsEntryId: 'e-1', amountMinor: 1000 }],
      };
      expect(() => PayoutRequestResponse.parse(mock)).not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════
  // 5. Ledger API Contracts
  // ══════════════════════════════════════════════════════

  describe('Ledger API', () => {
    it('GET /ledger/balance → matches LedgerBalanceResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ledger/balance')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);
      expect(() => LedgerBalanceResponse.parse(res.body)).not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════
  // 6. Structural Schema Tests (no server needed)
  // ══════════════════════════════════════════════════════

  describe('Schema Structural Validation', () => {
    it('SignupResponse rejects missing user.id', () => {
      const bad = { user: { email: 'x@x.com', name: 'X', role: 'developer' }, accessToken: 't', refreshToken: 't' };
      expect(() => SignupResponse.parse(bad)).toThrow();
    });

    it('SignupResponse rejects bad email', () => {
      const bad = { user: { id: '11111111-1111-1111-1111-111111111111', email: 'not-email', name: 'X', role: 'developer', emailVerified: true }, accessToken: 't', refreshToken: 't' };
      expect(() => SignupResponse.parse(bad)).toThrow();
    });

    it('QualifiedImpressionResponse accepts qualified=true shape', () => {
      expect(() => QualifiedImpressionResponse.parse({ qualified: true, impressionId: 'imp-1' })).not.toThrow();
    });

    it('QualifiedImpressionResponse accepts qualified=false shape', () => {
      expect(() => QualifiedImpressionResponse.parse({ qualified: false, reason: 'minimum_duration_not_met', minimumRequired: 5000, actual: 2000 })).not.toThrow();
    });

    it('AdClickResponse accepts clicked=true shape', () => {
      expect(() => AdClickResponse.parse({ clicked: true, clickId: 'click-1' })).not.toThrow();
    });

    it('AdClickResponse accepts clicked=false shape', () => {
      expect(() => AdClickResponse.parse({ clicked: false, reason: 'duplicate_click' })).not.toThrow();
    });

    it('AdRequestResponse accepts ad=null (no eligible campaign)', () => {
      expect(() => AdRequestResponse.parse({ ad: null })).not.toThrow();
    });

    it('RefreshResponse rejects object missing accessToken', () => {
      expect(() => RefreshResponse.parse({ refreshToken: 'r' })).toThrow();
    });
  });

  describe('shared signing module — canonicalJson & verifySignature regression', () => {
    const secret = 'test-256bit-secret-aaaa-bbbb-32ch';

    it('canonicalJson sorts nested keys (deep sort)', () => {
      const payload = { z: 1, a: { b: 2, c: { d: 3, a: 4 } } };
      const json = canonicalJson(payload);
      const parsed = JSON.parse(json);
      // Top-level: 'a' before 'z'
      expect(Object.keys(parsed)).toEqual(['a', 'z']);
      // Nested level 1: 'b' before 'c'
      expect(Object.keys(parsed.a)).toEqual(['b', 'c']);
      // Nested level 2 (inside c): 'a' before 'd'
      expect(Object.keys(parsed.a.c)).toEqual(['a', 'd']);
    });

    it('canonicalJson produces identical output for different key insertion order', () => {
      const payload1: Record<string, unknown> = {};
      payload1['bbb'] = 2;
      payload1['aaa'] = 1;
      const payload2 = { aaa: 1, bbb: 2 };
      expect(canonicalJson(payload1)).toEqual(canonicalJson(payload2));
    });

    it('sign + verify round-trip works', () => {
      const payload = { event: 'test', duration: 10, deep: { x: 'y', inner: { zz: 1, aa: 2 } } };
      const signature = signPayload(payload, secret);
      // Different insertion order still verifies (canonicalJson handles it)
      const payload2: Record<string, unknown> = {};
      payload2['duration'] = 10;
      payload2['deep'] = { inner: { aa: 2, zz: 1 }, x: 'y' };
      payload2['event'] = 'test';
      expect(verifySignature(payload2, secret, signature)).toBe(true);
    });

    it('verifySignature rejects tampered payload', () => {
      const payload = { amount: 100 };
      const signature = signPayload(payload, secret);
      expect(verifySignature({ amount: 101 }, secret, signature)).toBe(false);
    });

    it('verifySignature rejects hex-injected non-hex characters', () => {
      const payload = { ok: true };
      const signature = signPayload(payload, secret);
      // Replace two hex characters with 'xx' — buffer decoding must be safe
      const broken = signature.slice(0, -2) + 'xx';
      expect(verifySignature(payload, secret, broken)).toBe(false);
    });
  });
});

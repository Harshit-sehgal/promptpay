import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma.service';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { UserRole, PayoutProvider, BidType } from '@waitlayer/shared';
import { signPayload } from '@waitlayer/shared';
import {
  SignupResponse,
  LoginResponse,
  RefreshResponse,
  MeResponse,
  RegisterDeviceResponse,
  WaitStateStartResponse,
  WaitStateEndResponse,
  AdRequestResponse,
  AdRenderedResponse,
  QualifiedImpressionResponse,
  AdClickResponse,
  PayoutMethodResponse,
  PayoutRequestResponse,
  PayoutAvailableResponse,
  LedgerBalanceResponse,
  CreateCampaignResponse,
  CreativeResponse,
} from '@waitlayer/shared';

const HMAC_SECRET = 'dev-secret-change-me-do-not-use-in-production';

async function cleanDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "users", "sessions", "devices", "user_settings", "payout_accounts",
      "advertisers", "campaigns", "ad_creatives", "categories",
      "blocked_categories", "country_targeting", "tool_integrations",
      "wait_state_events", "ad_impressions", "ad_clicks", "ad_reports",
      "earnings_ledger", "advertiser_ledger", "platform_ledger",
      "payout_requests", "payout_allocations", "payout_transactions",
      "fraud_flags", "trust_scores", "campaign_approvals", "api_keys",
      "webhook_events", "audit_logs", "referrals", "referral_rewards"
    CASCADE;
  `);
}

describe('API Contract Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    if (prisma) await cleanDb(prisma);
    if (app) await app.close();
  });

  // ── Shared state ──
  let devToken: string;
  let advertiserToken: string;
  let adminToken: string;
  let campaignId: string;
  let creativeId: string;
  let deviceId: string;
  let impressionToken: string;

  // ══════════════════════════════════════════════════════
  // 1. Auth API Contracts
  // ══════════════════════════════════════════════════════

  describe('Auth API', () => {
    it('POST /auth/signup → matches SignupResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'contract-dev@test.com', password: 'password123', role: UserRole.DEVELOPER, name: 'Contract Dev', country: 'US' })
        .expect(201);
      expect(() => SignupResponse.parse(res.body)).not.toThrow();
      devToken = res.body.accessToken;
    });

    it('POST /auth/login → matches LoginResponse schema', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'contract-dev@test.com', password: 'password123' })
        .expect(200);
      expect(() => LoginResponse.parse(res.body)).not.toThrow();
    });

    it('POST /auth/refresh → matches RefreshResponse schema', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'contract-dev@test.com', password: 'password123' });
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
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'contract-admin@test.com', password: 'password123', role: UserRole.ADMIN, name: 'Contract Admin', country: 'US' });
      adminToken = adminRes.body.accessToken;

      const advRes = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'contract-adv@test.com', password: 'password123', role: UserRole.ADVERTISER, name: 'Contract Adv', country: 'US' });
      advertiserToken = advRes.body.accessToken;
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
    });

    it('POST /extension/wait-state/start → matches WaitStateStartResponse schema', async () => {
      const payload = { deviceId, sessionId: 'contract-session', toolType: 'vscode', waitStateId: 'contract-ws', idempotencyKey: 'contract-ws-start' };
      const sig = signPayload(payload, HMAC_SECRET);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => WaitStateStartResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/wait-state/end → matches WaitStateEndResponse schema', async () => {
      const payload = { waitStateId: 'contract-ws', duration: '5000', idempotencyKey: 'contract-ws-end' };
      const sig = signPayload(payload, HMAC_SECRET);
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
        .send({ ...wsPayload, signature: signPayload(wsPayload, HMAC_SECRET) })
        .expect(200);

      const payload = { deviceId, sessionId: 'contract-session', waitStateId: 'contract-ad-ws', toolType: 'vscode', idempotencyKey: 'contract-ad-req' };
      const sig = signPayload(payload, HMAC_SECRET);
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
      const sig = signPayload(payload, HMAC_SECRET);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => AdRenderedResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/impression-qualified → matches QualifiedImpressionResponse schema', async () => {
      const payload = { impressionToken, qualifiedAt: new Date().toISOString(), visibleDurationMs: 6000, idempotencyKey: 'contract-qual' };
      const sig = signPayload(payload, HMAC_SECRET);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...payload, signature: sig })
        .expect(200);
      expect(() => QualifiedImpressionResponse.parse(res.body)).not.toThrow();
    });

    it('POST /extension/click → matches AdClickResponse schema', async () => {
      const payload = { impressionToken, clickedAt: new Date().toISOString(), idempotencyKey: 'contract-click' };
      const sig = signPayload(payload, HMAC_SECRET);
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
      // Verify the schema itself parses a valid-looking object
      const mock = {
        id: 'req-1',
        userId: 'u-1',
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
});
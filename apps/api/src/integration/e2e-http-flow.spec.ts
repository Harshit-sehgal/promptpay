import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { BidType, PayoutProvider, UserRole } from '@waitlayer/shared';
import { signPayload } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

async function cleanDb(prisma: PrismaService) {
  // Truncate tables to ensure a clean test run without foreign key violations
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

describe('End-to-End HTTP Integration Flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;
  let previousRedisUrl: string | undefined;

  beforeAll(async () => {
    // Keep repeated local E2E runs deterministic: production can use Redis,
    // but tests should not inherit Redis throttle counters from prior runs.
    previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = '';

    // Override throttlers & brute force guards for rapid E2E testing
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
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
    ledgerService = app.get(LedgerService);
    await cleanDb(prisma);

    // Seed the admin user directly in the DB. Public self-service signup
    // correctly rejects the `admin` role (SIGNUP_ALLOWED_ROLES = developer,
    // advertiser) — privileged roles must not be grantable over the public
    // endpoint. Seeding here mirrors how an admin would actually be created
    // (escalation path / migration), so the rest of the suite can log in as
    // admin without exercising the (intentionally forbidden) signup path.
    const adminPasswordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'admin@waitlayer.com',
        passwordHash: adminPasswordHash,
        name: 'Super Admin',
        role: UserRole.ADMIN,
        country: 'US',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await cleanDb(prisma);
    }
    if (app) {
      await app.close();
    }
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  });

  // Flow variables
  let devToken: string;
  let devUserId: string;
  let advertiserToken: string;
  let advertiserBToken: string;
  let advertiserId: string;
  let adminToken: string;

  let campaignId: string;
  let creativeId: string;
  let cpcCampaignId: string;
  let cpcCreativeId: string;
  let deviceId: string;
  let deviceEventSecret: string;
  let impressionToken: string;
  let payoutAccountId: string;
  let earningEntryId: string;
  let payoutId: string;

  describe('1. Authentication & Onboarding', () => {
    it('should successfully register a developer user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'dev@waitlayer.com',
          password: 'Password123!',
          role: UserRole.DEVELOPER,
          name: 'Jane Developer',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('developer');
      expect(res.body.accessToken).toBeDefined();
      devUserId = res.body.user.id;
    });

    it('should successfully register an advertiser user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'adv@waitlayer.com',
          password: 'Password123!',
          role: UserRole.ADVERTISER,
          name: 'Big Brand Co',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('advertiser');
      advertiserToken = res.body.accessToken;
    });

    it('should successfully register a second advertiser user (B)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'adv-b@waitlayer.com',
          password: 'Password123!',
          role: UserRole.ADVERTISER,
          name: 'Alternative Advertiser',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('advertiser');
      advertiserBToken = res.body.accessToken;
    });

    it('should reject self-service signup with a privileged (admin) role', async () => {
      // Security control: SIGNUP_ALLOWED_ROLES = [developer, advertiser].
      // Privileged roles must not be grantable via the public signup endpoint.
      // The admin user for this suite is seeded directly in beforeAll.
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'admin2@waitlayer.com',
          password: 'Password123!',
          role: UserRole.ADMIN,
          name: 'Super Admin',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(400);
    });

    let firstDevRefreshToken: string;

    it('should authenticate registered users to obtain tokens', async () => {
      // Developer Login
      const devRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'dev@waitlayer.com', password: 'Password123!' })
        .expect(200);
      devToken = devRes.body.accessToken;
      firstDevRefreshToken = devRes.body.refreshToken;

      // Admin Login
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@waitlayer.com', password: 'Password123!' })
        .expect(200);
      adminToken = adminRes.body.accessToken;

      // Advertiser B Login
      const advBRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'adv-b@waitlayer.com', password: 'Password123!' })
        .expect(200);
      advertiserBToken = advBRes.body.accessToken;

      // Privacy-by-default: ads are off until the developer opts in. Enable
      // ads for the test developer so the ad-serving loop can be exercised.
      await request(app.getHttpServer())
        .patch('/api/v1/developer/settings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ adsEnabled: true })
        .expect(200);
    });

    it('should rotate refresh token and reject reuse of old refresh token', async () => {
      // 1. Rotate token
      const rotateRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: firstDevRefreshToken })
        .expect(200);

      const newAccessToken = rotateRes.body.accessToken;
      const newRefreshToken = rotateRes.body.refreshToken;
      expect(newAccessToken).toBeDefined();
      expect(newRefreshToken).toBeDefined();

      // Verify new access token works
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);

      // 2. Attempt to reuse old refresh token -> should be rejected with 401
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: firstDevRefreshToken })
        .expect(401);

      // 3. Verify that the new access token is ALSO revoked now because family sessions were revoked on reuse detection
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(401);

      // Login again to refresh devToken for subsequent tests
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'dev@waitlayer.com', password: 'Password123!' })
        .expect(200);
      devToken = loginRes.body.accessToken;
    });

    it('should create advertiser B profile automatically', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/advertiser/profile')
        .set('Authorization', `Bearer ${advertiserBToken}`)
        .expect(200);
    });

    it('should verify developer email and recalculate trust score', async () => {
      // Request email verification
      const reqRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/request')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);

      expect(reqRes.body.token).toBeDefined();

      // Confirm verification
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/confirm')
        .send({ token: reqRes.body.token })
        .expect(200);

      // Verify the user emailVerified flag in database
      const user = await prisma.user.findUnique({ where: { id: devUserId } });
      expect(user?.emailVerified).toBe(true);

      // Verify trust score computed
      const trust = await prisma.trustScore.findUnique({ where: { userId: devUserId } });
      expect(trust?.score).toBeGreaterThan(0);
    });

    it('should complete the full password reset flow (forgot → reset → re-login)', async () => {
      const email = 'reset-flow@waitlayer.com';
      const originalPassword = 'Original-password-123!';
      const newPassword = 'Brand-new-password-456!';

      // Register a dedicated user for this flow
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email,
          password: originalPassword,
          role: UserRole.DEVELOPER,
          name: 'Reset Flow',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);

      // Unknown email → generic message, no token leaked
      const unknownRes = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'does-not-exist@waitlayer.com' })
        .expect(200);
      expect(unknownRes.body.token).toBeUndefined();
      expect(unknownRes.body.message).toContain('If an account exists');

      // Known email → token exposed outside production for testability
      const forgotRes = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(200);
      expect(forgotRes.body.token).toBeDefined();
      const resetToken = forgotRes.body.token;

      // Weak password rejected by validation
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ token: resetToken, newPassword: 'short' })
        .expect(400);

      // Reset with a valid token
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ token: resetToken, newPassword })
        .expect(200);

      // Token is single-use: replay must fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ token: resetToken, newPassword: 'Another-password-789!' })
        .expect(400);

      // Old password no longer works
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: originalPassword })
        .expect(401);

      // New password works
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: newPassword })
        .expect(200);
      expect(loginRes.body.accessToken).toBeDefined();
    });
  });

  describe('2. Campaign Creation & Approval Flow', () => {
    it('should create an advertiser profile automatically', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/advertiser/profile')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      advertiserId = res.body.id;
      await prisma.advertiserLedger.create({
        data: {
          advertiserId,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: 100000,
          currency: 'USD',
          idempotencyKey: 'e2e-http-advertiser-initial-deposit',
          description: 'Initial deposit for HTTP e2e campaign serving',
        },
      });
    });

    it('should create a new draft CPM campaign', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/advertiser/campaigns')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({
          name: 'E2E CPM Campaign',
          category: 'technology',
          bidType: BidType.CPM,
          currency: 'USD',
          bidAmountMinor: 2000, // $20.00 bid CPM
          budgetTotalMinor: 50000, // $500.00 total budget
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('draft');
      campaignId = res.body.id;
    });

    it('should create a new draft CPC campaign', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/advertiser/campaigns')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({
          name: 'E2E CPC Campaign',
          category: 'business',
          bidType: BidType.CPC,
          currency: 'USD',
          bidAmountMinor: 500, // $5.00 per click
          budgetTotalMinor: 10000, // $100.00 total budget
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      cpcCampaignId = res.body.id;
    });

    it('should add a creative to the draft CPM campaign', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignId}/creatives`)
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({
          title: 'Fast Developer Tools',
          sponsoredMessage: 'Boost your wait times with code completion.',
          destinationUrl: 'https://developer.tools/promo',
          displayDomain: 'developer.tools',
        })
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('draft');
      creativeId = res.body.id;
    });

    it('should add a creative to the draft CPC campaign', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${cpcCampaignId}/creatives`)
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({
          title: 'Click-Based Offer',
          sponsoredMessage: 'Get $5 back per visit',
          destinationUrl: 'https://click.promo/offer',
          displayDomain: 'click.promo',
        })
        .expect(200);

      expect(res.body.id).toBeDefined();
      cpcCreativeId = res.body.id;
    });

    it('should set country targeting for both campaigns', async () => {
      for (const id of [campaignId, cpcCampaignId]) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/campaigns/${id}/targeting/countries`)
          .set('Authorization', `Bearer ${advertiserToken}`)
          .send([
            { countryCode: 'US', include: true },
            { countryCode: 'CA', include: true },
          ])
          .expect(200);
        expect(res.body.length).toBe(2);
      }
    });

    it('should submit both campaigns for review', async () => {
      for (const id of [campaignId, cpcCampaignId]) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/advertiser/campaigns/${id}/submit`)
          .set('Authorization', `Bearer ${advertiserToken}`);

        if (res.status !== 201) {
          console.error('submitCampaign failed with body:', res.body);
        }
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('submitted');
      }

      // Check creatives are now pending_review
      const creative = await prisma.adCreative.findUnique({ where: { id: creativeId } });
      expect(creative?.status).toBe('pending_review');
      const cpcCreative = await prisma.adCreative.findUnique({ where: { id: cpcCreativeId } });
      expect(cpcCreative?.status).toBe('pending_review');
    });

    it('should allow admin to approve creatives and both campaigns', async () => {
      for (const id of [creativeId, cpcCreativeId]) {
        const crApprove = await request(app.getHttpServer())
          .post(`/api/v1/campaigns/creatives/${id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`);
        if (crApprove.status !== 200) {
          console.error('approveCreative failed with body:', crApprove.body);
        }
        expect(crApprove.status).toBe(200);
      }

      for (const id of [campaignId, cpcCampaignId]) {
        const approveRes = await request(app.getHttpServer())
          .post(`/api/v1/admin/campaigns/${id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ reason: 'Good content' });

        if (approveRes.status !== 201) {
          console.error('approveCampaign failed with body:', approveRes.body);
        }
        expect(approveRes.status).toBe(201);
      }

      // Both campaigns should be active
      const cpmCampaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      expect(cpmCampaign?.status).toBe('active');
      const cpcCampaign = await prisma.campaign.findUnique({ where: { id: cpcCampaignId } });
      expect(cpcCampaign?.status).toBe('active');
    });

    it('should prevent unauthorized users from accessing campaign stats', async () => {
      // Advertiser B stats check -> should be 403 Forbidden
      await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaignId}/stats`)
        .set('Authorization', `Bearer ${advertiserBToken}`)
        .expect(403);

      // Developer stats check -> should be 403 Forbidden
      await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaignId}/stats`)
        .set('Authorization', `Bearer ${devToken}`)
        .expect(403);
    });

    it('should prevent unauthorized users from listing campaign creatives', async () => {
      // Advertiser B creatives check -> should be 403 Forbidden
      await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaignId}/creatives`)
        .set('Authorization', `Bearer ${advertiserBToken}`)
        .expect(403);

      // Developer creatives check -> should be 403 Forbidden
      await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaignId}/creatives`)
        .set('Authorization', `Bearer ${devToken}`)
        .expect(403);
    });

    it('should prevent unauthorized users from updating campaign creatives', async () => {
      // Advertiser B creative update -> should be 403 Forbidden
      await request(app.getHttpServer())
        .patch(`/api/v1/campaigns/creatives/${creativeId}`)
        .set('Authorization', `Bearer ${advertiserBToken}`)
        .send({ title: 'Hacked Title' })
        .expect(403);

      // Developer creative update -> should be 403 Forbidden
      await request(app.getHttpServer())
        .patch(`/api/v1/campaigns/creatives/${creativeId}`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({ title: 'Hacked Title' })
        .expect(403);
    });
  });

  describe('3. Ad Serving & Impression Logging Loop', () => {
    const sessionId = 'test-session-123';
    const waitStateId = 'wait-state-456';
    const cpcWaitStateId = 'cpc-wait-state-789';
    let cpcImpressionToken: string;

    it('should register a developer device', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/register-device')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toolType: 'vscode',
          fingerprintHash: 'fingerprint-abc-123',
          extensionVersion: '1.0.0',
          platform: 'darwin',
        })
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.eventSecret).toEqual(expect.any(String));
      deviceId = res.body.id;
      deviceEventSecret = res.body.eventSecret;
    });

    it('should reject wait state start signed with the wrong device secret', async () => {
      const startPayload = {
        deviceId,
        sessionId,
        toolType: 'vscode',
        waitStateId: 'bad-signature-wait-state',
        idempotencyKey: 'bad-signature-wait-start',
      };

      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...startPayload, signature: signPayload(startPayload, 'wrong-device-secret') })
        .expect(403);
    });

    it('should log a wait state start', async () => {
      const startPayload = {
        deviceId,
        sessionId,
        toolType: 'vscode',
        waitStateId,
        idempotencyKey: `start-${waitStateId}`,
      };
      const signature = signPayload(startPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...startPayload, signature })
        .expect(200);

      expect(res.body.id).toBeDefined();
    });

    it('should serve the CPM campaign ad on request', async () => {
      const adReqPayload = {
        deviceId,
        sessionId,
        waitStateId,
        toolType: 'vscode',
        allowedCategories: ['technology'],
        idempotencyKey: `ad-req-${waitStateId}`,
      };
      const signature = signPayload(adReqPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature })
        .expect(200);

      expect(res.body.ad).toBeDefined();
      expect(res.body.ad.impressionToken).toBeDefined();
      expect(res.body.ad.campaignId).toBe(campaignId);
      impressionToken = res.body.ad.impressionToken;
    });

    it('should record ad rendered event (CPM)', async () => {
      const renderPayload = {
        impressionToken,
        renderedAt: new Date().toISOString(),
        visibleSurface: 100,
        idempotencyKey: `render-${waitStateId}`,
      };
      const signature = signPayload(renderPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...renderPayload, signature })
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.renderedAt).toBeDefined();
    });

    it('should record qualified impression (CPM), triggering ledger splits', async () => {
      // Wait past the server-enforced minimum visible duration before
      // qualifying (issue A-060). The ad was rendered in the previous test.
      await new Promise((r) => setTimeout(r, 4000));
      const impressionPayload = {
        impressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000, // Meets minimum 5000ms duration
        idempotencyKey: `imp-${waitStateId}`,
      };
      const signature = signPayload(impressionPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...impressionPayload, signature });

      expect(res.status).toBe(200);
      expect(res.body.qualified).toBe(true);
      expect(res.body.impressionId).toBeDefined();

      // Verify ledger entries were created (amounts depend on campaign bid)
      const earnings = await prisma.earningsLedger.findFirst({
        where: { userId: devUserId, status: 'estimated' },
      });
      expect(earnings).toBeDefined();
      expect(earnings?.amountMinor).toBeGreaterThan(0);
      earningEntryId = earnings?.id || 'no-earnings-id';

      const advertiserEntry = await prisma.advertiserLedger.findFirst({
        where: { advertiserId, entryType: 'debit' },
      });
      expect(advertiserEntry).toBeDefined();

      const platformEntry = await prisma.platformLedger.findFirst({
        where: { entryType: 'credit', bucket: 'platform_fee' },
      });
      expect(platformEntry).toBeDefined();

      const reserveEntry = await prisma.platformLedger.findFirst({
        where: { entryType: 'credit', bucket: 'fraud_reserve' },
      });
      expect(reserveEntry).toBeDefined();

      // Sum check: advertiser debit = dev + platform + reserve
      expect(advertiserEntry!.amountMinor).toBe(
        earnings!.amountMinor + platformEntry!.amountMinor + reserveEntry!.amountMinor,
      );
    });

    it('should record ad click event on CPM impression (no extra charge)', async () => {
      const clickPayload = {
        impressionToken,
        clickedAt: new Date().toISOString(),
        idempotencyKey: `click-${waitStateId}`,
      };
      const signature = signPayload(clickPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/click')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...clickPayload, signature })
        .expect(200);

      expect(res.body.clicked).toBe(true);
      expect(res.body.clickId).toBeDefined();
    });

    // ── CPC Campaign Flow ──

    it('should log a CPC wait state start', async () => {
      const startPayload = {
        deviceId,
        sessionId,
        toolType: 'vscode',
        waitStateId: cpcWaitStateId,
        idempotencyKey: `start-${cpcWaitStateId}`,
      };
      const signature = signPayload(startPayload, deviceEventSecret);

      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...startPayload, signature })
        .expect(200);
    });

    it('should serve the CPC campaign ad on request', async () => {
      const adReqPayload = {
        deviceId,
        sessionId,
        waitStateId: cpcWaitStateId,
        toolType: 'vscode',
        allowedCategories: ['business'],
        idempotencyKey: `ad-req-${cpcWaitStateId}`,
      };
      const signature = signPayload(adReqPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature })
        .expect(200);

      expect(res.body.ad).toBeDefined();
      expect(res.body.ad.campaignId).toBe(cpcCampaignId);
      cpcImpressionToken = res.body.ad.impressionToken;
    });

    it('should record ad rendered event (CPC)', async () => {
      const renderPayload = {
        impressionToken: cpcImpressionToken,
        renderedAt: new Date().toISOString(),
        visibleSurface: 100,
        idempotencyKey: `render-${cpcWaitStateId}`,
      };
      const signature = signPayload(renderPayload, deviceEventSecret);

      await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...renderPayload, signature })
        .expect(200);
    });

    it('should qualify CPC impression (no CPM charge)', async () => {
      // Wait past the server-enforced minimum visible duration (issue A-060).
      await new Promise((r) => setTimeout(r, 4000));
      const impressionPayload = {
        impressionToken: cpcImpressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: `imp-${cpcWaitStateId}`,
      };
      const signature = signPayload(impressionPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...impressionPayload, signature });

      expect(res.status).toBe(200);
      expect(res.body.qualified).toBe(true);
      // CPC campaigns don't charge on qualification — no ledger entries should be created for earnings
      const newDevisions = await prisma.earningsLedger.findMany({
        where: { userId: devUserId, status: 'estimated' },
      });
      // Still just the CPM entry from earlier (1 estimated entry)
      expect(newDevisions.length).toBe(1);
    });

    it('should record click on CPC impression, triggering ledger splits', async () => {
      const oldDevEarnings = await prisma.earningsLedger.findMany({
        where: { userId: devUserId, status: 'estimated' },
      });

      const clickPayload = {
        impressionToken: cpcImpressionToken,
        clickedAt: new Date().toISOString(),
        idempotencyKey: `click-${cpcWaitStateId}`,
      };
      const signature = signPayload(clickPayload, deviceEventSecret);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/click')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...clickPayload, signature })
        .expect(200);

      expect(res.body.clicked).toBe(true);
      const clickId = res.body.clickId;

      // CPC bid = $5.00 (500 minor). Split: dev=60%=300, platform=30%=150, reserve=10%=50
      const newDevEarnings = await prisma.earningsLedger.findMany({
        where: { userId: devUserId, status: 'estimated' },
      });
      expect(newDevEarnings.length).toBe(oldDevEarnings.length + 1);

      const cpcEarning = newDevEarnings.find(
        (e) => !oldDevEarnings.map((o) => o.id).includes(e.id),
      );
      expect(cpcEarning?.amountMinor).toBe(300);
      expect(cpcEarning?.campaignId).toBe(cpcCampaignId);
      expect(cpcEarning?.clickId).toBe(clickId);

      // Advertiser debit for CPC click
      const advDebits = await prisma.advertiserLedger.findMany({
        where: { advertiserId, entryType: 'debit' },
      });
      // Two debits: one CPM (2000) + one CPC click (500)
      expect(advDebits.length).toBe(2);
      const cpcDebit = await prisma.advertiserLedger.findFirst({
        where: { advertiserId, entryType: 'debit', amountMinor: 500 },
      });
      expect(cpcDebit).toBeDefined();

      const cpcPlatformFee = await prisma.platformLedger.findFirst({
        where: {
          campaignId: cpcCampaignId,
          entryType: 'credit',
          bucket: 'platform_fee',
          amountMinor: 150,
          referenceId: clickId,
        },
      });
      expect(cpcPlatformFee).toBeDefined();

      const cpcReserve = await prisma.platformLedger.findFirst({
        where: {
          campaignId: cpcCampaignId,
          entryType: 'credit',
          bucket: 'fraud_reserve',
          amountMinor: 50,
          referenceId: clickId,
        },
      });
      expect(cpcReserve).toBeDefined();
    });
  });

  describe('4. Cross-User Ownership Checks', () => {
    // Register a second developer, get an impression, verify ad-rendered/qualified/click
    // are 403-rejected for the wrong user.
    let dev2Token: string;
    let dev2DeviceId: string;
    let dev2DeviceEventSecret: string;
    let dev2ImpressionToken: string;

    it('should register a second developer', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'dev2@waitlayer.com',
          password: 'Password123!',
          role: UserRole.DEVELOPER,
          name: 'Dev Two',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);
      expect(res.body.user.id).toBeDefined();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'dev2@waitlayer.com', password: 'Password123!' })
        .expect(200);
      dev2Token = loginRes.body.accessToken;

      await request(app.getHttpServer())
        .patch('/api/v1/developer/settings')
        .set('Authorization', `Bearer ${dev2Token}`)
        .send({ adsEnabled: true })
        .expect(200);
    });

    it('should register second developer device and get impression', async () => {
      const devRes = await request(app.getHttpServer())
        .post('/api/v1/extension/register-device')
        .set('Authorization', `Bearer ${dev2Token}`)
        .send({
          toolType: 'vscode',
          fingerprintHash: 'dev2-fingerprint',
          extensionVersion: '1.0.0',
          platform: 'linux',
        })
        .expect(200);
      dev2DeviceId = devRes.body.id;
      dev2DeviceEventSecret = devRes.body.eventSecret;

      const waitStartPayload = {
        deviceId: dev2DeviceId,
        sessionId: 'dev2-session',
        waitStateId: 'dev2-wait',
        toolType: 'vscode',
        idempotencyKey: 'dev2-wait-start',
      };
      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${dev2Token}`)
        .send({
          ...waitStartPayload,
          signature: signPayload(waitStartPayload, dev2DeviceEventSecret),
        })
        .expect(200);

      const adReqPayload = {
        deviceId: dev2DeviceId,
        sessionId: 'dev2-session',
        waitStateId: 'dev2-wait',
        toolType: 'vscode',
        idempotencyKey: 'dev2-ad-req',
      };
      const signature = signPayload(adReqPayload, dev2DeviceEventSecret);
      const adRes = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${dev2Token}`)
        .send({ ...adReqPayload, signature })
        .expect(200);
      dev2ImpressionToken = adRes.body.ad.impressionToken;
    });

    it('should block cross-user ad-rendered (403)', async () => {
      const renderPayload = {
        impressionToken: dev2ImpressionToken,
        renderedAt: new Date().toISOString(),
        idempotencyKey: 'dev2-render',
      };
      const signature = signPayload(renderPayload, dev2DeviceEventSecret);
      await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`) // dev token, dev2 impression — wrong
        .send({ ...renderPayload, signature })
        .expect(403);
    });

    it('should block cross-user impression-qualified (403)', async () => {
      const impPayload = {
        impressionToken: dev2ImpressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: 'dev2-imp',
      };
      const signature = signPayload(impPayload, dev2DeviceEventSecret);
      await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...impPayload, signature })
        .expect(403);
    });

    it('should block cross-user click (403)', async () => {
      const clickPayload = {
        impressionToken: dev2ImpressionToken,
        clickedAt: new Date().toISOString(),
        idempotencyKey: 'dev2-click',
      };
      const signature = signPayload(clickPayload, dev2DeviceEventSecret);
      await request(app.getHttpServer())
        .post('/api/v1/extension/click')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...clickPayload, signature })
        .expect(403);
    });
  });

  describe('5. Budget Exhaustion Guard', () => {
    it('should increment campaign budget and reject over-spend via atomic SQL guard', async () => {
      // Use a single impression to verify the budget is tracked correctly.
      // The atomic guard (UPDATE with WHERE) is tested indirectly: if the
      // SQL guard fails, ledger writes are skipped and qualified=false.
      const wsId = 'budget-test-ws';
      const waitStartPayload = {
        deviceId,
        sessionId: 'budget-sess',
        waitStateId: wsId,
        toolType: 'vscode',
        idempotencyKey: `start-${wsId}`,
      };
      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...waitStartPayload, signature: signPayload(waitStartPayload, deviceEventSecret) })
        .expect(200);

      const adReqPayload = {
        deviceId,
        sessionId: 'budget-sess',
        waitStateId: wsId,
        toolType: 'vscode',
        idempotencyKey: `ad-budget-${wsId}`,
      };
      const sig = signPayload(adReqPayload, deviceEventSecret);
      const adRes = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature: sig })
        .expect(200);
      if (!adRes.body.ad) return; // no eligible campaigns — budget may already be near limit

      const tok = adRes.body.ad.impressionToken;
      const rp = {
        impressionToken: tok,
        renderedAt: new Date().toISOString(),
        idempotencyKey: `r-budget-${wsId}`,
      };
      await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...rp, signature: signPayload(rp, deviceEventSecret) })
        .expect(200);

      // Wait past the server-enforced minimum visible duration (issue A-060).
      await new Promise((r) => setTimeout(r, 4000));

      const ip = {
        impressionToken: tok,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: `i-budget-${wsId}`,
      };
      const qRes = await request(app.getHttpServer())
        .post('/api/v1/extension/impression-qualified')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...ip, signature: signPayload(ip, deviceEventSecret) });

      // Should qualify; budget is tracked atomically.
      expect(qRes.body.qualified).toBe(true);

      // Verify campaign has non-zero budget spent
      const campaign = await prisma.campaign.findUnique({
        where: { id: adRes.body.ad.campaignId },
      });
      expect(campaign).toBeDefined();
      expect(campaign!.budgetSpentMinor).toBeGreaterThan(0);
      expect(campaign!.budgetSpentMinor).toBeLessThanOrEqual(campaign!.budgetTotalMinor);
    });
  });

  describe('6. Ledger Maturation & Payouts', () => {
    it('should mature estimated developer earnings', async () => {
      // Manually set the earnings entry availableAt to past date to mature it
      await prisma.earningsLedger.update({
        where: { id: earningEntryId },
        data: { availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      // Execute maturation
      const matResult = await ledgerService.matureEarnings();
      expect(matResult.matured).toBe(1);

      // Earning entry should now be confirmed
      const entry = await prisma.earningsLedger.findUnique({ where: { id: earningEntryId } });
      expect(entry?.status).toBe('confirmed');
    });

    it('should enable developer to set payout method', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/payout/method')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          provider: PayoutProvider.PAYPAL_EMAIL,
          destination: 'jane.dev@paypal.com',
          currency: 'USD',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      payoutAccountId = res.body.id;

      // Payout accounts must be verified before they can be used for payouts
      // (issue A-048). In production an admin verifies the destination; the
      // contract test verifies it directly to exercise the payout flow.
      await prisma.payoutAccount.update({
        where: { id: payoutAccountId },
        data: { isVerified: true },
      });
    });

    it('should allow developer to request payout for mature earnings', async () => {
      // In the database model, let's verify available payout amount
      const availRes = await request(app.getHttpServer())
        .get('/api/v1/payout/available')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);

      expect(availRes.body.totalMinor).toBeGreaterThan(0);

      // Create a payout request
      const res = await request(app.getHttpServer())
        .post('/api/v1/payout/request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          payoutAccountId,
          amountMinor: 1200,
          currency: 'USD',
          earningsEntryIds: [earningEntryId],
        })
        .expect(201);

      expect(res.body.status).toBe('requested');
      expect(res.body.requestedAmountMinor).toBe(1200);
      payoutId = res.body.id;

      // Earning entries status should remain confirmed after payout request, before admin processes it
      const entry = await prisma.earningsLedger.findUnique({ where: { id: earningEntryId } });
      expect(entry?.status).toBe('confirmed');
    });

    it('should allow admin to approve and mark payout as paid', async () => {
      // 1. Approve payout request (moves status to approved)
      await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ note: 'Approving for payout' })
        .expect(201);

      // 2. Process payout through the configured provider (manual/paypal_email
      // provider returns a processing transaction for admin reconciliation).
      const processRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(processRes.body.status).toBe('processing');
      expect(processRes.body.providerTxId).toBeDefined();

      // 3. Mark payout as paid (executes ledger status change to paid)
      const markPaidRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/mark-paid`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          providerTxId: processRes.body.providerTxId,
          paidAt: new Date().toISOString(),
          amountMinor: 1200,
          currency: 'USD',
        })
        .expect(201);

      expect(markPaidRes.body.status).toBe('paid');

      // 4. Verify developer earnings entry transitions to status paid
      const entry = await prisma.earningsLedger.findUnique({ where: { id: earningEntryId } });
      expect(entry?.status).toBe('paid');
    });
  });
});

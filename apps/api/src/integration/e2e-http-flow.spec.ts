import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma.service';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { UserRole, BidType, PayoutProvider } from '@waitlayer/shared';
import { signPayload } from '@waitlayer/shared';
import { LedgerService } from '../ledger/ledger.service';

const HMAC_SECRET = 'dev-secret-change-me';

async function cleanDb(prisma: PrismaService) {
  // Truncate tables to ensure a clean test run without foreign key violations
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

describe('End-to-End HTTP Integration Flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledgerService: LedgerService;

  beforeAll(async () => {
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
    ledgerService = app.get(LedgerService);
    await cleanDb(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanDb(prisma);
    }
    if (app) {
      await app.close();
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
  let deviceId: string;
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
          password: 'password123',
          role: UserRole.DEVELOPER,
          name: 'Jane Developer',
          country: 'US',
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
          password: 'password123',
          role: UserRole.ADVERTISER,
          name: 'Big Brand Co',
          country: 'US',
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
          password: 'password123',
          role: UserRole.ADVERTISER,
          name: 'Alternative Advertiser',
          country: 'US',
        })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('advertiser');
      advertiserBToken = res.body.accessToken;
    });

    it('should successfully register an admin user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'admin@waitlayer.com',
          password: 'password123',
          role: UserRole.ADMIN,
          name: 'Super Admin',
          country: 'US',
        })
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('admin');
    });

    let firstDevRefreshToken: string;

    it('should authenticate registered users to obtain tokens', async () => {
      // Developer Login
      const devRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'dev@waitlayer.com', password: 'password123' })
        .expect(200);
      devToken = devRes.body.accessToken;
      firstDevRefreshToken = devRes.body.refreshToken;

      // Admin Login
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@waitlayer.com', password: 'password123' })
        .expect(200);
      adminToken = adminRes.body.accessToken;

      // Advertiser B Login
      const advBRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'adv-b@waitlayer.com', password: 'password123' })
        .expect(200);
      advertiserBToken = advBRes.body.accessToken;
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
        .send({ email: 'dev@waitlayer.com', password: 'password123' })
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
  });

  describe('2. Campaign Creation & Approval Flow', () => {
    let cpcCampaignId: string;
    let cpcCreativeId: string;

    it('should create an advertiser profile automatically', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/advertiser/profile')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      advertiserId = res.body.id;
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
          category: 'technology',
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
      deviceId = res.body.id;
    });

    it('should log a wait state start', async () => {
      const startPayload = {
        deviceId,
        sessionId,
        toolType: 'vscode',
        waitStateId,
        idempotencyKey: `start-${waitStateId}`,
      };
      const signature = signPayload(startPayload, HMAC_SECRET);

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
        idempotencyKey: `ad-req-${waitStateId}`,
      };
      const signature = signPayload(adReqPayload, HMAC_SECRET);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature })
        .expect(200);

      expect(res.body.ad).toBeDefined();
      expect(res.body.ad.impressionToken).toBeDefined();
      // Either CPM or CPC campaign may be selected (weighted random).
      expect([campaignId, cpcCampaignId]).toContain(res.body.ad.campaignId);
      impressionToken = res.body.ad.impressionToken;
    });

    it('should record ad rendered event (CPM)', async () => {
      const renderPayload = {
        impressionToken,
        renderedAt: new Date().toISOString(),
        visibleSurface: 100,
        idempotencyKey: `render-${waitStateId}`,
      };
      const signature = signPayload(renderPayload, HMAC_SECRET);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...renderPayload, signature })
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.renderedAt).toBeDefined();
    });

    it('should record qualified impression (CPM), triggering ledger splits', async () => {
      const impressionPayload = {
        impressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000, // Meets minimum 5000ms duration
        idempotencyKey: `imp-${waitStateId}`,
      };
      const signature = signPayload(impressionPayload, HMAC_SECRET);

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
      const signature = signPayload(clickPayload, HMAC_SECRET);

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
      const signature = signPayload(startPayload, HMAC_SECRET);

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
        idempotencyKey: `ad-req-${cpcWaitStateId}`,
      };
      const signature = signPayload(adReqPayload, HMAC_SECRET);

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
      const signature = signPayload(renderPayload, HMAC_SECRET);

      await request(app.getHttpServer())
        .post('/api/v1/extension/ad-rendered')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...renderPayload, signature })
        .expect(200);
    });

    it('should qualify CPC impression (no CPM charge)', async () => {
      const impressionPayload = {
        impressionToken: cpcImpressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: `imp-${cpcWaitStateId}`,
      };
      const signature = signPayload(impressionPayload, HMAC_SECRET);

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
      const signature = signPayload(clickPayload, HMAC_SECRET);

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/click')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...clickPayload, signature })
        .expect(200);

      expect(res.body.clicked).toBe(true);

      // CPC bid = $5.00 (500 minor). Split: dev=60%=300, platform=30%=150, reserve=10%=50
      const newDevEarnings = await prisma.earningsLedger.findMany({
        where: { userId: devUserId, status: 'estimated' },
      });
      expect(newDevEarnings.length).toBe(oldDevEarnings.length + 1);

      const cpcEarning = newDevEarnings.find(e => !oldDevEarnings.map(o => o.id).includes(e.id));
      expect(cpcEarning?.amountMinor).toBe(300);

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
    });
  });

  describe('4. Cross-User Ownership Checks', () => {
    // Register a second developer, get an impression, verify ad-rendered/qualified/click
    // are 403-rejected for the wrong user.
    let dev2Token: string;
    let dev2UserId: string;
    let dev2DeviceId: string;
    let dev2ImpressionToken: string;

    it('should register a second developer', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'dev2@waitlayer.com',
          password: 'password123',
          role: UserRole.DEVELOPER,
          name: 'Dev Two',
          country: 'US',
        })
        .expect(201);
      dev2UserId = res.body.user.id;

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'dev2@waitlayer.com', password: 'password123' })
        .expect(200);
      dev2Token = loginRes.body.accessToken;
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

      const adReqPayload = {
        deviceId: dev2DeviceId,
        sessionId: 'dev2-session',
        waitStateId: 'dev2-wait',
        toolType: 'vscode',
        idempotencyKey: 'dev2-ad-req',
      };
      const signature = signPayload(adReqPayload, HMAC_SECRET);
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
      const signature = signPayload(renderPayload, HMAC_SECRET);
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
      const signature = signPayload(impPayload, HMAC_SECRET);
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
      const signature = signPayload(clickPayload, HMAC_SECRET);
      await request(app.getHttpServer())
        .post('/api/v1/extension/click')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...clickPayload, signature })
        .expect(403);
    });
  });

  describe('5. Budget Exhaustion Guard', () => {
    it('should exhaust CPM campaign budget and reject next qualified impression', async () => {
      // Current campaign: CPM bid 2000, total budget 50000, already spent 2000 → remaining 48000
      // Qualify 24 more impressions at 2000 each = 48000 → exhaust
      for (let i = 0; i < 24; i++) {
        const wsId = `ws-${i}`;
        // ad-request
        const adReqPayload = { deviceId, sessionId: `s-${i}`, waitStateId: wsId, toolType: 'vscode', idempotencyKey: `ad-${wsId}` };
        const sig = signPayload(adReqPayload, HMAC_SECRET);
        const adRes = await request(app.getHttpServer())
          .post('/api/v1/extension/ad-request')
          .set('Authorization', `Bearer ${devToken}`)
          .send({ ...adReqPayload, signature: sig })
          .expect(200);
        const t = adRes.body.ad.impressionToken;

        // rendered
        const rp = { impressionToken: t, renderedAt: new Date().toISOString(), idempotencyKey: `r-${wsId}` };
        await request(app.getHttpServer()).post('/api/v1/extension/ad-rendered')
          .set('Authorization', `Bearer ${devToken}`)
          .send({ ...rp, signature: signPayload(rp, HMAC_SECRET) })
          .expect(200);

        // qualified (CPM charge)
        const ip = { impressionToken: t, qualifiedAt: new Date().toISOString(), visibleDurationMs: 6000, idempotencyKey: `i-${wsId}` };
        await request(app.getHttpServer()).post('/api/v1/extension/impression-qualified')
          .set('Authorization', `Bearer ${devToken}`)
          .send({ ...ip, signature: signPayload(ip, HMAC_SECRET) });
      }

      // Now budget should be 50000 → request one more ad should fail (no eligible)
      const adReqPayload = { deviceId, sessionId: 'final', waitStateId: 'final-ws', toolType: 'vscode', idempotencyKey: 'final-ad' };
      const sig = signPayload(adReqPayload, HMAC_SECRET);
      const adRes = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature: sig })
        .expect(200);
      // No eligible campaign → ad=null
      expect(adRes.body.ad).toBeNull();
      expect(adRes.body.reason).toBe('no_eligible_campaign');
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

      // 2. Mark payout as paid (executes ledger status change to paid)
      const markPaidRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/mark-paid`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          providerTxId: 'tx-paypal-12345',
          paidAt: new Date().toISOString(),
          amountMinor: 1200,
          currency: 'USD',
        })
        .expect(201);

      expect(markPaidRes.body.status).toBe('paid');

      // 3. Verify developer earnings entry transitions to status paid
      const entry = await prisma.earningsLedger.findUnique({ where: { id: earningEntryId } });
      expect(entry?.status).toBe('paid');
    });
  });
});

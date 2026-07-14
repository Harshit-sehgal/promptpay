import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { BidType, signPayload, UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';

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
      "webhook_events", "audit_logs", "referrals", "referral_rewards",
      "system_settings"
    CASCADE;
  `);
}

describe('Runtime Kill Switches', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let runtimeConfig: RuntimeConfigService;
  let previousRedisUrl: string | undefined;

  beforeAll(async () => {
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
    runtimeConfig = app.get(RuntimeConfigService);
    await cleanDb(prisma);

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

  let adminToken: string;
  let devToken: string;
  let advertiserToken: string;
  let deviceId: string;
  let deviceEventSecret: string;

  beforeAll(async () => {
    const adminRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@waitlayer.com', password: 'Password123!' })
      .expect(200);
    adminToken = adminRes.body.accessToken;
  });

  afterEach(async () => {
    await prisma.systemSetting.deleteMany();
  });

  describe('enforcement points', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'dev-kill@waitlayer.com',
          password: 'Password123!',
          role: UserRole.DEVELOPER,
          name: 'Kill Switch Dev',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);

      const devRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'dev-kill@waitlayer.com', password: 'Password123!' })
        .expect(200);
      devToken = devRes.body.accessToken;

      await request(app.getHttpServer())
        .patch('/api/v1/developer/settings')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ adsEnabled: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          email: 'adv-kill@waitlayer.com',
          password: 'Password123!',
          role: UserRole.ADVERTISER,
          name: 'Kill Switch Advertiser',
          country: 'US',
          ageConfirmed: true,
          termsAccepted: true,
        })
        .expect(201);

      const advRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'adv-kill@waitlayer.com', password: 'Password123!' })
        .expect(200);
      advertiserToken = advRes.body.accessToken;

      const regRes = await request(app.getHttpServer())
        .post('/api/v1/extension/register-device')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toolType: 'vscode',
          fingerprintHash: 'kill-switch-fingerprint',
          extensionVersion: '1.0.0',
          platform: 'darwin',
        })
        .expect(200);
      deviceId = regRes.body.id;
      deviceEventSecret = regRes.body.eventSecret;
    });

    it('rejects device registration when extension version is below minimum', async () => {
      await runtimeConfig.setString(
        { scope: 'extension', target: 'min_version' },
        '2.0.0',
        'admin-test',
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/register-device')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toolType: 'vscode',
          fingerprintHash: 'low-version-fingerprint',
          extensionVersion: '1.9.9',
          platform: 'darwin',
        })
        .expect(403);

      expect(res.body.message).toMatch(/version/i);

      await runtimeConfig.setString(
        { scope: 'extension', target: 'min_version' },
        '',
        'admin-test',
      );
    });

    it('rejects device registration when tool integration is blocked', async () => {
      await runtimeConfig.setStringArray(
        { scope: 'tools', target: 'blocked' },
        ['vscode'],
        'admin-test',
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/register-device')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toolType: 'vscode',
          fingerprintHash: 'blocked-tool-fingerprint',
          extensionVersion: '1.0.0',
          platform: 'darwin',
        })
        .expect(403);

      expect(res.body.message).toMatch(/tool|blocked/i);

      await runtimeConfig.setStringArray({ scope: 'tools', target: 'blocked' }, [], 'admin-test');
    });

    it('returns no ad when global ads are disabled', async () => {
      await runtimeConfig.setBoolean({ scope: 'ads', target: 'global' }, false, 'admin-test');

      const waitStartPayload = {
        deviceId,
        sessionId: 'kill-sess',
        waitStateId: 'kill-ws',
        toolType: 'vscode',
        idempotencyKey: 'kill-wait-start',
      };
      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          ...waitStartPayload,
          signature: signPayload(waitStartPayload, deviceEventSecret),
        })
        .expect(200);

      const adReqPayload = {
        deviceId,
        sessionId: 'kill-sess',
        waitStateId: 'kill-ws',
        toolType: 'vscode',
        idempotencyKey: 'kill-ad-req',
      };
      const signature = signPayload(adReqPayload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature })
        .expect(200);

      expect(res.body.ad).toBeNull();

      await runtimeConfig.setBoolean({ scope: 'ads', target: 'global' }, true, 'admin-test');
    });

    it('rejects deposit session creation when deposits are disabled', async () => {
      await runtimeConfig.setBoolean({ scope: 'deposits', target: 'global' }, false, 'admin-test');

      const res = await request(app.getHttpServer())
        .post('/api/v1/advertiser/deposit-session')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({
          amountMinor: '10000',
          currency: 'usd',
        })
        .expect(400);

      expect(res.body.message).toMatch(/deposit/i);
    });

    it('rejects campaign creation when currency is blocked', async () => {
      await runtimeConfig.setStringArray(
        { scope: 'currencies', target: 'blocked' },
        ['EUR'],
        'admin-test',
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/advertiser/campaigns')
        .set('Authorization', `Bearer ${advertiserToken}`)
        .send({
          name: 'EUR Campaign',
          category: 'technology',
          bidType: BidType.CPM,
          currency: 'EUR',
          bidAmountMinor: 2000,
          budgetTotalMinor: 50000,
        })
        .expect(400);

      expect(res.body.message).toMatch(/currency/i);

      await runtimeConfig.setStringArray(
        { scope: 'currencies', target: 'blocked' },
        [],
        'admin-test',
      );
    });

    it('rejects payout requests when payouts are disabled', async () => {
      await runtimeConfig.setBoolean({ scope: 'payouts', target: 'requests' }, false, 'admin-test');

      const res = await request(app.getHttpServer())
        .post('/api/v1/payout/request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          payoutAccountId: '00000000-0000-0000-0000-000000000000',
          amountMinor: 1000,
          currency: 'USD',
          earningsEntryIds: [],
        })
        .expect(400);

      expect(res.body.message).toMatch(/payout/i);
    });

    it('excludes blocked providers from provider availability list', async () => {
      await runtimeConfig.setStringArray(
        { scope: 'payouts', target: 'providers.blocked' },
        ['paypal_email'],
        'admin-test',
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/payout/providers')
        .set('Authorization', `Bearer ${devToken}`)
        .expect(200);

      const providers = res.body.providers as Array<{
        provider: string;
        status: string;
        reason?: string;
      }>;
      const paypal = providers.find((p) => p.provider === 'paypal_email');
      expect(paypal?.status).toBe('coming_soon');
      expect(paypal?.reason).toMatch(/disabled/i);
    });

    it('rejects payout method creation for a blocked provider', async () => {
      await runtimeConfig.setStringArray(
        { scope: 'payouts', target: 'providers.blocked' },
        ['paypal_email'],
        'admin-test',
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/payout/method')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          provider: 'paypal_email',
          destination: 'test@example.com',
          currency: 'USD',
        })
        .expect(400);

      expect(res.body.message).toMatch(/provider|blocked/i);

      await runtimeConfig.setStringArray(
        { scope: 'payouts', target: 'providers.blocked' },
        [],
        'admin-test',
      );
    });

    it('rejects ad request when country is blocked', async () => {
      await runtimeConfig.setStringArray(
        { scope: 'countries', target: 'blocked' },
        ['US'],
        'admin-test',
      );

      const waitStartPayload = {
        deviceId,
        sessionId: 'country-sess',
        waitStateId: 'country-ws',
        toolType: 'vscode',
        idempotencyKey: 'country-wait-start',
      };
      await request(app.getHttpServer())
        .post('/api/v1/extension/wait-state/start')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          ...waitStartPayload,
          signature: signPayload(waitStartPayload, deviceEventSecret),
        })
        .expect(200);

      const adReqPayload = {
        deviceId,
        sessionId: 'country-sess',
        waitStateId: 'country-ws',
        toolType: 'vscode',
        idempotencyKey: 'country-ad-req',
      };
      const signature = signPayload(adReqPayload, deviceEventSecret);
      const res = await request(app.getHttpServer())
        .post('/api/v1/extension/ad-request')
        .set('Authorization', `Bearer ${devToken}`)
        .send({ ...adReqPayload, signature })
        .expect(200);

      expect(res.body.ad).toBeNull();
    });

    it('toggles a runtime switch through the admin endpoint and audits the change', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/settings/ads/global/toggle')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false, reason: 'maintenance' })
        .expect(201);

      expect(res.body.scope).toBe('ads');
      expect(res.body.target).toBe('global');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'update_system_setting', targetId: 'ads.global' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeDefined();
      expect((audit?.afterSnap as { enabled?: boolean })?.enabled).toBe(false);
    });
  });
});

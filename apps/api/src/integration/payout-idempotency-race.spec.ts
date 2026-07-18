import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
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

describe('Payout idempotency race (DB-backed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previousRedisUrl: string | undefined;
  let devToken: string;
  let devUserId: string;
  let payoutAccountId: string;
  let earningEntryId: string;

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
      .overrideGuard(ActionStepUpGuard)
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

  it('sets up a developer with confirmed earnings and a verified payout account', async () => {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'dev-race@waitlayer.com',
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Race Developer',
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    devUserId = signupRes.body.user.id;

    // Payout requests require a verified email. Skip the email flow and set
    // the flag directly so the race focuses on the idempotency path.
    await prisma.user.update({
      where: { id: devUserId },
      data: { emailVerified: true },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'dev-race@waitlayer.com', password: 'Password123!' })
      .expect(200);
    devToken = loginRes.body.accessToken;

    // Seed a confirmed earnings entry directly; the maturation cron is not
    // part of this test.
    const earning = await prisma.earningsLedger.create({
      data: {
        userId: devUserId,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: 5000n,
        currency: 'USD',
        availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        idempotencyKey: 'payout-race-earnings',
        description: 'Confirmed earnings for idempotency race test',
      },
    });
    earningEntryId = earning.id;

    const payoutAccountRes = await request(app.getHttpServer())
      .post('/api/v1/payout/method')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        provider: 'paypal_email',
        destination: 'race.dev@paypal.com',
        currency: 'USD',
      })
      .expect(201);
    payoutAccountId = payoutAccountRes.body.id;

    await prisma.payoutAccount.update({
      where: { id: payoutAccountId },
      data: { isVerified: true },
    });
  });

  it('creates exactly one payout request when two identical calls race', async () => {
    const payload = {
      payoutAccountId,
      amountMinor: 1200,
      currency: 'USD',
      earningsEntryIds: [earningEntryId],
      idempotencyKey: 'concurrent-payout-key',
    };

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/payout/request')
        .set('Authorization', `Bearer ${devToken}`)
        .send(payload),
      request(app.getHttpServer())
        .post('/api/v1/payout/request')
        .set('Authorization', `Bearer ${devToken}`)
        .send(payload),
    ]);

    // Both calls should succeed.
    expect([resA.status, resB.status]).toContain(201);
    expect(resA.status).toBe(resB.status);
    expect(resA.body.id).toBeDefined();
    expect(resA.body.id).toBe(resB.body.id);

    // Exactly one payout request row exists for this user + idempotency key.
    const payoutRequests = await prisma.payoutRequest.findMany({
      where: { userId: devUserId, idempotencyKey: 'concurrent-payout-key' },
    });
    expect(payoutRequests.length).toBe(1);
    expect(payoutRequests[0].requestedAmountMinor).toBe(1200n);
  });

  it('rejects a replay with a mismatched amount (409 Conflict)', async () => {
    // Use an amount that is still above the per-currency minimum so the
    // request reaches the service-level idempotency check (not the DTO
    // validation floor) and is rejected as a mismatched replay.
    const res = await request(app.getHttpServer())
      .post('/api/v1/payout/request')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        payoutAccountId,
        amountMinor: 1500,
        currency: 'USD',
        earningsEntryIds: [earningEntryId],
        idempotencyKey: 'concurrent-payout-key',
      });

    expect(res.status).toBe(409);
  });
});

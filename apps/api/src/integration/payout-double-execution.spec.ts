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
import { PayoutService } from '../payout/payout.service';

/**
 * DOUBLE PAYOUT — the invariant with the worst possible failure mode: two
 * workers executing the same payout means money leaves twice and only one
 * outflow is reconcilable.
 *
 * `processPayout` defends this with a CAS claim (`updateMany WHERE id = ? AND
 * status = 'approved'` as the first write in the transaction, aborting when
 * `count === 0`). That control existed and was reviewed, but nothing proved it
 * against a REAL database under REAL concurrency — the surrounding suites cover
 * the fence lifecycle and request-level idempotency, not simultaneous execution
 * of an already-approved payout.
 *
 * A mock cannot establish this: the guarantee comes from Postgres row locking
 * inside `$transaction`, which is exactly what a mocked Prisma client removes.
 */
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

describe('Payout double-execution safety (DB-backed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payoutService: PayoutService;
  let previousRedisUrl: string | undefined;
  let devToken: string;
  let devUserId: string;
  let adminToken: string;

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
    payoutService = app.get(PayoutService);
    await cleanDb(prisma);

    await prisma.systemSetting.upsert({
      where: { scope_target: { scope: 'payouts', target: 'requests' } },
      create: { scope: 'payouts', target: 'requests', value: { enabled: true } },
      update: { value: { enabled: true }, reason: 'isolated double-execution test' },
    });

    await prisma.user.create({
      data: {
        email: 'admin-double@waitlayer.com',
        passwordHash: await bcrypt.hash('Password123!', 12),
        name: 'Super Admin',
        role: UserRole.ADMIN,
        country: 'US',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanDb(prisma);
    if (app) await app.close();
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });

  async function seedApprovedPayout(amountMinor: number): Promise<string> {
    // A SHARED payout destination across users is a fraud signal that blocks
    // the request (checkSharedPayoutDestination). Give each seeded developer a
    // distinct destination so this suite exercises double-execution, not fraud.
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const devEmail = `dev-double-${suffix}@waitlayer.com`;
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: devEmail,
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Double Developer',
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    devUserId = signup.body.user.id;
    await prisma.user.update({ where: { id: devUserId }, data: { emailVerified: true } });

    devToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: devEmail, password: 'Password123!' })
        .expect(200)
    ).body.accessToken;
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin-double@waitlayer.com', password: 'Password123!' })
        .expect(200)
    ).body.accessToken;

    const account = await request(app.getHttpServer())
      .post('/api/v1/payout/method')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        provider: 'paypal_email',
        destination: `double.${suffix}@paypal.com`,
        currency: 'USD',
      })
      .expect(201);
    await prisma.payoutAccount.update({
      where: { id: account.body.id },
      data: { isVerified: true },
    });

    const earning = await prisma.earningsLedger.create({
      data: {
        userId: devUserId,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: BigInt(amountMinor),
        currency: 'USD',
        availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        idempotencyKey: `double-earnings-${suffix}`,
        description: 'Confirmed earnings for double-execution test',
      },
    });

    const payout = await request(app.getHttpServer())
      .post('/api/v1/payout/request')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        payoutAccountId: account.body.id,
        amountMinor,
        currency: 'USD',
        earningsEntryIds: [earning.id],
      });
    expect(
      payout.status,
      `payout request failed: ${payout.status} ${JSON.stringify(payout.body)}`,
    ).toBe(201);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payout.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Approve for double-execution test' })
      .expect(201);

    return payout.body.id;
  }

  it('executes an approved payout exactly once when two workers race it', async () => {
    const payoutId = await seedApprovedPayout(5000);

    // Count real provider initiations. This is the money-leaving-the-building
    // moment; if the CAS claim were absent this would be called twice.
    let initiations = 0;
    const providers = (payoutService as unknown as { providers: Record<string, unknown> })
      .providers;
    const original = providers['paypal_email'];
    providers['paypal_email'] = {
      readiness: () => ({ ok: true }),
      initiate: async () => {
        initiations += 1;
        // Hold the winner inside its transaction long enough that the loser is
        // guaranteed to attempt its own claim concurrently rather than after.
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { providerTxId: `pp_double_${initiations}`, status: 'processing' };
      },
      checkStatus: async () => ({ status: 'processing' }),
    };

    try {
      const results = await Promise.allSettled([
        request(app.getHttpServer())
          .post(`/api/v1/admin/payouts/${payoutId}/process`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app.getHttpServer())
          .post(`/api/v1/admin/payouts/${payoutId}/process`)
          .set('Authorization', `Bearer ${adminToken}`),
      ]);

      const statuses = results.map((r) =>
        r.status === 'fulfilled' ? (r.value as { status: number }).status : 0,
      );
      const accepted = statuses.filter((s) => s >= 200 && s < 300);
      const rejected = statuses.filter((s) => s >= 400);

      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    } finally {
      providers['paypal_email'] = original;
    }

    // THE invariant: the provider was asked to move money exactly once.
    expect(initiations).toBe(1);

    // And the ledger agrees — one transaction row, one payout row, and the
    // allocated earnings were not consumed twice.
    const transactions = await prisma.payoutTransaction.findMany({
      where: { payoutRequestId: payoutId },
    });
    expect(transactions).toHaveLength(1);

    const allocations = await prisma.payoutAllocation.findMany({
      where: { payoutRequestId: payoutId },
    });
    const allocatedTotal = allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n);
    expect(allocatedTotal).toBe(5000n);

    const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    expect(payout?.status).toBe('processing');
  });

  it('refuses a second execution attempt after the first has claimed the payout', async () => {
    const payoutId = await seedApprovedPayout(3000);

    let initiations = 0;
    const providers = (payoutService as unknown as { providers: Record<string, unknown> })
      .providers;
    const original = providers['paypal_email'];
    providers['paypal_email'] = {
      readiness: () => ({ ok: true }),
      initiate: async () => {
        initiations += 1;
        return { providerTxId: `pp_seq_${initiations}`, status: 'processing' };
      },
      checkStatus: async () => ({ status: 'processing' }),
    };

    try {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      // Sequential replay — a retried admin click, or a queue redelivery.
      const replay = await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/process`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(replay.status).toBeGreaterThanOrEqual(400);
      expect(String(replay.body.message)).toMatch(/cannot be processed from status/i);
    } finally {
      providers['paypal_email'] = original;
    }

    expect(initiations).toBe(1);
    expect(await prisma.payoutTransaction.count({ where: { payoutRequestId: payoutId } })).toBe(1);
  });
  // DOUBLE SPENDING — distinct from the replay case that
  // `payout-idempotency-race` covers. That suite races two calls carrying the
  // SAME idempotency key (a retry). This races two DIFFERENT requests that both
  // try to consume the SAME confirmed earnings, which is what two browser tabs
  // or a double-submit actually produce.
  //
  // `payout_allocations` carries `@@unique([earningsEntryId])`, so Postgres
  // makes it impossible for one earnings entry to fund two payouts. The open
  // question is whether the LOSER gets a clean refusal or an unhandled 500 —
  // an untranslated unique-constraint violation would leak a Prisma error to a
  // developer and look like a platform fault rather than "already claimed".
  it('lets only one of two competing requests consume the same earnings', async () => {
    const devEmail = `dev-spend-${Date.now()}${Math.random().toString(36).slice(2, 8)}@waitlayer.com`;
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: devEmail,
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Spend Developer',
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    const userId = signup.body.user.id;
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    const token = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: devEmail, password: 'Password123!' })
        .expect(200)
    ).body.accessToken;

    const account = await request(app.getHttpServer())
      .post('/api/v1/payout/method')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'paypal_email',
        destination: `spend.${Date.now()}@paypal.com`,
        currency: 'USD',
      })
      .expect(201);
    await prisma.payoutAccount.update({
      where: { id: account.body.id },
      data: { isVerified: true },
    });

    const earning = await prisma.earningsLedger.create({
      data: {
        userId,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: 4000n,
        currency: 'USD',
        availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        idempotencyKey: `spend-earnings-${Date.now()}`,
        description: 'Single confirmed entry two requests will compete for',
      },
    });

    // Distinct idempotency keys — these are genuinely different requests.
    const attempt = (key: string) =>
      request(app.getHttpServer())
        .post('/api/v1/payout/request')
        .set('Authorization', `Bearer ${token}`)
        .send({
          payoutAccountId: account.body.id,
          amountMinor: 4000,
          currency: 'USD',
          earningsEntryIds: [earning.id],
          idempotencyKey: key,
        });

    const results = await Promise.all([attempt('spend-key-a'), attempt('spend-key-b')]);
    const statuses = results.map((r) => r.status).sort();

    // Exactly one wins. The other must fail CLEANLY — a 5xx here would mean a
    // raw unique-constraint violation escaped to the developer.
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const loser = results.find((r) => r.status !== 201);
    expect(loser, 'expected exactly one refusal').toBeDefined();
    expect(
      loser!.status,
      `loser returned ${loser!.status}: ${JSON.stringify(loser!.body)}`,
    ).toBeLessThan(500);

    // And the money is allocated exactly once.
    const allocations = await prisma.payoutAllocation.findMany({
      where: { earningsEntryId: earning.id },
    });
    expect(allocations).toHaveLength(1);

    const payouts = await prisma.payoutRequest.findMany({ where: { userId } });
    expect(payouts).toHaveLength(1);
  });
});

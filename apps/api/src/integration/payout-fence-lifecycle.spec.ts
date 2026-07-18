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

describe('Payout fence lifecycle (DB-backed)', () => {
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

    const adminPasswordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'admin-fence@waitlayer.com',
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

  async function setupDeveloper() {
    const devEmail = `dev-fence-${Date.now()}@waitlayer.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: devEmail,
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Fence Developer',
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    devUserId = signupRes.body.user.id;

    await prisma.user.update({
      where: { id: devUserId },
      data: { emailVerified: true },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: devEmail, password: 'Password123!' })
      .expect(200);
    devToken = loginRes.body.accessToken;

    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin-fence@waitlayer.com', password: 'Password123!' })
      .expect(200);
    adminToken = adminLoginRes.body.accessToken;
  }

  async function createPayoutAccount() {
    const payoutAccountRes = await request(app.getHttpServer())
      .post('/api/v1/payout/method')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        provider: 'paypal_email',
        destination: 'fence.dev@paypal.com',
        currency: 'USD',
      })
      .expect(201);
    const payoutAccountId = payoutAccountRes.body.id;
    await prisma.payoutAccount.update({
      where: { id: payoutAccountId },
      data: { isVerified: true },
    });
    return payoutAccountId;
  }

  async function createEarnings(amountMinor: bigint) {
    const earning = await prisma.earningsLedger.create({
      data: {
        userId: devUserId,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor,
        currency: 'USD',
        availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        idempotencyKey: `fence-earnings-${Date.now()}-${amountMinor.toString()}`,
        description: 'Confirmed earnings for fence lifecycle test',
      },
    });
    return earning.id;
  }

  async function requestAndProcessPayout(payoutAccountId: string, amountMinor: number) {
    const earningId = await createEarnings(BigInt(amountMinor));

    const requestRes = await request(app.getHttpServer())
      .post('/api/v1/payout/request')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        payoutAccountId,
        amountMinor,
        currency: 'USD',
        earningsEntryIds: [earningId],
      })
      .expect(201);
    const payoutId = requestRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Approve for fence test' })
      .expect(201);

    // Swap the provider for a throwing stub so the provider call inside
    // processPayout fails ambiguously. This leaves the durable initiation
    // fence in place (retainFenceForReconciliation === true), which is the
    // real-world crash/timeout scenario we want to exercise.
    const originalProvider = (payoutService as any).providers['paypal_email'];
    (payoutService as any).providers['paypal_email'] = {
      readiness: () => ({ ok: true }),
      initiate: async () => {
        throw new Error('Simulated provider timeout');
      },
      checkStatus: async () => ({ status: 'processing' }),
    };

    let processRes;
    try {
      // processPayout returns 400 when the provider call throws, but the DB
      // transaction that set the fence has already committed. The payout is
      // left in `processing` with the fence retained for reconciliation.
      processRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/process`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(processRes.body.message).toMatch(/provider outcome|reconciliation/i);
    } finally {
      // Restore the real provider so later operations (markPayoutFailed, etc.)
      // use the normal code path.
      (payoutService as any).providers['paypal_email'] = originalProvider;
    }

    const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    expect(payout?.status).toBe('processing');

    const account = await prisma.payoutAccount.findUnique({ where: { id: payoutAccountId } });
    expect(account?.initiationPayoutId).toBe(payoutId);

    return { payoutId, processRes };
  }

  it('rejects fence release and freeze while a payout is in flight, then reconciles after the payout fails', async () => {
    await setupDeveloper();
    const payoutAccountId = await createPayoutAccount();
    const { payoutId } = await requestAndProcessPayout(payoutAccountId, 1000);

    // While the payout is processing, releasing the fence must be rejected
    // because the provider outcome is unknown.
    const releaseWhileProcessing = await request(app.getHttpServer())
      .post(`/api/v1/admin/payout-accounts/${payoutAccountId}/release-fence`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Attempt release while processing' })
      .expect(400);
    expect(releaseWhileProcessing.body.message).toMatch(/status.*processing|processing.*status/i);

    // Freezing the account must also be rejected while the fence is active.
    const freezeWhileProcessing = await request(app.getHttpServer())
      .post(`/api/v1/admin/payout-accounts/${payoutAccountId}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Attempt freeze while processing' })
      .expect(409);
    expect(freezeWhileProcessing.body.message).toMatch(/active|ambiguous|initiation/i);

    // Simulate provider failure. This clears the fence automatically.
    const tx = await prisma.payoutTransaction.findFirst({ where: { payoutRequestId: payoutId } });
    await payoutService.markPayoutFailed(payoutId, {
      provider: 'paypal_email',
      providerTxId: tx!.providerTxId,
      failureReason: 'Provider network error',
    });

    const accountAfterFailure = await prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
    });
    expect(accountAfterFailure?.initiationPayoutId).toBeNull();

    // Re-attach the fence manually (simulating an crashed worker that never
    // cleared the fence automatically) and prove releasePayoutFence succeeds
    // once the referenced payout is in a terminal state.
    await prisma.payoutAccount.update({
      where: { id: payoutAccountId },
      data: { initiationPayoutId: payoutId },
    });

    const accountWithFence = await prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
    });
    expect(accountWithFence?.initiationPayoutId).toBe(payoutId);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/payout-accounts/${payoutAccountId}/release-fence`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'Reconciled after provider failure',
        providerTxId: 'reconcile-tx-123',
        resolution: 'failed',
      })
      .expect(201);

    const accountAfterRelease = await prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
    });
    expect(accountAfterRelease?.initiationPayoutId).toBeNull();

    // Now that the payout is terminal and the fence is clear, freezing works.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payout-accounts/${payoutAccountId}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Freeze after failure' })
      .expect(201);

    const frozenAccount = await prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
    });
    expect(frozenAccount?.isFrozen).toBe(true);
  });
});

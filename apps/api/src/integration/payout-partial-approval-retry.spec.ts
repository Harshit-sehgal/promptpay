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

describe('Payout partial-approval retry loop (DB-backed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payoutService: PayoutService;
  let previousRedisUrl: string | undefined;
  let devToken: string;
  let devUserId: string;
  let adminToken: string;
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
    payoutService = app.get(PayoutService);
    await cleanDb(prisma);

    const adminPasswordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'admin-partial@waitlayer.com',
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
        email: 'dev-partial-retry@waitlayer.com',
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Partial Developer',
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
      .send({ email: 'dev-partial-retry@waitlayer.com', password: 'Password123!' })
      .expect(200);
    devToken = loginRes.body.accessToken;

    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin-partial@waitlayer.com', password: 'Password123!' })
      .expect(200);
    adminToken = adminLoginRes.body.accessToken;

    const earning = await prisma.earningsLedger.create({
      data: {
        userId: devUserId,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: 1000n,
        currency: 'USD',
        availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        idempotencyKey: 'partial-approval-earnings',
        description: 'Confirmed earnings for partial approval retry test',
      },
    });
    earningEntryId = earning.id;

    const payoutAccountRes = await request(app.getHttpServer())
      .post('/api/v1/payout/method')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        provider: 'paypal_email',
        destination: 'partial.dev@paypal.com',
        currency: 'USD',
      })
      .expect(201);
    payoutAccountId = payoutAccountRes.body.id;

    await prisma.payoutAccount.update({
      where: { id: payoutAccountId },
      data: { isVerified: true },
    });
  });

  it('partial approval split, provider failure, and full retry allocate slice and remainder without double-split', async () => {
    // 1. Developer requests a payout for the full 1000 minor units.
    const requestRes = await request(app.getHttpServer())
      .post('/api/v1/payout/request')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        payoutAccountId,
        amountMinor: 1000,
        currency: 'USD',
        earningsEntryIds: [earningEntryId],
      })
      .expect(201);
    const payoutId = requestRes.body.id;

    // 2. Admin approves only 600 (partial approval).
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Partial approval', approvedAmountMinor: 600 })
      .expect(201);

    // 3. Admin processes the payout. This triggers the split: the original
    //    1000 row is reversed, a 600 paid-slice row is created, and a 400
    //    remainder row is created.
    const processRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(processRes.body.status).toBe('processing');

    const firstPayoutAfterProcess = await prisma.payoutRequest.findUnique({
      where: { id: payoutId },
    });
    expect(firstPayoutAfterProcess?.status).toBe('processing');

    // Verify the split happened exactly once.
    const original = await prisma.earningsLedger.findUnique({ where: { id: earningEntryId } });
    expect(original?.status).toBe('reversed');

    const allEntries = await prisma.earningsLedger.findMany({
      where: { userId: devUserId },
      orderBy: { createdAt: 'asc' },
    });
    const slice = allEntries.find((e) => e.id !== earningEntryId && e.amountMinor === 600n);
    const remainder = allEntries.find((e) => e.id !== earningEntryId && e.amountMinor === 400n);
    expect(slice).toBeDefined();
    expect(remainder).toBeDefined();
    expect(slice?.status).toBe('confirmed');
    expect(remainder?.status).toBe('confirmed');

    // 4. Simulate provider failure by marking the payout as failed.
    //    These transitions are not exposed over HTTP, so we call the
    //    service directly to exercise the internal state machine.
    //    The provider transaction row was updated with the real provider
    //    transaction id during processPayout, so read it before failing.
    const firstTx = await prisma.payoutTransaction.findFirst({
      where: { payoutRequestId: payoutId },
    });
    expect(firstTx).toBeDefined();
    expect(firstTx?.status).toBe('processing');
    await payoutService.markPayoutFailed(payoutId, {
      provider: 'paypal_email',
      providerTxId: firstTx!.providerTxId,
      failureReason: 'Provider network error',
    });

    const failedPayout = await prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { allocations: true },
    });
    expect(failedPayout?.status).toBe('failed');
    expect(failedPayout?.allocations.length).toBe(0);

    const failedTx = await prisma.payoutTransaction.findFirst({
      where: { payoutRequestId: payoutId },
    });
    expect(failedTx?.status).toBe('failed');
    expect(failedTx?.failureReason).toBeTruthy();

    const earningsAfterFailure = await prisma.earningsLedger.findMany({
      where: { userId: devUserId, status: 'confirmed' },
    });
    expect(earningsAfterFailure.length).toBe(2);
    expect(earningsAfterFailure.reduce((sum, e) => sum + e.amountMinor, 0n)).toBe(1000n);

    // 5. Developer requests a new payout for the full original amount (1000).
    //    A full retry naturally allocates both the 600 slice and the 400
    //    remainder without any further splits, proving the remainder is
    //    withdrawable and the system does not double-split.
    const retryRes = await request(app.getHttpServer())
      .post('/api/v1/payout/request')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        payoutAccountId,
        amountMinor: 1000,
        currency: 'USD',
      })
      .expect(201);
    const retryPayoutId = retryRes.body.id;

    // 6. Admin approves and processes the retry payout.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${retryPayoutId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Retry full amount' })
      .expect(201);

    const retryProcessRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${retryPayoutId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(retryProcessRes.body.status).toBe('processing');

    // 7. Verify the retry payout allocated both existing rows (600 + 400)
    //    without creating any new earnings rows.
    const finalEntries = await prisma.earningsLedger.findMany({
      where: { userId: devUserId },
    });
    expect(finalEntries.filter((e) => e.amountMinor === 600n).length).toBe(1);
    expect(finalEntries.filter((e) => e.amountMinor === 400n).length).toBe(1);
    expect(finalEntries.length).toBe(3); // reversed original + 600 slice + 400 remainder

    const retryAllocations = await prisma.payoutAllocation.findMany({
      where: { payoutRequestId: retryPayoutId },
      include: { earningsEntry: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(retryAllocations.length).toBe(2);
    const allocatedAmounts = retryAllocations.map((a) => a.amountMinor).sort();
    expect(allocatedAmounts).toEqual([400n, 600n]);
    expect(retryAllocations.reduce((sum, a) => sum + a.amountMinor, 0n)).toBe(1000n);
    // Prove the retry reused the original split rows, not new ones.
    const retryEntryIds = new Set(retryAllocations.map((a) => a.earningsEntryId));
    expect(retryEntryIds.has(slice!.id)).toBe(true);
    expect(retryEntryIds.has(remainder!.id)).toBe(true);

    // 8. Mark the retry payout as paid to clear the initiation fence and
    //    reach a clean terminal state.
    const retryPayoutBeforePaid = await prisma.payoutRequest.findUnique({
      where: { id: retryPayoutId },
    });
    expect(retryPayoutBeforePaid?.status).toBe('processing');

    const retryProcessBody = retryProcessRes.body;
    await payoutService.markPayoutPaid(retryPayoutId, {
      providerTxId: retryProcessBody.providerTxId ?? `initiate_pending_${retryPayoutId}`,
      paidAt: new Date().toISOString(),
    });

    const paidPayout = await prisma.payoutRequest.findUnique({
      where: { id: retryPayoutId },
      include: { allocations: true },
    });
    expect(paidPayout?.status).toBe('paid');

    const accountAfter = await prisma.payoutAccount.findUnique({
      where: { id: payoutAccountId },
    });
    expect(accountAfter?.initiationPayoutId).toBeNull();

    const paidEarnings = await prisma.earningsLedger.findMany({
      where: { userId: devUserId, status: 'paid' },
    });
    expect(paidEarnings.length).toBe(2);
    expect(paidEarnings.reduce((sum, e) => sum + e.amountMinor, 0n)).toBe(1000n);

    const retryTx = await prisma.payoutTransaction.findFirst({
      where: { payoutRequestId: retryPayoutId },
    });
    expect(retryTx?.status).toBe('paid');
  });
});

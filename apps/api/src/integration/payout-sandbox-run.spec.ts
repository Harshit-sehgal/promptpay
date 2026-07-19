import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';
import { PayoutService } from '../payout/payout.service';
import { PayoutCronService } from '../payout/payout-cron.service';

async function cleanDb(prisma: PrismaService) {
  // Truncate tables to ensure a clean test run without foreign key violations.
  // `cron_leases` is included on purpose: the payout cron acquires a
  // cross-replica lease, and a stale lease owned by a prior test process would
  // otherwise block this run's poll and make the suite flaky.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "users", "sessions", "devices", "device_recovery_tokens",
      "user_settings", "payout_accounts",
      "advertisers", "campaigns", "ad_creatives", "categories",
      "blocked_categories", "country_targeting", "tool_integrations",
      "wait_state_events", "ad_impressions", "ad_clicks", "ad_reports",
      "earnings_ledger", "advertiser_ledger", "platform_ledger",
      "payout_requests", "payout_allocations", "payout_transactions",
      "cron_leases",
      "recovery_debt_cases",
      "fraud_flags", "trust_scores", "campaign_approvals", "api_keys",
      "webhook_events", "audit_logs", "referrals", "referral_rewards"
    CASCADE;
  `);
}

/**
 * P1.9 — Verify the local-only payout providers (paypal_email, manual) run
 * end-to-end in the sandbox with ZERO external network calls.
 *
 * These providers are in-memory: their `initiate`/`checkStatus` never touch a
 * PSP. The automated providers (paypal_payouts, stripe_connect, wise,
 * payoneer, razorpay) are `coming_soon` and are rejected at registration, so
 * no reachable code path can perform a real outbound payout call. This spec
 * proves that guarantee by driving a full request→approve→process→cron-poll
 * cycle against the real Postgres and asserting the in-memory provider's
 * `checkStatus` is invoked, the payout stays `processing`, and no outbound
 * HTTP (`fetch`) is performed.
 */
describe('Payout sandbox run (DB-backed, zero network)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payoutService: PayoutService;
  let payoutCronService: PayoutCronService;
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
    payoutCronService = app.get(PayoutCronService);
    await cleanDb(prisma);

    const adminPasswordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'admin-sandbox@waitlayer.com',
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
    const devEmail = `dev-sandbox-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@waitlayer.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: devEmail,
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Sandbox Developer',
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
      .send({ email: 'admin-sandbox@waitlayer.com', password: 'Password123!' })
      .expect(200);
    adminToken = adminLoginRes.body.accessToken;
  }

  async function createPayoutAccount(provider: string, destination: string) {
    const payoutAccountRes = await request(app.getHttpServer())
      .post('/api/v1/payout/method')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        provider,
        destination,
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
        idempotencyKey: `sandbox-earnings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Confirmed earnings for sandbox run test',
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
      .send({ note: 'Approve for sandbox run' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/process`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    expect(payout?.status).toBe('processing');

    return { payoutId };
  }

  /**
   * Drive one provider end-to-end and assert the cron poll runs the in-memory
   * `checkStatus` with no external network egress.
   */
  async function runSandboxProvider(provider: string, destination: string) {
    await setupDeveloper();
    const payoutAccountId = await createPayoutAccount(provider, destination);
    const { payoutId } = await requestAndProcessPayout(payoutAccountId, 5000);

    // The cron only polls payouts whose `processedAt` is older than the
    // stall threshold (120s). Backdate so this payout is eligible now.
    await prisma.payoutRequest.update({
      where: { id: payoutId },
      data: { processedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const providerHandler = payoutService.getProvider(provider);
    expect(providerHandler).toBeDefined();
    const checkStatusSpy = vi.spyOn(providerHandler!, 'checkStatus');

    // Watch for any outbound HTTP during the poll window. The local providers
    // are in-memory, so `fetch` must never be invoked.
    const fetchSpy = typeof globalThis.fetch === 'function' ? vi.spyOn(globalThis, 'fetch') : null;

    // The startup poll (fire-and-forget during app bootstrap) may still hold
    // the re-entrancy guard; clear it so this deterministic poll actually runs.
    // `pollInFlight` is a private instance flag on PayoutCronService.
    const cron = payoutCronService as unknown as { pollInFlight: boolean };
    cron.pollInFlight = false;

    const result = await payoutCronService.pollProcessingPayouts();

    // The in-memory provider was exercised and reported "still processing",
    // so the payout remains in a valid (processing) state and is not completed.
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(checkStatusSpy).toHaveBeenCalled();
    if (fetchSpy) {
      expect(fetchSpy).not.toHaveBeenCalled();
    }

    checkStatusSpy.mockRestore();
    fetchSpy?.mockRestore();

    const payoutAfter = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    expect(payoutAfter?.status).toBe('processing');
  }

  it('runs paypal_email payout end-to-end with zero external network calls', async () => {
    await runSandboxProvider('paypal_email', 'sandbox.dev@example.com');
  });

  it('runs manual payout end-to-end with zero external network calls', async () => {
    await runSandboxProvider('manual', 'sandbox-manual-dest-001');
  });
});

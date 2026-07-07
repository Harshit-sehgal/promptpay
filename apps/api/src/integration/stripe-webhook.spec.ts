import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { raw } from 'express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma.service';
import { StripeProvider } from '../payout/providers';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { UserRole } from '@waitlayer/shared';

/**
 * Integration tests for the Stripe webhook reconciliation path — the
 * highest-risk money-movement code (payout.paid / payout.failed flip real
 * ledger rows). These exercise the REAL controller + Prisma against a real
 * Postgres database. `StripeProvider` is overridden with a fake that simply
 * returns the posted JSON as the parsed event (so we drive the real
 * reconciliation logic without Stripe network calls or real signature crypto).
 */
const fakeStripe = {
  isEnabled: () => true,
  verifyWebhookSignature: (_raw: Buffer | string, _sig: string) =>
    JSON.parse(_raw.toString()),
};

const TEST_PROVIDER_TX_IDS = ['po_paid_1', 'po_fail_1'];
const TEST_EVENT_IDS = ['evt_paid_1', 'evt_fail_1', 'evt_unhandled_1'];
const TEST_EMAILS = TEST_PROVIDER_TX_IDS.map((providerTxId) => `wh-${providerTxId}@test.com`);

async function cleanupStripeWebhookSpecRows(prisma: PrismaService) {
  await prisma.webhookEvent.deleteMany({
    where: { provider: 'stripe', eventId: { in: TEST_EVENT_IDS } },
  });

  const users = await prisma.user.findMany({
    where: { email: { in: TEST_EMAILS } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) return;

  const [payoutRequests, earningsEntries] = await Promise.all([
    prisma.payoutRequest.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    }),
    prisma.earningsLedger.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    }),
  ]);
  const payoutRequestIds = payoutRequests.map((payout) => payout.id);
  const earningsEntryIds = earningsEntries.map((entry) => entry.id);

  await prisma.payoutAllocation.deleteMany({
    where: {
      OR: [
        { payoutRequestId: { in: payoutRequestIds } },
        { earningsEntryId: { in: earningsEntryIds } },
      ],
    },
  });
  await prisma.payoutTransaction.deleteMany({
    where: {
      OR: [
        { payoutRequestId: { in: payoutRequestIds } },
        { providerTxId: { in: TEST_PROVIDER_TX_IDS } },
      ],
    },
  });
  await prisma.payoutRequest.deleteMany({ where: { id: { in: payoutRequestIds } } });
  await prisma.payoutAccount.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.earningsLedger.deleteMany({ where: { id: { in: earningsEntryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe('Stripe Webhook Controller — reconciliation', () => {
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
      .overrideProvider(StripeProvider)
      .useValue(fakeStripe)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mirror main.ts: the webhook route needs the raw body for Stripe
    // signature verification (req.rawBody).
    app.use('/api/v1/payout/stripe/webhook', raw({ type: 'application/json', limit: '256kb' }));
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
    // Keep cleanup scoped to this spec's deterministic ids. This is safe to
    // run in the same database as other integration specs without truncation.
    await cleanupStripeWebhookSpecRows(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupStripeWebhookSpecRows(prisma);
    }
    if (app) await app.close();
  });

  async function seedPaidScenario(providerTxId: string, payoutStatus: string) {
    const user = await prisma.user.create({
      data: {
        email: `wh-${providerTxId}@test.com`,
        role: UserRole.DEVELOPER,
        status: 'active',
        emailVerified: true,
        country: 'US',
      },
    });
    const account = await prisma.payoutAccount.create({
      data: {
        userId: user.id,
        provider: 'stripe_connect',
        destination: 'acct_test_dev',
        currency: 'USD',
        isActive: true,
        isVerified: true,
      },
    });
    const payout = await prisma.payoutRequest.create({
      data: {
        userId: user.id,
        payoutAccountId: account.id,
        status: payoutStatus as never,
        requestedAmountMinor: 1000,
        approvedAmountMinor: 1000,
        currency: 'USD',
      },
    });
    await prisma.payoutTransaction.create({
      data: {
        payoutRequestId: payout.id,
        provider: 'stripe_connect',
        providerTxId,
        status: 'processing',
      },
    });

    const e1 = await prisma.earningsLedger.create({
      data: {
        userId: user.id,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: 600,
        currency: 'USD',
        idempotencyKey: `wh_e1_${providerTxId}`,
      },
    });
    const e2 = await prisma.earningsLedger.create({
      data: {
        userId: user.id,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: 400,
        currency: 'USD',
        idempotencyKey: `wh_e2_${providerTxId}`,
      },
    });
    await prisma.payoutAllocation.create({
      data: { payoutRequestId: payout.id, earningsEntryId: e1.id, amountMinor: 600 },
    });
    await prisma.payoutAllocation.create({
      data: { payoutRequestId: payout.id, earningsEntryId: e2.id, amountMinor: 400 },
    });
    return { payoutId: payout.id, e1Id: e1.id, e2Id: e2.id };
  }

  function postWebhook(event: unknown) {
    return request(app.getHttpServer())
      .post('/api/v1/payout/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=123,v1=fake')
      .send(JSON.stringify(event));
  }

  it('marks a payout paid and flips allocated earnings to paid on payout.paid', async () => {
    const { payoutId, e1Id, e2Id } = await seedPaidScenario('po_paid_1', 'processing');

    const res = await postWebhook({
      id: 'evt_paid_1',
      type: 'payout.paid',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_paid_1', status: 'paid' } },
    });

    expect(res.status).toBe(200);
    const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    expect(payout?.status).toBe('paid');
    const e1 = await prisma.earningsLedger.findUnique({ where: { id: e1Id } });
    const e2 = await prisma.earningsLedger.findUnique({ where: { id: e2Id } });
    expect(e1?.status).toBe('paid');
    expect(e2?.status).toBe('paid');
    const evt = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'stripe', eventId: 'evt_paid_1' } },
    });
    expect(evt?.processingStatus).toBe('processed');
  });

  it('is idempotent — a replayed payout.paid is acknowledged without error', async () => {
    const res = await postWebhook({
      id: 'evt_paid_1',
      type: 'payout.paid',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_paid_1', status: 'paid' } },
    });
    expect(res.status).toBe(200);
  });

  it('marks a payout failed and preserves earnings on payout.failed', async () => {
    const { payoutId, e1Id } = await seedPaidScenario('po_fail_1', 'processing');

    const res = await postWebhook({
      id: 'evt_fail_1',
      type: 'payout.failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'po_fail_1', status: 'failed' } },
    });

    expect(res.status).toBe(200);
    const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    expect(payout?.status).toBe('failed');
    // Earnings stay confirmed (not paid) — they become available again for retry.
    const e1 = await prisma.earningsLedger.findUnique({ where: { id: e1Id } });
    expect(e1?.status).toBe('confirmed');
    const allocs = await prisma.payoutAllocation.count({ where: { payoutRequestId: payoutId } });
    expect(allocs).toBe(0);
  });

  it('acknowledges unhandled event types without throwing', async () => {
    const res = await postWebhook({
      id: 'evt_unhandled_1',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cus_1' } },
    });
    expect(res.status).toBe(200);
    const evt = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'stripe', eventId: 'evt_unhandled_1' } },
    });
    expect(evt?.processingStatus).toBe('processed');
  });
});

import { raw } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';
import { StripeProvider } from '../payout/providers';

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
  verifyWebhookSignature: (_raw: Buffer | string, _sig: string) => JSON.parse(_raw.toString()),
  getDisputeDetails: (dispute: {
    payment_intent?: string | { id?: string } | null;
    amount: number;
    currency: string;
    reason?: string | null;
    status: string;
  }) => ({
    paymentIntentId:
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? ''),
    amountMinor: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason ?? '',
    status: dispute.status,
  }),
};

const TEST_PROVIDER_TX_IDS = ['po_paid_1', 'po_fail_1'];
const TEST_PAYMENT_INTENT_IDS = ['pi_partial_freeze', 'pi_partial_won', 'pi_partial_lost'];
const TEST_EVENT_IDS = [
  'evt_paid_1',
  'evt_fail_1',
  'evt_unhandled_1',
  'evt_partial_freeze_created',
  'evt_partial_won_created',
  'evt_partial_won_closed',
  'evt_partial_lost_created',
  'evt_partial_lost_closed',
];
const TEST_EMAILS = [
  ...TEST_PROVIDER_TX_IDS.map((providerTxId) => `wh-${providerTxId}@test.com`),
  'wh-dispute-freeze@test.com',
  'wh-dispute-won@test.com',
  'wh-dispute-lost@test.com',
];

async function cleanupStripeWebhookSpecRows(prisma: PrismaService) {
  await prisma.webhookEvent.deleteMany({
    where: { provider: 'stripe', eventId: { in: TEST_EVENT_IDS } },
  });
  await prisma.platformLedger.deleteMany({
    where: {
      OR: [
        { referenceId: { in: TEST_PAYMENT_INTENT_IDS } },
        { idempotencyKey: { contains: 'dp_partial_' } },
      ],
    },
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
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
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

  async function seedDisputeScenario(input: {
    email: string;
    paymentIntentId: string;
    idempotencyKey: string;
  }) {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        role: UserRole.ADVERTISER,
        status: 'active',
        emailVerified: true,
        country: 'US',
      },
    });
    const advertiser = await prisma.advertiser.create({
      data: {
        userId: user.id,
        companyName: 'Dispute Test Co',
        billingEmail: input.email,
      },
    });
    const credit = await prisma.advertiserLedger.create({
      data: {
        advertiserId: advertiser.id,
        entryType: 'credit',
        status: 'confirmed',
        amountMinor: 10_000,
        currency: 'USD',
        stripePaymentIntentId: input.paymentIntentId,
        idempotencyKey: input.idempotencyKey,
        description: 'Stripe deposit for dispute test',
      },
    });
    return { advertiserId: advertiser.id, creditId: credit.id };
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

  it('freezes only the disputed slice for a partial dispute', async () => {
    const { creditId } = await seedDisputeScenario({
      email: 'wh-dispute-freeze@test.com',
      paymentIntentId: 'pi_partial_freeze',
      idempotencyKey: 'stripe_deposit_pi_partial_freeze',
    });

    const res = await postWebhook({
      id: 'evt_partial_freeze_created',
      type: 'charge.dispute.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_partial_freeze',
          payment_intent: 'pi_partial_freeze',
          amount: 1_000,
          currency: 'USD',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    });

    expect(res.status).toBe(200);
    const parent = await prisma.advertiserLedger.findUnique({ where: { id: creditId } });
    expect(parent?.status).toBe('confirmed');
    expect(parent?.amountMinor).toBe(9_000);

    const hold = await prisma.advertiserLedger.findFirst({
      where: { stripeDisputeId: 'dp_partial_freeze', entryType: 'hold' },
    });
    expect(hold?.status).toBe('held');
    expect(hold?.amountMinor).toBe(1_000);
  });

  it('restores exactly the disputed slice when a partial dispute is won', async () => {
    const { advertiserId, creditId } = await seedDisputeScenario({
      email: 'wh-dispute-won@test.com',
      paymentIntentId: 'pi_partial_won',
      idempotencyKey: 'stripe_deposit_pi_partial_won',
    });

    const created = await postWebhook({
      id: 'evt_partial_won_created',
      type: 'charge.dispute.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_partial_won',
          payment_intent: 'pi_partial_won',
          amount: 1_000,
          currency: 'USD',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    });
    expect(created.status).toBe(200);

    const closed = await postWebhook({
      id: 'evt_partial_won_closed',
      type: 'charge.dispute.closed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_partial_won',
          payment_intent: 'pi_partial_won',
          amount: 1_000,
          currency: 'USD',
          reason: 'fraudulent',
          status: 'won',
        },
      },
    });
    expect(closed.status).toBe(200);

    const parent = await prisma.advertiserLedger.findUnique({ where: { id: creditId } });
    expect(parent?.status).toBe('confirmed');
    expect(parent?.amountMinor).toBe(9_000);

    const restored = await prisma.advertiserLedger.findFirst({
      where: { stripeDisputeId: 'dp_partial_won', entryType: 'credit', status: 'confirmed' },
    });
    expect(restored?.amountMinor).toBe(1_000);

    const creditSum = await prisma.advertiserLedger.aggregate({
      where: { advertiserId, entryType: 'credit', status: 'confirmed' },
      _sum: { amountMinor: true },
    });
    expect(creditSum._sum.amountMinor).toBe(10_000);
  });

  it('writes off exactly the disputed slice when a partial dispute is lost', async () => {
    const { advertiserId, creditId } = await seedDisputeScenario({
      email: 'wh-dispute-lost@test.com',
      paymentIntentId: 'pi_partial_lost',
      idempotencyKey: 'stripe_deposit_pi_partial_lost',
    });

    const created = await postWebhook({
      id: 'evt_partial_lost_created',
      type: 'charge.dispute.created',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_partial_lost',
          payment_intent: 'pi_partial_lost',
          amount: 1_000,
          currency: 'USD',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
    });
    expect(created.status).toBe(200);

    const closed = await postWebhook({
      id: 'evt_partial_lost_closed',
      type: 'charge.dispute.closed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'dp_partial_lost',
          payment_intent: 'pi_partial_lost',
          amount: 1_000,
          currency: 'USD',
          reason: 'fraudulent',
          status: 'lost',
        },
      },
    });
    expect(closed.status).toBe(200);

    const parent = await prisma.advertiserLedger.findUnique({ where: { id: creditId } });
    expect(parent?.status).toBe('confirmed');
    expect(parent?.amountMinor).toBe(9_000);

    const reversal = await prisma.advertiserLedger.findFirst({
      where: { stripeDisputeId: 'dp_partial_lost', entryType: 'reversal', status: 'reversed' },
    });
    expect(reversal?.amountMinor).toBe(1_000);

    const creditSum = await prisma.advertiserLedger.aggregate({
      where: { advertiserId, entryType: 'credit', status: 'confirmed' },
      _sum: { amountMinor: true },
    });
    expect(creditSum._sum.amountMinor).toBe(9_000);

    const platformDebit = await prisma.platformLedger.findFirst({
      where: {
        referenceId: 'pi_partial_lost',
        entryType: 'reversal',
        idempotencyKey: { contains: 'dp_partial_lost' },
      },
    });
    expect(platformDebit?.amountMinor).toBe(1_000);
  });

  // ── A-062: failure paths must NOT be acknowledged with HTTP 200 ──
  it('returns 503 when Stripe is not configured', async () => {
    const original = fakeStripe.isEnabled;
    fakeStripe.isEnabled = () => false;
    try {
      const res = await postWebhook({
        id: 'evt_cfg',
        type: 'payout.paid',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'po_cfg', status: 'paid' } },
      });
      expect(res.status).toBe(503);
    } finally {
      fakeStripe.isEnabled = original;
    }
  });

  it('returns 400 when the signature header is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payout/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_nosig', type: 'payout.paid' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    const original = fakeStripe.verifyWebhookSignature;
    fakeStripe.verifyWebhookSignature = () => {
      throw new Error('bad signature');
    };
    try {
      const res = await postWebhook({
        id: 'evt_badsig',
        type: 'payout.paid',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'po_badsig', status: 'paid' } },
      });
      expect(res.status).toBe(400);
    } finally {
      fakeStripe.verifyWebhookSignature = original;
    }
  });

  it('still returns 200 for a verified event after exercising failure paths', async () => {
    const res = await postWebhook({
      id: 'evt_ok_2',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cus_ok_2' } },
    });
    expect(res.status).toBe(200);
  });
});

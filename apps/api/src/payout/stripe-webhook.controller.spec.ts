import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

import { StripeWebhookController } from './stripe-webhook.controller';

function makeController(options: { depositDuplicate?: boolean } = {}) {
  const stripe = {
    isEnabled: () => true,
    verifyWebhookSignature: vi.fn(),
    getRefundDetails: vi.fn().mockResolvedValue({
      paymentIntentId: 'pi_money',
      amountMinor: 1000,
      currency: 'usd',
    }),
    handleCheckoutComplete: vi.fn().mockResolvedValue({
      advertiserId: 'adv-1',
      amountMinor: 1000n,
      currency: 'USD',
      paymentIntentId: 'pi_money',
      stripeCustomerId: null,
    }),
  };
  const p2002 = Object.assign(new Error('duplicate'), { code: 'P2002' });
  const advertiserLedgerCreate = options.depositDuplicate
    ? vi.fn().mockRejectedValue(p2002)
    : vi.fn().mockResolvedValue({ id: 'deposit-1' });
  const prisma = {
    advertiser: {
      findUnique: vi.fn().mockResolvedValue({ id: 'adv-1', user: { status: 'active' } }),
      updateMany: vi.fn(),
    },
    advertiserLedger: {
      findMany: vi.fn().mockResolvedValue([]),
      create: advertiserLedgerCreate,
      upsert: vi.fn().mockResolvedValue({ id: 'catchup-1' }),
      updateMany: vi.fn(),
    },
    platformLedger: {
      create: options.depositDuplicate
        ? vi.fn().mockRejectedValue(p2002)
        : vi.fn().mockResolvedValue({ id: 'cash-1' }),
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'cash-refund-1', amountMinor: 1000n, currency: 'USD' }]),
      upsert: vi.fn().mockResolvedValue({ id: 'cash-orphan-1' }),
    },
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'wh-1' }),
      findUnique: vi.fn().mockResolvedValue({
        provider: 'stripe',
        eventId: 'evt',
        processingStatus: 'pending',
        processedAt: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    campaign: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
    // The real handleRefund (and the Round 27 Fix 1 parent-restoration loop)
    // wrap each reversal in `$transaction`. Surface a pass-through mock so
    // tests exercise the prisma row-create/update calls inside the tx.
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
    logStrict: vi.fn().mockResolvedValue(undefined),
  };
  const referral = { processReferralRewards: vi.fn().mockResolvedValue(undefined) };
  // StripeWebhookController now depends on PayoutService for
  // handlePayoutFailed's markPayoutFailed delegation. Tests that don't
  // exercise the payout-failed path pass a stub here; the integration
  // test (`src/integration/stripe-webhook.spec.ts`) wires the real
  // PayoutService through the Nest container.
  const payout = { markPayoutFailed: vi.fn().mockResolvedValue(undefined) };
  const controller = new StripeWebhookController(
    stripe as never,
    prisma as never,
    audit as never,
    { on: vi.fn() } as never,
    referral as never,
    payout as never,
  );
  return { controller: controller as any, prisma, stripe, audit };
}

describe('StripeWebhookController money reconciliation', () => {
  it('returns a non-2xx error when synchronous reconciliation fails', async () => {
    const event = { id: 'evt_fail_ack', type: 'checkout.session.completed', data: { object: {} } };
    const stripe = {
      isEnabled: () => true,
      verifyWebhookSignature: () => event,
    };
    const prisma = {
      webhookEvent: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          provider: 'stripe',
          eventId: event.id,
          processingStatus: 'pending',
          processedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }),
      },
    };
    const controller = new StripeWebhookController(
      stripe as never,
      prisma as never,
      { log: vi.fn() } as never,
      { on: vi.fn() } as never,
      { processReferralRewards: vi.fn().mockResolvedValue(undefined) } as never,
      { markPayoutFailed: vi.fn().mockResolvedValue(undefined) } as never,
    ) as any;
    controller.processEvent = vi.fn().mockRejectedValue(new Error('ledger unavailable'));

    await expect(
      controller.handleWebhook({
        headers: { 'stripe-signature': 'signed' },
        rawBody: Buffer.from(JSON.stringify(event)),
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(prisma.webhookEvent.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { processingStatus: 'pending' } }),
    );
  });

  it('records a full refund without reversing the original deposit credit', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiserLedger.findMany
      .mockResolvedValueOnce([
        {
          id: 'deposit-1',
          advertiserId: 'adv-1',
          campaignId: null,
          amountMinor: 1000n,
          currency: 'USD',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'deposit-1',
          advertiserId: 'adv-1',
          campaignId: null,
          amountMinor: 1000n,
          currency: 'USD',
        },
      ]);

    await controller.handleRefund({
      id: 'evt_refund',
      data: { object: { id: 're_full' } },
    });

    expect(prisma.advertiserLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entryType: 'refund', amountMinor: 1000n }),
      }),
    );
    expect(prisma.advertiserLedger.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'deposit-1' }) }),
    );
  });

  it('does not acknowledge a money event when its audit record cannot be persisted', async () => {
    const { controller, prisma, audit } = makeController();
    audit.logStrict.mockRejectedValueOnce(new Error('audit database unavailable'));
    prisma.advertiserLedger.findMany
      .mockResolvedValueOnce([
        {
          id: 'deposit-1',
          advertiserId: 'adv-1',
          campaignId: null,
          amountMinor: 1000n,
          currency: 'USD',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'deposit-1',
          advertiserId: 'adv-1',
          campaignId: null,
          amountMinor: 1000n,
          currency: 'USD',
        },
      ]);

    await expect(
      controller.handleRefund({ id: 'evt_audit_fail', data: { object: { id: 're_audit' } } }),
    ).rejects.toThrow('audit database unavailable');
    expect(prisma.webhookEvent.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'processed' }) }),
    );
  });

  it('reconciles a refund that arrived before its deposit', async () => {
    const { controller, prisma } = makeController();

    await controller.handlePaymentSuccess({
      id: 'evt_deposit_after_refund',
      data: { object: { id: 'cs_after_refund' } },
    });

    expect(prisma.platformLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ referenceId: 'pi_money' }) }),
    );
    expect(prisma.advertiserLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'stripe_refund_catchup_cash-refund-1' },
        create: expect.objectContaining({ amountMinor: 1000n, status: 'confirmed' }),
      }),
    );
  });

  it('does not double-subtract normal-order refunds on duplicate checkout delivery', async () => {
    const { controller, prisma } = makeController({ depositDuplicate: true });

    await controller.handlePaymentSuccess({
      id: 'evt_duplicate_deposit',
      data: { object: { id: 'cs_duplicate' } },
    });

    expect(prisma.platformLedger.findMany).not.toHaveBeenCalled();
    expect(prisma.advertiserLedger.upsert).not.toHaveBeenCalled();
  });

  it('records cash for refund review without crediting an erased advertiser', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.advertiser.findUnique.mockResolvedValue({
      id: 'adv-1',
      user: { status: 'deleted' },
    });

    await controller.handlePaymentSuccess({
      id: 'evt_erased_owner',
      data: { object: { id: 'cs_erased_owner' } },
    });

    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
    expect(prisma.advertiser.updateMany).not.toHaveBeenCalled();
    expect(prisma.platformLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          idempotencyKey: 'stripe_deposit_plat_pi_money',
          bucket: 'cash',
        }),
      }),
    );
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stripe_deposit_refund_required' }),
    );
  });

  it('persists only a minimized payload plus a raw hash, never the full event', async () => {
    const event = {
      id: 'evt_min_1',
      type: 'checkout.session.completed',
      created: 1_700_000_000,
      livemode: false,
      api_version: '2023-10-16',
      data: { object: { id: 'cs_min_1', status: 'complete', amount_total: 2000 } },
    };
    const rawBody = JSON.stringify(event);
    const { controller, prisma, stripe } = makeController();
    stripe.verifyWebhookSignature = vi.fn().mockReturnValue(event);
    const expectedHash = createHash('sha256').update(rawBody).digest('hex');

    await controller.handleWebhook({
      headers: { 'stripe-signature': 'signed' },
      rawBody: Buffer.from(rawBody),
    });

    expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1);
    const createCall = prisma.webhookEvent.create.mock.calls[0][0];
    const stored = createCall.data.payload;
    expect(stored).toEqual({
      id: 'evt_min_1',
      type: 'checkout.session.completed',
      created: 1_700_000_000,
      livemode: false,
      api_version: '2023-10-16',
      dataObjectId: 'cs_min_1',
      dataObjectStatus: 'complete',
      rawHash: expectedHash,
    });
    // The full event JSON must NOT be persisted — no nested `data` envelope
    // and none of the original event's arbitrary fields survive.
    expect(stored).not.toHaveProperty('data');
    expect(stored).not.toHaveProperty('amount_total');
  });

  it('retains an unsupported event type for review instead of marking it processed', async () => {
    const event = {
      id: 'evt_unsupported_1',
      type: 'customer.created',
      created: 1_700_000_000,
      livemode: false,
      api_version: '2023-10-16',
      data: { object: { id: 'cus_unsupported_1' } },
    };
    const { controller, prisma, stripe } = makeController();
    stripe.verifyWebhookSignature = vi.fn().mockReturnValue(event);

    await controller.handleWebhook({
      headers: { 'stripe-signature': 'signed' },
      rawBody: Buffer.from(JSON.stringify(event)),
    });

    const statuses = prisma.webhookEvent.updateMany.mock.calls.map(
      (c) => c[0].data.processingStatus,
    );
    // Unsupported types are retained (pending_review) for operator triage and
    // must never be silently auto-marked `processed`.
    expect(statuses).not.toContain('processed');
    expect(statuses).toContain('pending_review');
  });
  describe('processEvent dispatch coverage (switch arms)', () => {
    it('dispatches checkout.session.completed to handlePaymentSuccess', async () => {
      const { controller } = makeController();
      await expect(
        controller.processEvent({
          id: 'evt_disp_cs',
          type: 'checkout.session.completed',
          data: { object: { id: 'cs_disp' } },
        }),
      ).resolves.toBeUndefined();
    });

    it('dispatches checkout.session.async_payment_succeeded to handlePaymentSuccess', async () => {
      const { controller } = makeController();
      await expect(
        controller.processEvent({
          id: 'evt_disp_async',
          type: 'checkout.session.async_payment_succeeded',
          data: { object: { id: 'cs_disp_async' } },
        }),
      ).resolves.toBeUndefined();
    });

    it('dispatches refund.created to handleRefund', async () => {
      const { controller } = makeController();
      await expect(
        controller.processEvent({
          id: 'evt_disp_refund',
          type: 'refund.created',
          data: { object: { id: 're_disp' } },
        }),
      ).resolves.toBeUndefined();
    });

    it('dispatches charge.dispute.funds_withdrawn without further ledger action', async () => {
      const { controller, prisma } = makeController();
      await expect(
        controller.processEvent({
          id: 'evt_disp_dw',
          type: 'charge.dispute.funds_withdrawn',
        }),
      ).resolves.toBeUndefined();
      expect(prisma.webhookEvent.updateMany).toHaveBeenCalled();
    });

    it('dispatches account.updated to handleAccountUpdated and converges the event', async () => {
      const { controller, prisma, stripe } = makeController();
      stripe.retrieveConnectAccountVerification = vi
        .fn()
        .mockResolvedValue({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
      prisma.payoutAccount = {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
      };
      await expect(
        controller.processEvent({
          id: 'evt_disp_acct',
          type: 'account.updated',
          data: { object: { id: 'acct_disp' } },
        }),
      ).resolves.toBeUndefined();
      expect(prisma.payoutAccount.updateMany).toHaveBeenCalled();
    });
  });
});

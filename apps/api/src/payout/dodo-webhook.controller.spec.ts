import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { DodoWebhookController } from './dodo-webhook.controller';

const RAW_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
const SECRET = `whsec_${RAW_KEY.toString('base64')}`;

function sign(secret: string, id: string, timestamp: string, body: string): string {
  const bare = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(bare, 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function makeController(
  overrides: { prisma?: Partial<PrismaService>; config?: Record<string, string> } = {},
) {
  const tx = {
    advertiserLedger: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    advertiser: { findUnique: vi.fn() },
    advertiserLedger: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    platformLedger: {
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    ...(overrides.prisma ?? {}),
  };
  const audit = { logStrict: vi.fn().mockResolvedValue(undefined) };
  const eventBus = { on: vi.fn(), dispatch: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: string, fallback = '') => {
      const env = {
        DODO_API_KEY: 'test-key',
        DODO_WEBHOOK_SECRET: SECRET,
        ...(overrides.config ?? {}),
      };
      return env[key] ?? fallback;
    }),
  };
  const controller = new DodoWebhookController(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService,
    eventBus as never,
  );
  return { controller, prisma, audit, tx, eventBus };
}

function signedRequest(body: unknown, id = 'msg_1') {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(SECRET, id, timestamp, rawBody.toString('utf8'));
  return {
    req: {
      headers: {
        'webhook-id': id,
        'webhook-signature': signature,
        'webhook-timestamp': timestamp,
      },
      rawBody,
    } as unknown as Request & { rawBody: Buffer },
  };
}

describe('DodoWebhookController authenticity boundary (A-107 parity)', () => {
  it('fails closed with 503 when Dodo is not configured', async () => {
    const { controller } = makeController({
      config: { DODO_API_KEY: '', DODO_WEBHOOK_SECRET: '' },
    });
    const { req } = signedRequest({ type: 'payment.succeeded', data: {} });
    await expect(controller.handleWebhook(req)).rejects.toMatchObject({ status: 503 });
  });

  it('rejects a delivery missing the Standard Webhooks headers', async () => {
    const { controller, prisma } = makeController();
    const req = { headers: {}, rawBody: Buffer.from('{}') } as unknown as Request & {
      rawBody: Buffer;
    };
    await expect(controller.handleWebhook(req)).rejects.toMatchObject({ status: 400 });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a forged signature and records nothing', async () => {
    const { controller, prisma } = makeController();
    const { req } = signedRequest({ type: 'payment.succeeded', data: { payment_id: 'pay_1' } });
    req.headers['webhook-signature'] = 'v1,AAAA';
    await expect(controller.handleWebhook(req)).rejects.toMatchObject({ status: 400 });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
  });

  it('rejects a missing raw body', async () => {
    const { controller } = makeController();
    const { req } = signedRequest({ type: 'payment.succeeded', data: {} });
    req.rawBody = undefined as unknown as Buffer;
    await expect(controller.handleWebhook(req)).rejects.toMatchObject({ status: 400 });
  });

  it('records a deposit for a valid payment.succeeded event', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.advertiser.findUnique = vi.fn().mockResolvedValue({
      id: 'adv-1',
      user: { status: 'active' },
    });
    const { req } = signedRequest({
      type: 'payment.succeeded',
      data: {
        payment_id: 'pay_1',
        amount: 1000,
        currency: 'usd',
        metadata: { advertiserId: 'adv-1' },
      },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });

    expect(prisma.advertiserLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          advertiserId: 'adv-1',
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: 1000n,
          currency: 'USD',
          idempotencyKey: 'dodo_deposit_pay_1',
        }),
      }),
    );
    expect(prisma.platformLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: 'cash',
          idempotencyKey: 'dodo_deposit_plat_pay_1',
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dodo_deposit', targetId: 'adv-1' }),
    );
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: 'dodo', eventId: 'msg_1', processingStatus: 'pending' },
        data: expect.objectContaining({ processingStatus: 'processed' }),
      }),
    );
  });

  it('treats a duplicate deposit as an idempotent no-op', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiser.findUnique = vi.fn().mockResolvedValue({
      id: 'adv-1',
      user: { status: 'active' },
    });
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    prisma.advertiserLedger.create = vi.fn().mockRejectedValue(p2002);
    const { req } = signedRequest({
      type: 'payment.succeeded',
      data: {
        payment_id: 'pay_1',
        amount: 1000,
        currency: 'usd',
        metadata: { advertiserId: 'adv-1' },
      },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
  });

  it('re-processes an already-recorded delivery instead of blindly acknowledging', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiser.findUnique = vi.fn().mockResolvedValue({
      id: 'adv-1',
      user: { status: 'active' },
    });
    prisma.webhookEvent.create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const { req } = signedRequest({
      type: 'payment.succeeded',
      data: {
        payment_id: 'pay_1',
        amount: 1000,
        currency: 'usd',
        metadata: { advertiserId: 'adv-1' },
      },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({
      received: true,
      reason: 'reprocessed',
    });
    // The deposit was re-processed idempotently rather than dropped.
    expect(prisma.advertiserLedger.create).toHaveBeenCalled();
  });

  it('re-processes a stalled delivery from its stored payload (reclaim path)', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiser.findUnique = vi.fn().mockResolvedValue({
      id: 'adv-1',
      user: { status: 'active' },
    });

    await controller.runReclaimProcessing(
      {
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_1',
          amount: 1000,
          currency: 'usd',
          metadata: { advertiserId: 'adv-1' },
        },
      },
      'msg_1',
    );

    expect(prisma.advertiserLedger.create).toHaveBeenCalled();
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: 'dodo', eventId: 'msg_1', processingStatus: 'pending' },
        data: expect.objectContaining({ processingStatus: 'processed' }),
      }),
    );
  });

  it('registers the dodo.webhook reclaim handler on module init', () => {
    const { controller, eventBus } = makeController();
    controller.onModuleInit();
    expect(eventBus.on).toHaveBeenCalledWith('dodo.webhook', expect.any(Function));
  });

  it('routes an inactive advertiser to operator refund review without granting credit', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.advertiser.findUnique = vi.fn().mockResolvedValue({
      id: 'adv-1',
      user: { status: 'suspended' },
    });
    const { req } = signedRequest({
      type: 'payment.succeeded',
      data: {
        payment_id: 'pay_1',
        amount: 1000,
        currency: 'usd',
        metadata: { advertiserId: 'adv-1' },
      },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.platformLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'dodo_deposit_plat_pay_1' },
      }),
    );
    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dodo_deposit_refund_required' }),
    );
  });

  it('retains a deposit whose advertiser is unknown for operator review', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiser.findUnique = vi.fn().mockResolvedValue(null);
    const { req } = signedRequest({
      type: 'payment.succeeded',
      data: {
        payment_id: 'pay_1',
        amount: 1000,
        currency: 'usd',
        metadata: { advertiserId: 'adv-1' },
      },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: 'pending_review',
          error: 'advertiser_not_found',
        }),
      }),
    );
  });

  it('retains an unresolvable payment payload for operator review', async () => {
    const { controller, prisma } = makeController();
    const { req } = signedRequest({
      type: 'payment.succeeded',
      data: { payment_id: 'pay_1' }, // no amount / advertiser id
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: 'pending_review',
          error: 'unresolvable_payment_payload',
        }),
      }),
    );
  });

  it('retains an unhandled event type for operator review, never silently dropping it', async () => {
    const { controller, prisma } = makeController();
    const { req } = signedRequest({ type: 'payout.created', data: { payout_id: 'po_1' } });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: 'dodo', eventId: 'msg_1' },
        data: expect.objectContaining({ processingStatus: 'pending_review' }),
      }),
    );
    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
  });

  it('never overwrites a pending_review event with a processed status', async () => {
    const { controller, prisma } = makeController();
    const { req } = signedRequest({ type: 'payout.created', data: { payout_id: 'po_1' } });

    await controller.handleWebhook(req);
    // The final converge step must be scoped to `processingStatus: 'pending'`,
    // so a handler's pending_review is preserved.
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: 'dodo', eventId: 'msg_1', processingStatus: 'pending' },
        data: expect.objectContaining({ processingStatus: 'processed' }),
      }),
    );
  });

  it('records a refund debit for a valid refund.succeeded event', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiserLedger.findMany = vi
      .fn()
      .mockResolvedValueOnce([]) // no active holds
      .mockResolvedValueOnce([
        {
          id: 'entry-1',
          advertiserId: 'adv-1',
          campaignId: null,
          amountMinor: 1000n,
          currency: 'USD',
        },
      ]);
    const { req } = signedRequest({
      type: 'refund.succeeded',
      data: { refund_id: 'ref_1', payment_id: 'pay_1', amount: 500, currency: 'usd' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.platformLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: 'cash',
          idempotencyKey: 'dodo_refund_plat_pay_1_ref_1',
        }),
      }),
    );
    expect(prisma.advertiserLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: 'refund',
          idempotencyKey: 'dodo_refund_pay_1_ref_1_entry-1',
        }),
      }),
    );
  });

  it('retains a refund that overlaps an open dispute for operator review', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiserLedger.findMany = vi.fn().mockResolvedValue([{ id: 'hold-1' }]);
    const { req } = signedRequest({
      type: 'refund.succeeded',
      data: { refund_id: 'ref_1', payment_id: 'pay_1', amount: 500, currency: 'usd' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: 'pending_review',
          error: 'refund_overlaps_dispute',
        }),
      }),
    );
  });

  it('freezes the disputed slice on dispute.opened', async () => {
    const { controller, prisma, audit, tx } = makeController();
    prisma.advertiserLedger.findMany = vi.fn().mockResolvedValue([
      {
        id: 'entry-1',
        advertiserId: 'adv-1',
        campaignId: null,
        amountMinor: 1000n,
        currency: 'USD',
      },
    ]);
    const { req } = signedRequest({
      type: 'dispute.opened',
      data: { dispute_id: 'dis_1', payment_id: 'pay_1', amount: '300', currency: 'usd' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.advertiserLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: 'hold',
          status: 'held',
          dodoDisputeId: 'dis_1',
        }),
      }),
    );
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dodo_dispute_opened' }),
    );
  });

  it('restores the held slice on dispute.won', async () => {
    const { controller, prisma, tx } = makeController();
    prisma.advertiserLedger.findMany = vi.fn().mockResolvedValue([
      {
        id: 'hold-1',
        advertiserId: 'adv-1',
        campaignId: null,
        dodoPaymentId: 'pay_1',
        amountMinor: 300n,
        currency: 'USD',
      },
    ]);
    const { req } = signedRequest({
      type: 'dispute.won',
      data: { dispute_id: 'dis_1', payment_id: 'pay_1' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(tx.advertiserLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: 'credit',
          status: 'confirmed',
          dodoDisputeId: 'dis_1',
        }),
      }),
    );
  });

  it('writes off the held slice and records platform cash on dispute.lost', async () => {
    const { controller, prisma, tx } = makeController();
    prisma.advertiserLedger.findMany = vi.fn().mockResolvedValue([
      {
        id: 'hold-1',
        advertiserId: 'adv-1',
        campaignId: null,
        dodoPaymentId: 'pay_1',
        amountMinor: 300n,
        currency: 'USD',
      },
    ]);
    const { req } = signedRequest({
      type: 'dispute.lost',
      data: { dispute_id: 'dis_1', payment_id: 'pay_1' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(tx.advertiserLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: 'refund',
          status: 'confirmed',
          dodoDisputeId: 'dis_1',
        }),
      }),
    );
    expect(prisma.platformLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: 'cash',
          idempotencyKey: 'dodo_dispute_plat_dis_1',
        }),
      }),
    );
  });

  it('retains an unresolvable refund payload for operator review', async () => {
    const { controller, prisma } = makeController();
    const { req } = signedRequest({
      type: 'refund.succeeded',
      data: { refund_id: 'ref_1' }, // no payment_id / amount
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: 'pending_review',
          error: 'unresolvable_refund_payload',
        }),
      }),
    );
  });

  it('records the platform cash side but skips the advertiser side for an orphan refund', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.advertiserLedger.findMany = vi
      .fn()
      .mockResolvedValueOnce([]) // no active holds
      .mockResolvedValueOnce([]); // no deposit credits
    const { req } = signedRequest({
      type: 'refund.succeeded',
      data: { refund_id: 'ref_1', payment_id: 'pay_1', amount: 500, currency: 'usd' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.platformLedger.create).toHaveBeenCalled();
    expect(prisma.advertiserLedger.create).not.toHaveBeenCalled();
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dodo_refund_orphan_advertiser' }),
    );
  });

  it('retains a dispute without a matching deposit for operator review', async () => {
    const { controller, prisma } = makeController();
    prisma.advertiserLedger.findMany = vi.fn().mockResolvedValue([]);
    const { req } = signedRequest({
      type: 'dispute.opened',
      data: { dispute_id: 'dis_1', payment_id: 'pay_1', amount: '300', currency: 'usd' },
    });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: 'pending_review',
          error: 'dispute_without_deposit',
        }),
      }),
    );
  });

  it('retains a dispute resolution missing its dispute id for operator review', async () => {
    const { controller, prisma } = makeController();
    const { req } = signedRequest({ type: 'dispute.won', data: { payment_id: 'pay_1' } });

    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: 'pending_review',
          error: 'unresolvable_dispute_payload',
        }),
      }),
    );
  });
});

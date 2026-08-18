import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDodoReconciliationReport } from './dodo-reconciliation.mjs';

const NOW = new Date('2026-08-18T12:00:00.000Z');

function webhook(eventId, type, data, overrides = {}) {
  return {
    provider: 'dodo',
    id: `row-${eventId}`,
    eventId,
    eventType: type,
    payload: { event: { type, data } },
    processingStatus: 'processed',
    createdAt: '2026-08-18T11:00:00.000Z',
    updatedAt: '2026-08-18T11:00:00.000Z',
    ...overrides,
  };
}

function advertiserRow(id, data) {
  return {
    id,
    entryType: 'credit',
    status: 'confirmed',
    amountMinor: BigInt(data.amountMinor ?? 1000),
    currency: data.currency ?? 'USD',
    dodoPaymentId: data.paymentId ?? null,
    dodoDisputeId: data.disputeId ?? null,
    idempotencyKey: data.idempotencyKey ?? `dodo_deposit_${data.paymentId ?? id}`,
  };
}

function platformRow(id, data) {
  return {
    id,
    entryType: data.entryType ?? 'credit',
    status: 'confirmed',
    amountMinor: BigInt(data.amountMinor ?? 1000),
    currency: data.currency ?? 'USD',
    bucket: 'cash',
    referenceId: data.referenceId ?? data.paymentId ?? null,
    idempotencyKey: data.idempotencyKey ?? `dodo_deposit_plat_${data.paymentId ?? id}`,
  };
}

test('reconciles a complete payment on both ledger sides', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook('wh-pay-1', 'payment.succeeded', {
        payment_id: 'pay-1',
        amount: '1000',
        currency: 'usd',
      }),
    ],
    advertiserLedger: [advertiserRow('adv-1', { paymentId: 'pay-1' })],
    platformLedger: [platformRow('plat-1', { paymentId: 'pay-1' })],
  });
  assert.equal(report.status, 'reconciled_platform_side');
  assert.deepEqual(report.mismatches, []);
  assert.equal(report.providerComparison.available, false);
});

test('flags duplicate webhook deliveries and duplicate advertiser credits', () => {
  const payment = { payment_id: 'pay-duplicate', amount: '1000', currency: 'USD' };
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook('wh-1', 'payment.succeeded', payment),
      webhook('wh-2', 'payment.succeeded', payment),
    ],
    advertiserLedger: [
      advertiserRow('adv-1', { paymentId: 'pay-duplicate' }),
      advertiserRow('adv-2', { paymentId: 'pay-duplicate' }),
    ],
    platformLedger: [platformRow('plat-1', { paymentId: 'pay-duplicate', amountMinor: 2000 })],
  });
  assert.equal(report.status, 'mismatch');
  assert.equal(report.duplicates.payments[0].id, 'pay-duplicate');
  assert.ok(report.mismatches.some((item) => item.code === 'duplicate_advertiser_payment_credit'));
  assert.ok(report.mismatches.some((item) => item.code === 'advertiser_amount_mismatch'));
});

test('flags missing advertiser and platform references', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook('wh-pay-2', 'payment.succeeded', {
        payment_id: 'pay-missing',
        amount: '500',
        currency: 'USD',
      }),
    ],
  });
  assert.equal(report.status, 'mismatch');
  assert.ok(report.mismatches.some((item) => item.code === 'missing_advertiser_credit'));
  assert.ok(report.mismatches.some((item) => item.code === 'missing_platform_cash'));
});

test('checks refund references and amount parity', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook('wh-refund', 'refund.succeeded', {
        refund_id: 'ref-1',
        payment_id: 'pay-1',
        amount: '400',
        currency: 'USD',
      }),
    ],
    advertiserLedger: [
      {
        ...advertiserRow('adv-refund', {
          paymentId: 'pay-1',
          amountMinor: 300,
          idempotencyKey: 'dodo_refund_pay-1_ref-1_adv-deposit',
        }),
        entryType: 'refund',
      },
    ],
    platformLedger: [
      platformRow('plat-refund', {
        entryType: 'refund',
        paymentId: 'pay-1',
        amountMinor: 400,
        idempotencyKey: 'dodo_refund_plat_pay-1_ref-1',
      }),
    ],
  });
  assert.equal(report.status, 'mismatch');
  assert.ok(report.mismatches.some((item) => item.code === 'advertiser_refund_amount_mismatch'));
});

test('flags an opened dispute with no matching hold and an unsettled terminal event', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook('wh-dispute-open', 'dispute.opened', {
        dispute_id: 'dis-1',
        payment_id: 'pay-1',
        amount: '250',
        currency: 'USD',
      }),
      webhook('wh-dispute-lost', 'dispute.lost', { dispute_id: 'dis-1', payment_id: 'pay-1' }),
    ],
  });
  assert.ok(report.mismatches.some((item) => item.code === 'missing_dispute_hold'));
  assert.ok(report.mismatches.some((item) => item.code === 'dispute_not_settled'));
});

test('reports pending review and stale processing without exposing payloads', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook(
        'wh-review',
        'payment.succeeded',
        { payment_id: 'pay-review', secret: 'must-not-print' },
        { processingStatus: 'pending_review', error: 'unresolvable_payment_payload' },
      ),
      webhook(
        'wh-stale',
        'payment.processing',
        {},
        { processingStatus: 'processing', updatedAt: '2026-08-18T10:00:00.000Z' },
      ),
    ],
  });
  assert.equal(report.status, 'review_required');
  assert.equal(report.pendingReview[0].eventId, 'wh-review');
  assert.equal(report.stale[0].eventId, 'wh-stale');
  assert.doesNotMatch(JSON.stringify(report), /must-not-print/);
});

test('flags orphaned ledger payment and dispute references', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    advertiserLedger: [
      advertiserRow('adv-orphan-pay', { paymentId: 'pay-never-seen' }),
      {
        ...advertiserRow('adv-orphan-dis', { paymentId: null, disputeId: 'dis-never-seen' }),
        entryType: 'hold',
        status: 'held',
      },
    ],
  });
  assert.ok(report.mismatches.some((item) => item.code === 'orphan_payment_ledger_reference'));
  assert.ok(report.mismatches.some((item) => item.code === 'orphan_dispute_ledger_reference'));
});

test('counts event types and excludes non-Dodo rows', () => {
  const report = buildDodoReconciliationReport({
    now: NOW,
    webhookEvents: [
      webhook('wh-pay', 'payment.processing', {}),
      {
        ...webhook('stripe-row', 'payment.succeeded', { payment_id: 'stripe-pay', amount: '1' }),
        provider: 'stripe',
      },
    ],
  });
  assert.deepEqual(report.eventTypes, { 'payment.processing': 1 });
  assert.equal(report.scope.webhookEvents, 1);
});

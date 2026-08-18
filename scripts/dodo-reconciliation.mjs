#!/usr/bin/env node
/**
 * Read-only Dodo reconciliation report.
 *
 * This compares the Dodo webhook events retained by WaitLayer with the
 * WaitLayer advertiser/platform ledger. It does not call Dodo, mutate rows, or
 * claim that the provider balance agrees: that final comparison requires live
 * Dodo credentials and a provider-side export/report.
 *
 * Usage:
 *   pnpm dodo:reconcile
 *   pnpm dodo:reconcile --json
 *   pnpm dodo:reconcile --since 2026-08-01T00:00:00Z --until 2026-08-18T00:00:00Z
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DODO_PROVIDER = 'dodo';
const DEFAULT_STALE_AFTER_MS = 35 * 60 * 1_000;
const RESOLVED_DISPUTE_EVENTS = new Set([
  'dispute.won',
  'dispute.cancelled',
  'dispute.lost',
  'dispute.accepted',
]);
const DISPUTE_EVENTS = new Set(['dispute.opened', ...RESOLVED_DISPUTE_EVENTS]);

function asString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function integerString(value) {
  const string = asString(value);
  return string && /^-?\d+$/.test(string) ? string : null;
}

function upperCurrency(value) {
  return asString(value)?.toUpperCase() ?? null;
}

function amountOf(row) {
  return integerString(row?.amountMinor);
}

function sumStrings(values) {
  if (values.some((value) => value === null)) return null;
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

function eventBody(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const event = payload.event && typeof payload.event === 'object' ? payload.event : payload;
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  return { event, data };
}

function providerId(data, primary, fallback = 'id') {
  return asString(data?.[primary]) ?? asString(data?.[fallback]);
}

function eventRecord(row) {
  const { data } = eventBody(row);
  const type = asString(row?.eventType) ?? asString(eventBody(row).event?.type) ?? '';
  return {
    id: asString(row?.id) ?? '',
    eventId: asString(row?.eventId) ?? '',
    type,
    processingStatus: asString(row?.processingStatus) ?? 'unknown',
    error: asString(row?.error),
    createdAt:
      row?.createdAt instanceof Date ? row.createdAt.toISOString() : asString(row?.createdAt),
    updatedAt:
      row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : asString(row?.updatedAt),
    paymentId: type.startsWith('payment.') ? providerId(data, 'payment_id') : null,
    refundId: type.startsWith('refund.') ? providerId(data, 'refund_id') : null,
    disputeId: type.startsWith('dispute.') ? providerId(data, 'dispute_id') : null,
    linkedPaymentId:
      type.startsWith('refund.') || type.startsWith('dispute.') ? asString(data?.payment_id) : null,
    amount:
      type === 'payment.succeeded' || type === 'refund.succeeded' || type === 'dispute.opened'
        ? integerString(data?.amount)
        : null,
    currency:
      type === 'payment.succeeded' || type === 'refund.succeeded' || type === 'dispute.opened'
        ? upperCurrency(data?.currency)
        : null,
  };
}

function ledgerRecord(row) {
  return {
    id: asString(row?.id) ?? '',
    entryType: asString(row?.entryType) ?? '',
    status: asString(row?.status) ?? '',
    amount: amountOf(row),
    currency: upperCurrency(row?.currency),
    paymentId: asString(row?.dodoPaymentId),
    disputeId: asString(row?.dodoDisputeId),
    idempotencyKey: asString(row?.idempotencyKey) ?? '',
  };
}

function platformRecord(row) {
  return {
    id: asString(row?.id) ?? '',
    entryType: asString(row?.entryType) ?? '',
    status: asString(row?.status) ?? '',
    amount: amountOf(row),
    currency: upperCurrency(row?.currency),
    referenceId: asString(row?.referenceId),
    idempotencyKey: asString(row?.idempotencyKey) ?? '',
    bucket: asString(row?.bucket) ?? '',
  };
}

function groupIds(records, field) {
  const groups = new Map();
  for (const record of records) {
    const id = record[field];
    if (!id) continue;
    const items = groups.get(id) ?? [];
    items.push(record);
    groups.set(id, items);
  }
  return groups;
}

function mismatch(code, id, detail) {
  return { code, id, detail };
}

/**
 * Pure report builder. Inputs are plain Prisma-shaped rows so this function is
 * usable by tests without a database and cannot accidentally write to one.
 */
export function buildDodoReconciliationReport({
  webhookEvents = [],
  advertiserLedger = [],
  platformLedger = [],
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const events = webhookEvents
    .filter((row) => row?.provider === undefined || row.provider === DODO_PROVIDER)
    .map(eventRecord);
  const advertiser = advertiserLedger.map(ledgerRecord);
  const platform = platformLedger.map(platformRecord);
  const mismatches = [];

  // Only events that converged to `processed` participate in ledger parity.
  // `pending_review` is reported separately; treating an intentionally held
  // event as a missing ledger row would turn an operator queue into a false
  // accounting mismatch.
  const processedEvents = events.filter((event) => event.processingStatus === 'processed');
  const paymentEvents = processedEvents.filter((event) => event.type === 'payment.succeeded');
  const refundEvents = processedEvents.filter((event) => event.type === 'refund.succeeded');
  const disputeEvents = processedEvents.filter((event) => DISPUTE_EVENTS.has(event.type));
  const paymentIds = new Set(paymentEvents.map((event) => event.paymentId).filter(Boolean));
  const disputeIds = new Set(disputeEvents.map((event) => event.disputeId).filter(Boolean));

  const duplicatePayments = [...groupIds(paymentEvents, 'paymentId').entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([id, rows]) => ({ id, eventIds: rows.map((row) => row.eventId) }));
  const duplicateRefunds = [...groupIds(refundEvents, 'refundId').entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([id, rows]) => ({ id, eventIds: rows.map((row) => row.eventId) }));
  const duplicateDisputes = [...groupIds(disputeEvents, 'disputeId').entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([id, rows]) => ({ id, eventIds: rows.map((row) => row.eventId) }));

  for (const duplicate of duplicatePayments) {
    mismatches.push(
      mismatch(
        'duplicate_payment_event',
        duplicate.id,
        `${duplicate.eventIds.length} succeeded events`,
      ),
    );
  }
  for (const duplicate of duplicateRefunds) {
    mismatches.push(
      mismatch(
        'duplicate_refund_event',
        duplicate.id,
        `${duplicate.eventIds.length} succeeded events`,
      ),
    );
  }
  for (const duplicate of duplicateDisputes) {
    mismatches.push(
      mismatch(
        'duplicate_dispute_event',
        duplicate.id,
        `${duplicate.eventIds.length} dispute events`,
      ),
    );
  }

  const paymentLedger = groupIds(
    advertiser.filter(
      (row) => row.entryType === 'credit' && row.paymentId && row.status === 'confirmed',
    ),
    'paymentId',
  );
  const paymentCash = groupIds(
    platform
      .filter(
        (row) => row.entryType === 'credit' && row.status === 'confirmed' && row.bucket === 'cash',
      )
      .filter((row) => row.referenceId),
    'referenceId',
  );

  for (const event of paymentEvents) {
    if (!event.paymentId) {
      mismatches.push(
        mismatch('payment_missing_id', event.eventId, 'payment.succeeded has no payment id'),
      );
      continue;
    }
    const advertiserRows = paymentLedger.get(event.paymentId) ?? [];
    const cashRows = paymentCash.get(event.paymentId) ?? [];
    if (advertiserRows.length === 0) {
      mismatches.push(
        mismatch('missing_advertiser_credit', event.paymentId, `webhook ${event.eventId}`),
      );
    } else if (event.amount && advertiserRows.some((row) => row.amount === null)) {
      mismatches.push(
        mismatch('invalid_advertiser_amount', event.paymentId, 'ledger amount is not an integer'),
      );
    } else if (event.amount) {
      const advertiserTotal = sumStrings(advertiserRows.map((row) => row.amount));
      if (advertiserTotal === null || advertiserTotal !== event.amount) {
        mismatches.push(
          mismatch(
            advertiserTotal === null ? 'invalid_advertiser_amount' : 'advertiser_amount_mismatch',
            event.paymentId,
            `Dodo=${event.amount}; ledger=${advertiserTotal ?? 'invalid'}`,
          ),
        );
      }
    }
    if (cashRows.length === 0) {
      mismatches.push(
        mismatch('missing_platform_cash', event.paymentId, `webhook ${event.eventId}`),
      );
    } else if (event.amount) {
      const platformTotal = sumStrings(cashRows.map((row) => row.amount));
      if (platformTotal === null || platformTotal !== event.amount) {
        mismatches.push(
          mismatch(
            platformTotal === null ? 'invalid_platform_amount' : 'platform_amount_mismatch',
            event.paymentId,
            `Dodo=${event.amount}; platform=${platformTotal ?? 'invalid'}`,
          ),
        );
      }
    }
    const currencies = [
      ...new Set([...advertiserRows, ...cashRows].map((row) => row.currency).filter(Boolean)),
    ];
    if (event.currency && currencies.some((currency) => currency !== event.currency)) {
      mismatches.push(
        mismatch(
          'payment_currency_mismatch',
          event.paymentId,
          `Dodo=${event.currency}; ledger=${currencies.join(',')}`,
        ),
      );
    }
  }

  for (const event of refundEvents) {
    if (!event.refundId || !event.linkedPaymentId) {
      mismatches.push(
        mismatch(
          'refund_missing_reference',
          event.eventId,
          'refund.succeeded lacks refund_id or payment_id',
        ),
      );
      continue;
    }
    const prefix = `dodo_refund_${event.linkedPaymentId}_${event.refundId}_`;
    const advertiserRows = advertiser.filter(
      (row) =>
        row.entryType === 'refund' &&
        row.status === 'confirmed' &&
        row.paymentId === event.linkedPaymentId &&
        row.idempotencyKey.startsWith(prefix),
    );
    const cashRows = platform.filter(
      (row) =>
        row.entryType === 'refund' &&
        row.status === 'confirmed' &&
        row.bucket === 'cash' &&
        row.idempotencyKey === `dodo_refund_plat_${event.linkedPaymentId}_${event.refundId}`,
    );
    if (advertiserRows.length === 0)
      mismatches.push(
        mismatch('missing_advertiser_refund', event.refundId, `payment ${event.linkedPaymentId}`),
      );
    if (cashRows.length === 0)
      mismatches.push(
        mismatch('missing_platform_refund', event.refundId, `payment ${event.linkedPaymentId}`),
      );
    for (const [kind, rows] of [
      ['advertiser', advertiserRows],
      ['platform', cashRows],
    ]) {
      if (event.amount && rows.length > 0) {
        const total = sumStrings(rows.map((row) => row.amount));
        if (total === null || total !== event.amount) {
          mismatches.push(
            mismatch(
              `${kind}_refund_amount_mismatch`,
              event.refundId,
              `Dodo=${event.amount}; ${kind}=${total ?? 'invalid'}`,
            ),
          );
        }
      }
    }
  }

  const openedDisputes = disputeEvents.filter((event) => event.type === 'dispute.opened');
  const holds = groupIds(
    advertiser.filter((row) => row.entryType === 'hold' && row.status === 'held'),
    'disputeId',
  );
  for (const event of openedDisputes) {
    if (!event.disputeId) {
      mismatches.push(
        mismatch('dispute_missing_id', event.eventId, 'dispute.opened has no dispute id'),
      );
      continue;
    }
    const rows = holds.get(event.disputeId) ?? [];
    if (rows.length === 0) {
      mismatches.push(
        mismatch('missing_dispute_hold', event.disputeId, `webhook ${event.eventId}`),
      );
    } else if (event.amount) {
      const total = sumStrings(rows.map((row) => row.amount));
      if (total === null || total !== event.amount) {
        mismatches.push(
          mismatch(
            'dispute_hold_amount_mismatch',
            event.disputeId,
            `Dodo=${event.amount}; held=${total ?? 'invalid'}`,
          ),
        );
      }
    }
  }
  for (const event of disputeEvents.filter((item) => RESOLVED_DISPUTE_EVENTS.has(item.type))) {
    if (
      event.disputeId &&
      !advertiser.some((row) => row.disputeId === event.disputeId && row.status === 'reversed')
    ) {
      mismatches.push(
        mismatch('dispute_not_settled', event.disputeId, `terminal event ${event.type}`),
      );
    }
  }

  for (const row of advertiser.filter(
    (item) => item.paymentId && !paymentIds.has(item.paymentId),
  )) {
    mismatches.push(
      mismatch('orphan_payment_ledger_reference', row.paymentId, `ledger row ${row.id}`),
    );
  }
  for (const row of advertiser.filter(
    (item) => item.disputeId && !disputeIds.has(item.disputeId),
  )) {
    mismatches.push(
      mismatch('orphan_dispute_ledger_reference', row.disputeId, `ledger row ${row.id}`),
    );
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const staleCutoff = nowMs - staleAfterMs;
  const pendingReview = events
    .filter((event) => event.processingStatus === 'pending_review')
    .map((event) => ({ eventId: event.eventId, type: event.type, error: event.error }));
  const stale = events
    .filter((event) => ['pending', 'processing'].includes(event.processingStatus))
    .filter((event) => event.updatedAt && new Date(event.updatedAt).getTime() < staleCutoff)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      processingStatus: event.processingStatus,
      updatedAt: event.updatedAt,
    }));

  const ledgerPaymentDuplicates = [
    ...groupIds(
      advertiser.filter((row) => row.entryType === 'credit' && row.paymentId),
      'paymentId',
    ).entries(),
  ]
    .filter(([, rows]) => rows.length > 1)
    .map(([id, rows]) => ({ id, ledgerRowIds: rows.map((row) => row.id) }));
  for (const duplicate of ledgerPaymentDuplicates) {
    mismatches.push(
      mismatch(
        'duplicate_advertiser_payment_credit',
        duplicate.id,
        `${duplicate.ledgerRowIds.length} ledger rows`,
      ),
    );
  }

  const eventTypes = Object.fromEntries(
    [
      ...events.reduce(
        (counts, event) => counts.set(event.type, (counts.get(event.type) ?? 0) + 1),
        new Map(),
      ),
    ].sort(),
  );
  const result = {
    provider: DODO_PROVIDER,
    generatedAt: new Date(nowMs).toISOString(),
    scope: {
      webhookEvents: events.length,
      advertiserLedgerRows: advertiser.length,
      platformLedgerRows: platform.length,
    },
    status:
      mismatches.length > 0
        ? 'mismatch'
        : pendingReview.length > 0 || stale.length > 0
          ? 'review_required'
          : 'reconciled_platform_side',
    providerComparison: {
      available: false,
      reason: 'A live Dodo balance/export is required for provider-vs-ledger reconciliation.',
    },
    eventTypes,
    duplicates: {
      payments: duplicatePayments,
      refunds: duplicateRefunds,
      disputes: duplicateDisputes,
      advertiserPaymentCredits: ledgerPaymentDuplicates,
    },
    pendingReview,
    stale,
    mismatches,
  };
  return result;
}

function parseDate(value, flag) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${flag} must be an ISO date`);
  return date;
}

async function readFromDatabase({ since, until } = {}) {
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const { PrismaClient, createPrismaAdapter } = require('@waitlayer/db');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
  const date = {
    ...(since ? { gte: since } : {}),
    ...(until ? { lte: until } : {}),
  };
  try {
    const [webhookEvents, advertiserLedger, platformLedger] = await Promise.all([
      prisma.webhookEvent.findMany({
        where: {
          provider: DODO_PROVIDER,
          ...(Object.keys(date).length > 0 ? { createdAt: date } : {}),
        },
        select: {
          id: true,
          provider: true,
          eventId: true,
          eventType: true,
          payload: true,
          processingStatus: true,
          processedAt: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.advertiserLedger.findMany({
        where: {
          OR: [{ dodoPaymentId: { not: null } }, { dodoDisputeId: { not: null } }],
          ...(Object.keys(date).length > 0 ? { createdAt: date } : {}),
        },
        select: {
          id: true,
          entryType: true,
          status: true,
          amountMinor: true,
          currency: true,
          dodoPaymentId: true,
          dodoDisputeId: true,
          idempotencyKey: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.platformLedger.findMany({
        where: {
          bucket: 'cash',
          idempotencyKey: { startsWith: 'dodo_' },
          ...(Object.keys(date).length > 0 ? { createdAt: date } : {}),
        },
        select: {
          id: true,
          entryType: true,
          status: true,
          amountMinor: true,
          currency: true,
          bucket: true,
          referenceId: true,
          idempotencyKey: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { webhookEvents, advertiserLedger, platformLedger };
  } finally {
    await prisma.$disconnect();
  }
}

function printHuman(report) {
  console.log(`Dodo reconciliation: ${report.status}`);
  console.log(
    `Scope: ${report.scope.webhookEvents} webhook event(s), ${report.scope.advertiserLedgerRows} advertiser ledger row(s), ${report.scope.platformLedgerRows} platform cash row(s)`,
  );
  console.log(
    `Events: ${
      Object.entries(report.eventTypes)
        .map(([type, count]) => `${type}=${count}`)
        .join(', ') || 'none'
    }`,
  );
  console.log(`Mismatches: ${report.mismatches.length}`);
  for (const item of report.mismatches)
    console.log(`  - ${item.code}: ${item.id} (${item.detail})`);
  console.log(`Pending review: ${report.pendingReview.length}; stale: ${report.stale.length}`);
  console.log('Provider comparison: unavailable until a live Dodo balance/export is supplied.');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const values = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = values.indexOf(flag);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const since = parseDate(valueAfter('--since'), '--since');
  const until = parseDate(valueAfter('--until'), '--until');
  const rows = await readFromDatabase({ since, until });
  const report = buildDodoReconciliationReport({
    webhookEvents: rows.webhookEvents,
    advertiserLedger: rows.advertiserLedger,
    platformLedger: rows.platformLedger,
  });
  if (args.has('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (report.status === 'mismatch') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `dodo:reconcile: ${error instanceof Error ? error.message : 'unable to read reconciliation data'}`,
    );
    process.exitCode = 1;
  });
}

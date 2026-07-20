import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PayoutStatus } from '@waitlayer/shared';

import { AlertsService } from '../observability/alerts.service';
import { MetricsService } from '../observability/metrics.service';
import { PayoutCronService } from './payout-cron.service';

const mockPrisma = {
  $queryRaw: vi.fn().mockResolvedValue([{ key: 'payout-status-poll' }]),
  payoutRequest: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  },
  payoutTransaction: {
    create: vi.fn(),
  },
  payoutAllocation: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    return arg;
  }),
};

const mockPayPalProvider = {
  checkStatus: vi.fn(),
};

const mockStripeProvider = {
  checkStatus: vi.fn(),
};

const mockPayoutService = {
  getProvider: vi.fn(),
  markPayoutPaid: vi.fn().mockResolvedValue({ status: 'paid', id: 'req_123' }),
  markPayoutFailed: vi.fn().mockResolvedValue({ status: 'failed', id: 'req_123' }),
};

const mockReferral = {
  reconcilePendingReferralRewards: vi
    .fn()
    .mockResolvedValue({ checked: 0, rewarded: 0, failed: 0, hasMore: false }),
};

const mockRuntimeConfig = {
  isAutoPayoutProcessingEnabled: vi.fn().mockResolvedValue(true),
};

const mockMetrics = {
  increment: vi.fn(),
  gauge: vi.fn(),
  snapshot: vi.fn().mockReturnValue({ counters: {}, gauges: {} }),
  recordRetainedPayoutFence: vi.fn(),
} as unknown as MetricsService;
const mockAlerts = {
  alert: vi.fn(),
  alertPayoutEscalation: vi.fn(),
  alertPayoutFenceAge: vi.fn(),
  alertAmbiguousPayoutOutcome: vi.fn(),
  alertProviderFailureRate: vi.fn(),
  recordRate: vi.fn(),
} as unknown as AlertsService;
describe('PayoutCronService', () => {
  let service: PayoutCronService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PayoutCronService(
      mockPrisma as any,
      mockPayoutService as any,
      mockReferral as any,
      mockRuntimeConfig as any,
      mockMetrics,
      mockAlerts,
    );
    // Prevent the actual interval from starting in tests
    vi.spyOn(service as any, 'pollProcessingPayouts').mockResolvedValue({
      checked: 0,
      completed: 0,
      failed: 0,
    });
  });

  describe('pollProcessingPayouts', () => {
    it('returns zero counts when no processing payouts exist', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([]);

      // Restore the real method for this test
      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 0, failed: 0 });
      expect(mockPrisma.payoutRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: PayoutStatus.PROCESSING,
          processedAt: { lte: expect.any(Date) },
        },
        include: {
          payoutAccount: true,
          transactions: {
            where: { status: 'processing' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ processedAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
    });

    it('records a reconciliation attempt for a payout with no provider transaction (no silent skip)', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@test.com' },
          transactions: [], // no transaction row
          reconciliationLog: null,
        },
      ]);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      // The cron now always polls a processing payout (including ambiguous
      // initiations with no provider transaction) via the provider's
      // checkStatus, so checkStatus must be exercised and `checked` incremented.
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'processing' });
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(mockPayoutService.getProvider).toHaveBeenCalledWith('paypal_payouts');
      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledTimes(2);
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'req_1' });
      expect(updateCall.data.reconciliationAttempts).toEqual({ increment: 1 });
      expect(updateCall.data.escalatedAt).toBeUndefined();
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'no_provider_txid' },
      ]);
      expect(mockAlerts.alertPayoutEscalation).not.toHaveBeenCalled();
    });

    it('skips payouts with unavailable provider', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          payoutAccount: { provider: 'unknown_provider', destination: 'dev@test.com' },
          transactions: [{ providerTxId: 'tx_123' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(undefined);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 0, failed: 0 });
      expect(mockPayoutService.getProvider).toHaveBeenCalledWith('unknown_provider');
    });

    it('marks payout as paid when provider reports success', async () => {
      const paidAt = new Date('2026-07-07T12:00:00Z');
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          currency: 'USD',
          requestedAmountMinor: 2500n,
          approvedAmountMinor: null,
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
          transactions: [{ providerTxId: 'pp_tx_123' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'paid', paidAt });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 1, failed: 0 });
      expect(mockPayPalProvider.checkStatus).toHaveBeenCalledWith('pp_tx_123', {
        destination: 'dev@paypal.com',
        externalReference: 'req_1',
      });
      expect(mockPayoutService.markPayoutPaid).toHaveBeenCalledWith('req_1', {
        providerTxId: 'pp_tx_123',
        paidAt: paidAt.toISOString(),
        expectedAmountMinor: 2500n,
        expectedCurrency: 'USD',
      });
    });

    it('marks payout as failed when provider reports failure', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
          transactions: [{ providerTxId: 'pp_tx_fail' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'failed' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 1 });
      expect(mockPayoutService.markPayoutFailed).toHaveBeenCalledWith('req_1', {
        provider: 'paypal_payouts',
        providerTxId: 'pp_tx_fail',
        failureReason: 'Provider reported failure via status poll',
      });
    });

    it('skips payout still processing (not yet terminal)', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
          transactions: [{ providerTxId: 'pp_tx_pending' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'processing' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(mockPayoutService.markPayoutPaid).not.toHaveBeenCalled();
      expect(mockPayoutService.markPayoutFailed).not.toHaveBeenCalled();
    });

    it('continues to next payout when one check fails', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_good',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'good@paypal.com' },
          transactions: [{ providerTxId: 'pp_good' }],
        },
        {
          id: 'req_error',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'stripe_connect', destination: 'acct_error' },
          transactions: [{ providerTxId: 'sc_error' }],
        },
      ]);

      mockPayoutService.getProvider
        .mockReturnValueOnce(mockPayPalProvider)
        .mockReturnValueOnce(mockStripeProvider);

      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'paid', paidAt: new Date() });
      mockStripeProvider.checkStatus.mockRejectedValue(new Error('Network error'));

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 2, completed: 1, failed: 0 });
      expect(mockPayoutService.markPayoutPaid).toHaveBeenCalledTimes(1);
      expect(mockPayoutService.markPayoutPaid).toHaveBeenCalledWith('req_good', expect.any(Object));
    });

    it('handles prisma query error gracefully', async () => {
      mockPrisma.payoutRequest.findMany.mockRejectedValue(new Error('DB connection lost'));

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 0, failed: 0 });
    });

    it('uses current time as fallback when provider does not return paidAt', async () => {
      const before = Date.now();
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@paypal.com' },
          transactions: [{ providerTxId: 'pp_tx_123' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'paid', paidAt: undefined });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result.checked).toBe(1);
      expect(result.completed).toBe(1);
      const paidCall = mockPayoutService.markPayoutPaid.mock.calls[0];
      const paidAtDate = new Date(paidCall[1].paidAt).getTime();
      expect(paidAtDate).toBeGreaterThanOrEqual(before);
      expect(paidAtDate).toBeLessThanOrEqual(Date.now());
    });

    it('skips overlapping polls', async () => {
      (service as any).pollInFlight = true;

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 0, failed: 0 });
      expect(mockPrisma.payoutRequest.findMany).not.toHaveBeenCalled();
    });
    it('fires a payout-fence-age alert for a long-stuck processing payout (P1.25)', async () => {
      const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_old',
          status: 'processing',
          currency: 'USD',
          requestedAmountMinor: 1000n,
          approvedAmountMinor: 1000n,
          processedAt: old,
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [{ providerTxId: 'tx_x' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'processing' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      await service.pollProcessingPayouts();

      expect(mockAlerts.alertPayoutFenceAge).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 'req_old' }),
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith('payout_poll_checked', 1);
    });

    it('escalates a long-stuck processing payout without a provider transaction (P1.10)', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_aged',
          status: 'processing',
          processedAt: old,
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [], // ambiguous initiation, no providerTxId
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      await service.pollProcessingPayouts();

      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledTimes(2);
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.escalatedAt).toBeInstanceOf(Date);
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'no_provider_txid' },
      ]);
      expect(mockAlerts.alertPayoutEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 'req_aged', reason: 'no_provider_txid' }),
      );
    });

    it('escalates a long-stuck processing payout the provider still reports processing (P1.10)', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_stuck',
          status: 'processing',
          processedAt: old,
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [{ providerTxId: 'tx_stuck' }],
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'processing' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      await service.pollProcessingPayouts();

      expect(mockAlerts.alertPayoutEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 'req_stuck', reason: 'still_processing' }),
      );
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.escalatedAt).toBeInstanceOf(Date);
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'processing' },
      ]);
    });
    it('treats initiate_pending as ambiguous and retains the fence (P1.10)', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_init',
          status: 'processing',
          processedAt: old,
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [{ providerTxId: 'tx_init' }],
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockPayPalProvider);
      mockPayPalProvider.checkStatus.mockResolvedValue({ status: 'initiate_pending' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(mockPayoutService.markPayoutPaid).not.toHaveBeenCalled();
      expect(mockPayoutService.markPayoutFailed).not.toHaveBeenCalled();
      expect(mockAlerts.alertPayoutEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 'req_init', reason: 'still_processing' }),
      );
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'initiate_pending' },
      ]);
    });

    it('treats requires_review as ambiguous and retains the fence (P1.10)', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_review',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'stripe_connect', destination: 'acct_x' },
          transactions: [{ providerTxId: 'po_review' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockStripeProvider);
      mockStripeProvider.checkStatus.mockResolvedValue({ status: 'requires_review' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(mockPayoutService.markPayoutPaid).not.toHaveBeenCalled();
      expect(mockPayoutService.markPayoutFailed).not.toHaveBeenCalled();
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'requires_review' },
      ]);
    });

    it('resolves a no-provider-txid payout via external-reference lookup when paid (P1.10)', async () => {
      const paidAt = new Date('2026-07-07T12:00:00Z');
      const mockRefProvider = {
        checkStatus: vi.fn(),
        checkStatusByReference: vi.fn().mockResolvedValue({ status: 'paid', paidAt }),
      };
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_ref_paid',
          status: 'processing',
          currency: 'USD',
          requestedAmountMinor: 2500n,
          approvedAmountMinor: null,
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [], // no providerTxId (ambiguous initiation)
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockRefProvider);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 1, failed: 0 });
      expect(mockRefProvider.checkStatusByReference).toHaveBeenCalledWith('req_ref_paid', {
        destination: 'dev@x.com',
      });
      expect(mockPayoutService.markPayoutPaid).toHaveBeenCalledWith(
        'req_ref_paid',
        expect.objectContaining({ expectedAmountMinor: 2500n, expectedCurrency: 'USD' }),
      );
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'ref_paid' },
      ]);
    });

    it('resolves a no-provider-txid payout via external-reference lookup when failed (P1.10)', async () => {
      const mockRefProvider = {
        checkStatus: vi.fn(),
        checkStatusByReference: vi.fn().mockResolvedValue({ status: 'failed' }),
      };
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_ref_fail',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [],
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockRefProvider);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 0, failed: 1 });
      expect(mockPayoutService.markPayoutFailed).toHaveBeenCalledWith(
        'req_ref_fail',
        expect.objectContaining({ provider: 'paypal_payouts' }),
      );
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'ref_failed' },
      ]);
    });

    it('falls back to attempt+escalate when external-reference lookup returns processing (P1.10)', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const mockRefProvider = {
        checkStatus: vi.fn(),
        checkStatusByReference: vi.fn().mockResolvedValue({ status: 'processing' }),
      };
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_ref_pending',
          status: 'processing',
          processedAt: old,
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@x.com' },
          transactions: [],
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockRefProvider);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      await service.pollProcessingPayouts();

      expect(mockRefProvider.checkStatusByReference).toHaveBeenCalledWith('req_ref_pending', {
        destination: 'dev@x.com',
      });
      expect(mockPayoutService.markPayoutPaid).not.toHaveBeenCalled();
      expect(mockPayoutService.markPayoutFailed).not.toHaveBeenCalled();
      expect(mockAlerts.alertPayoutEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 'req_ref_pending', reason: 'no_provider_txid' }),
      );
      const updateCall = mockPrisma.payoutRequest.update.mock.calls[0][0];
      expect(updateCall.data.reconciliationLog).toEqual([
        { at: expect.any(String), outcome: 'no_provider_txid' },
      ]);
    });
    it('alerts on a true ambiguous initiation (e.g. requires_review) without escalating (P1.25)', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_amb',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'stripe_connect', destination: 'acct_x' },
          transactions: [{ providerTxId: 'po_amb' }],
          reconciliationLog: null,
          escalatedAt: null,
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockStripeProvider);
      mockStripeProvider.checkStatus.mockResolvedValue({ status: 'requires_review' });

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(mockAlerts.alertAmbiguousPayoutOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          payoutId: 'req_amb',
          provider: 'stripe_connect',
          status: 'requires_review',
          reason: 'unresolved_ambiguous_initiation',
        }),
      );
      // A recent payout must not escalate, and the narrow subset must not trip
      // the escalation path either.
      expect(mockAlerts.alertPayoutEscalation).not.toHaveBeenCalled();
    });

    it('records provider failures and alerts once the 15-min count reaches 5 (P1.25)', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_fail',
          status: 'processing',
          currency: 'USD',
          payoutAccount: { provider: 'stripe_connect', destination: 'acct_err' },
          transactions: [{ providerTxId: 'sc_err' }],
        },
      ]);
      mockPayoutService.getProvider.mockReturnValue(mockStripeProvider);
      mockStripeProvider.checkStatus.mockRejectedValue(new Error('Network error'));
      mockAlerts.recordRate.mockReturnValue(5);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(mockAlerts.recordRate).toHaveBeenCalledWith(
        'provider_failure',
        'stripe_connect',
        15 * 60 * 1000,
      );
      expect(mockAlerts.alertProviderFailureRate).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'stripe_connect', count: 5, windowMs: 900_000 }),
      );
    });
  });
});

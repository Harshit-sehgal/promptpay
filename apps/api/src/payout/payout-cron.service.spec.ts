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
  alertPayoutFenceAge: vi.fn(),
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

    it('skips payouts with no provider transaction', async () => {
      mockPrisma.payoutRequest.findMany.mockResolvedValue([
        {
          id: 'req_1',
          status: 'processing',
          payoutAccount: { provider: 'paypal_payouts', destination: 'dev@test.com' },
          transactions: [], // no transaction row
        },
      ]);

      vi.mocked(service as any).pollProcessingPayouts.mockRestore();
      const result = await service.pollProcessingPayouts();

      expect(result).toEqual({ checked: 0, completed: 0, failed: 0 });
      expect(mockPayoutService.getProvider).not.toHaveBeenCalled();
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
  });
});

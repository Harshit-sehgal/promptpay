// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminPayoutsPage from './page';

const { unfrozenPayout, frozenPayout, underReviewJpyPayout, processingJpyPayout } = vi.hoisted(
  () => {
    const payout = {
      id: 'payout-1',
      userId: 'user-1',
      user: { email: 'developer@example.com', trustLevel: 'standard' },
      status: 'approved' as const,
      requestedAmountMinor: 2_500n,
      approvedAmountMinor: 2_500n,
      currency: 'USD',
      payoutAccount: {
        id: 'account-123',
        provider: 'paypal_email',
        destination: 'developer@example.com',
        isVerified: true,
        isFrozen: false,
      },
      transactions: [],
      createdAt: '2026-07-16T08:00:00.000Z',
    };

    return {
      unfrozenPayout: payout,
      frozenPayout: {
        ...payout,
        payoutAccount: { ...payout.payoutAccount, isFrozen: true },
      },
      underReviewJpyPayout: {
        ...payout,
        id: 'payout-jpy-review',
        status: 'under_review' as const,
        requestedAmountMinor: 2_500n,
        approvedAmountMinor: null,
        currency: 'JPY',
      },
      processingJpyPayout: {
        ...payout,
        id: 'payout-jpy-processing',
        status: 'processing' as const,
        requestedAmountMinor: 2_500n,
        approvedAmountMinor: 2_000n,
        currency: 'JPY',
      },
    };
  },
);

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getPendingPayouts: vi.fn(),
    freezePayoutAccount: vi.fn(),
    unfreezePayoutAccount: vi.fn(),
    processPayout: vi.fn(),
  },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
}));

vi.mock('@/lib/format', () => ({
  formatCurrency: (amount: bigint | number, currency: string) => `${currency} ${amount}`,
  formatCurrencyBreakdown: () => 'USD 2500',
  formatRelativeTime: (date: string) => date,
}));

describe('AdminPayoutsPage payout-account emergency controls', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getPendingPayouts).mockReset();
    vi.mocked(adminApi.freezePayoutAccount).mockReset();
    vi.mocked(adminApi.unfreezePayoutAccount).mockReset();
    vi.mocked(adminApi.processPayout).mockReset();
  });

  afterEach(() => cleanup());

  it('freezes with a reason, refreshes state, and blocks outbound processing', async () => {
    vi.mocked(adminApi.getPendingPayouts)
      .mockResolvedValueOnce({ data: [unfrozenPayout] } as never)
      .mockResolvedValueOnce({ data: [frozenPayout] } as never)
      .mockResolvedValueOnce({ data: [unfrozenPayout] } as never);
    vi.mocked(adminApi.freezePayoutAccount).mockResolvedValue({} as never);
    vi.mocked(adminApi.unfreezePayoutAccount).mockResolvedValue({} as never);

    render(createElement(AdminPayoutsPage));

    expect(await screen.findByText('Account account-123')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Process' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Freeze account' }));
    expect(screen.getByRole('dialog', { name: 'Freeze payout account' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Operator reason'), {
      target: { value: 'Destination reported compromised' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm freeze' }));

    await waitFor(() => {
      expect(adminApi.freezePayoutAccount).toHaveBeenCalledWith(
        'account-123',
        'Destination reported compromised',
      );
      expect(adminApi.getPendingPayouts).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText('· frozen')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Process' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unfreeze account' }));
    fireEvent.change(screen.getByLabelText('Operator reason'), {
      target: { value: 'Investigation cleared' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unfreeze' }));

    await waitFor(() => {
      expect(adminApi.unfreezePayoutAccount).toHaveBeenCalledWith(
        'account-123',
        'Investigation cleared',
      );
      expect(adminApi.getPendingPayouts).toHaveBeenCalledTimes(3);
    });

    expect(await screen.findByRole('button', { name: 'Freeze account' })).toBeTruthy();
    expect(screen.queryByText('· frozen')).toBeNull();
    expect((screen.getByRole('button', { name: 'Process' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps the modal open and surfaces an API failure', async () => {
    vi.mocked(adminApi.getPendingPayouts).mockResolvedValue({ data: [unfrozenPayout] } as never);
    vi.mocked(adminApi.freezePayoutAccount).mockRejectedValue(
      new Error('Freeze service unavailable'),
    );

    render(createElement(AdminPayoutsPage));
    fireEvent.click(await screen.findByRole('button', { name: 'Freeze account' }));
    fireEvent.change(screen.getByLabelText('Operator reason'), {
      target: { value: 'Fraud investigation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm freeze' }));

    expect(await screen.findByText('Freeze service unavailable')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Freeze payout account' })).toBeTruthy();
    expect(adminApi.getPendingPayouts).toHaveBeenCalledTimes(1);
  });

  it('uses whole-unit approval bounds and labels for JPY', async () => {
    vi.mocked(adminApi.getPendingPayouts).mockResolvedValue({
      data: [underReviewJpyPayout],
    } as never);

    render(createElement(AdminPayoutsPage));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(screen.getByText('Approved amount (JPY)')).toBeTruthy();
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.step).toBe('1');
    expect(input.min).toBe('1');
    expect(input.max).toBe('2500');
    expect(input.value).toBe('2500');
  });

  it('uses the approved JPY amount as the reconciliation maximum', async () => {
    vi.mocked(adminApi.getPendingPayouts).mockResolvedValue({
      data: [processingJpyPayout],
    } as never);

    render(createElement(AdminPayoutsPage));
    fireEvent.click(await screen.findByRole('button', { name: 'Reconcile' }));

    expect(screen.getByText('Paid amount (JPY)')).toBeTruthy();
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.step).toBe('1');
    expect(input.min).toBe('1');
    expect(input.max).toBe('2000');
    expect(input.value).toBe('2000');
  });
});

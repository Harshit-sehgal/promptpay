// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminFencedPayoutAccountsPage from './page';

const fencedAccount = vi.hoisted(() => ({
  id: 'pa-1',
  userId: 'user-1',
  provider: 'wise',
  destination: 'wise-dest',
  currency: 'USD',
  isVerified: true,
  isActive: true,
  isFrozen: true,
  initiationPayoutId: 'payout-init-1',
  user: { id: 'user-1', email: 'developer@example.com' },
  reconciliationAttempts: 3,
  lastReconciliationAt: '2026-07-19T10:00:00.000Z',
  escalatedAt: null,
  activeFraudFlags: 2,
  ledgerAllocations: { count: 2, totalMinor: 150_000n, currency: 'USD' },
}));

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getFencedAccounts: vi.fn(),
    releasePayoutFence: vi.fn(),
  },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
}));

vi.mock('@/lib/format', () => ({
  formatCurrency: (amount: bigint | number, currency: string) => `${currency} ${amount}`,
  formatRelativeTime: (date: string) => date,
}));

const listResponse = (items: unknown[], total: number, page = 1, limit = 50) =>
  ({ data: { items, total, page, limit } }) as never;

describe('AdminFencedPayoutAccountsPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getFencedAccounts).mockReset();
    vi.mocked(adminApi.releasePayoutFence).mockReset();
  });

  afterEach(() => cleanup());

  it('fetches the fenced list on mount with default pagination (page/limit)', async () => {
    vi.mocked(adminApi.getFencedAccounts).mockResolvedValue(
      listResponse([fencedAccount], 1, 1, 50),
    );

    render(createElement(AdminFencedPayoutAccountsPage));

    await waitFor(() => {
      expect(adminApi.getFencedAccounts).toHaveBeenCalledWith({ page: 1, limit: 50 });
    });

    // Owner, payout id, and forensic columns render.
    expect(await screen.findByText('developer@example.com')).toBeTruthy();
    expect(screen.getByText('wise — wise-dest')).toBeTruthy();
    expect(screen.getByText('payout-init-1')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
    // activeFraudFlags + reconciliationAttempts
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('shows an empty state when no fenced accounts are returned', async () => {
    vi.mocked(adminApi.getFencedAccounts).mockResolvedValue(listResponse([], 0));

    render(createElement(AdminFencedPayoutAccountsPage));

    expect(await screen.findByText('No fenced payout accounts. All clear.')).toBeTruthy();
  });

  it('releases the fence with the correct POST payload and refreshes the list', async () => {
    vi.mocked(adminApi.getFencedAccounts)
      .mockResolvedValueOnce(listResponse([fencedAccount], 1, 1, 50))
      .mockResolvedValueOnce(listResponse([], 0, 1, 50));
    vi.mocked(adminApi.releasePayoutFence).mockResolvedValue({} as never);

    render(createElement(AdminFencedPayoutAccountsPage));

    fireEvent.click(await screen.findByRole('button', { name: 'Release fence' }));

    fireEvent.change(screen.getByLabelText('Release reason (required, ≥ 5 chars)'), {
      target: { value: 'Provider confirmed failure' },
    });
    fireEvent.change(screen.getByLabelText('Provider transaction id (optional)'), {
      target: { value: 'txn_abc123' },
    });
    fireEvent.change(screen.getByLabelText('Resolution summary (optional)'), {
      target: { value: 'Failed at provider' },
    });
    fireEvent.change(
      screen.getByLabelText('Second approver id (required for high-value releases)'),
      {
        target: { value: 'approver-2' },
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));

    await waitFor(() => {
      expect(adminApi.releasePayoutFence).toHaveBeenCalledWith('pa-1', {
        reason: 'Provider confirmed failure',
        providerTxId: 'txn_abc123',
        resolution: 'Failed at provider',
        secondApproverId: 'approver-2',
      });
    });

    // The list is refreshed after a successful release.
    await waitFor(() => expect(adminApi.getFencedAccounts).toHaveBeenCalledTimes(2));
  });

  it('disables release submit until the reason is at least 5 characters', async () => {
    vi.mocked(adminApi.getFencedAccounts).mockResolvedValue(
      listResponse([fencedAccount], 1, 1, 50),
    );

    render(createElement(AdminFencedPayoutAccountsPage));
    fireEvent.click(await screen.findByRole('button', { name: 'Release fence' }));

    const submit = screen.getByRole('button', { name: 'Confirm release' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Release reason (required, ≥ 5 chars)'), {
      target: { value: 'abc' },
    });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Release reason (required, ≥ 5 chars)'), {
      target: { value: 'valid reason' },
    });
    expect(submit.disabled).toBe(false);
    // No API call should fire from validation alone.
    expect(adminApi.releasePayoutFence).not.toHaveBeenCalled();
  });

  it('surfaces an API rejection (non-terminal payout / missing approver) and keeps the modal open', async () => {
    vi.mocked(adminApi.getFencedAccounts).mockResolvedValue(
      listResponse([fencedAccount], 1, 1, 50),
    );
    vi.mocked(adminApi.releasePayoutFence).mockRejectedValue(
      new Error(
        'Payout payout-init-1 is in status processing; confirm the provider outcome before releasing the fence',
      ),
    );

    render(createElement(AdminFencedPayoutAccountsPage));
    fireEvent.click(await screen.findByRole('button', { name: 'Release fence' }));
    fireEvent.change(screen.getByLabelText('Release reason (required, ≥ 5 chars)'), {
      target: { value: 'Investigation complete' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));

    expect(await screen.findByText(/is in status processing/)).toBeTruthy();
    // Modal stays open so the operator can correct the input.
    expect(screen.getByRole('dialog', { name: 'Release payout-account fence' })).toBeTruthy();
    // No refresh after a failed release.
    expect(adminApi.getFencedAccounts).toHaveBeenCalledTimes(1);
  });
});

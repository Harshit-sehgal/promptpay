// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ledgerApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import DevEarningsPage from './page';

vi.mock('@/lib/api/services', () => ({
  ledgerApi: { getHistory: vi.fn() },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
  StatCard: ({ label }: { label: string }) => createElement('div', null, label),
  StatusBadge: ({ status }: { status: string }) => createElement('span', null, status),
}));

vi.mock('@/lib/format', () => ({
  formatCurrency: (amount: bigint, currency: string) => `${currency} ${amount}`,
  formatCurrencyBreakdown: () => 'USD 100',
  formatRelativeTime: (value: string) => value,
}));

function response(page: number, id: string) {
  return {
    data: {
      entries: [
        {
          id,
          userId: 'user-1',
          status: 'confirmed',
          amountMinor: 100n,
          currency: 'USD',
          entryType: 'ad_view',
          description: `Entry ${id}`,
          createdAt: '2026-07-16T08:00:00.000Z',
        },
      ],
      total: 51,
      page,
      limit: 50,
      totalPages: 2,
    },
  };
}

describe('DevEarningsPage pagination', () => {
  afterEach(() => cleanup());

  it('requests and renders the next ledger page', async () => {
    vi.mocked(ledgerApi.getHistory)
      .mockResolvedValueOnce(response(1, 'first') as never)
      .mockResolvedValueOnce(response(2, 'last') as never);

    render(createElement(DevEarningsPage));

    expect(await screen.findByText('Entry first')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Entry last')).toBeTruthy();
    await waitFor(() => {
      expect(ledgerApi.getHistory).toHaveBeenLastCalledWith({
        status: undefined,
        page: 2,
        limit: 50,
      });
    });
    expect(screen.getByText('Page 2 of 2 · 51 entries')).toBeTruthy();
  });
});

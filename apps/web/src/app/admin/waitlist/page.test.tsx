// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminWaitlistPage from './page';

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getWaitlist: vi.fn(),
  },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/lib/format', () => ({
  formatRelativeTime: (date: string) => date,
}));

const waitlistEntry = {
  id: 'wait-1',
  email: 'sponsor@example.com',
  company: 'Example Co',
  country: 'IN',
  status: 'pending' as const,
  consent: true,
  source: 'advertisers_page',
  createdAt: '2026-08-31T10:00:00.000Z',
};

const listResponse = (rows: unknown[], total: number, page = 1, limit = 50) =>
  ({ data: { rows, total, page, limit } }) as never;

describe('AdminWaitlistPage', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getWaitlist).mockReset();
  });

  afterEach(() => cleanup());

  it('loads and renders waitlist entries with default pagination', async () => {
    vi.mocked(adminApi.getWaitlist).mockResolvedValue(listResponse([waitlistEntry], 1));

    render(<AdminWaitlistPage />);

    await waitFor(() => {
      expect(adminApi.getWaitlist).toHaveBeenCalledWith({ page: 1, limit: 50 });
    });
    expect(await screen.findByText('sponsor@example.com')).toBeTruthy();
    expect(screen.getByText('Example Co')).toBeTruthy();
    expect(screen.getByText('IN')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
    expect(screen.getByText('1 signup')).toBeTruthy();
  });

  it('applies a status filter and returns to the first page', async () => {
    vi.mocked(adminApi.getWaitlist).mockResolvedValue(listResponse([], 0));

    render(<AdminWaitlistPage />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'invited' } });

    await waitFor(() => {
      expect(adminApi.getWaitlist).toHaveBeenCalledWith({
        status: 'invited',
        page: 1,
        limit: 50,
      });
    });
  });

  it('shows an empty state without presenting stale rows', async () => {
    vi.mocked(adminApi.getWaitlist).mockResolvedValue(listResponse([], 0));

    render(<AdminWaitlistPage />);

    expect(await screen.findByText('No waitlist signups match this filter.')).toBeTruthy();
  });
});

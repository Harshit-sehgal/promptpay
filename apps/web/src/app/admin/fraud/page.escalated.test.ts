// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdminFraudPage from './page';

const { escalatedFlag } = vi.hoisted(() => ({
  escalatedFlag: {
    id: 'flag-escalated',
    userId: 'user-escalated',
    flagType: 'shared_payout_destination',
    severity: 'critical',
    status: 'escalated',
    reason: 'Payout destination shared across accounts',
    createdAt: '2026-07-16T08:00:00.000Z',
    user: { email: 'review@example.com', name: 'Review User', trustLevel: 'restricted' },
    evidence: {},
  },
}));

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getFraudFlags: vi.fn().mockResolvedValue({
      data: { flags: [escalatedFlag], total: 1, page: 1, limit: 25, totalPages: 1 },
    }),
    getFraudStats: vi.fn().mockResolvedValue({
      data: {
        byStatus: { open: 0, reviewing: 0, escalated: 1, resolvedValid: 0, resolvedInvalid: 0 },
        bySeverity: { critical: 1, high: 0, medium: 0, low: 0 },
        escalationRate: 100,
        avgResolutionMinutes: 0,
        resolvedLast7d: 0,
        byFlagType: [],
      },
    }),
    resolveFraudFlag: vi.fn().mockResolvedValue({}),
    escalateFraudFlag: vi.fn().mockResolvedValue({}),
    recomputeTrustScore: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
  StatusBadge: ({ status }: { status: string }) => createElement('span', null, status),
}));

vi.mock('@/lib/format', () => ({
  formatNumber: (value: number) => String(value),
  formatRelativeTime: (value: string) => value,
}));

describe('AdminFraudPage escalated queue behavior', () => {
  afterEach(() => cleanup());

  it('loads escalated flags as active and allows resolution without re-escalation', async () => {
    render(createElement(AdminFraudPage));

    const reason = await screen.findByText('Payout destination shared across accounts');
    expect(adminApi.getFraudFlags).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      status: 'open,reviewing,escalated',
    });

    fireEvent.click(reason);

    expect(await screen.findByRole('button', { name: 'Mark invalid' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Escalate' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm fraud' }));
    await waitFor(() => {
      expect(adminApi.resolveFraudFlag).toHaveBeenCalledWith(
        'flag-escalated',
        'confirmed',
        'Confirmed via admin review',
      );
    });
    expect(adminApi.escalateFraudFlag).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import AdminFraudPage from './page';

const { mockFlag } = vi.hoisted(() => ({
  mockFlag: {
    id: 'flag-1',
    userId: 'user-abc123',
    flagType: 'suspicious_login',
    severity: 'high',
    status: 'open',
    reason: 'Suspicious login from new device',
    createdAt: '2026-07-01T10:00:00.000Z',
    user: { email: 'risky@example.com', name: 'Risky User', trustLevel: 'standard' },
    evidence: {},
  },
}));

vi.mock('@/lib/api/services', () => ({
  adminApi: {
    getFraudFlags: vi
      .fn()
      .mockResolvedValue({ data: { flags: [mockFlag], total: 1, totalPages: 1 } }),
    getFraudStats: vi.fn().mockResolvedValue({
      data: {
        byStatus: { open: 1, reviewing: 0, escalated: 0, resolved_valid: 0, resolved_invalid: 0 },
        bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
        escalationRate: 0,
        avgResolutionMinutes: 0,
        resolvedLast7d: 0,
        byFlagType: [],
      },
    }),
    resolveFraudFlag: vi.fn().mockResolvedValue({}),
    // A-046: a 500 (or any non-2xx) from recompute must surface as a visible error.
    recomputeTrustScore: vi.fn().mockRejectedValue(new Error('Trust service unavailable')),
  },
}));

vi.mock('@/components', () => ({
  LoadingSpinner: () => null,
  StatusBadge: () => null,
}));

vi.mock('@/lib/format', () => ({
  formatNumber: (n: number) => String(n),
  formatRelativeTime: (d: string) => String(d),
}));

describe('AdminFraudPage recompute failure surfaces a visible error (A-046)', () => {
  afterEach(() => cleanup());

  it('renders a visible, styled error when recomputeTrustScore fails (e.g. HTTP 500)', async () => {
    render(createElement(AdminFraudPage));

    // The queue loads and the flag is listed.
    const reason = await screen.findByText('Suspicious login from new device');

    // Expand the flag to reveal the recompute action.
    fireEvent.click(reason);

    const recomputeBtn = await screen.findByText('Recompute trust');
    fireEvent.click(recomputeBtn);

    // The rejection must surface as a visible error message, not a silent success.
    const errorEl = await screen.findByText('Trust service unavailable');
    expect(errorEl.className).toContain('text-red-400');

    // And the UI actually triggered the recompute request.
    expect(vi.mocked(adminApi.recomputeTrustScore)).toHaveBeenCalledWith('user-abc123');
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AdvertiserCampaignsPage from './page';

const mock = vi.hoisted(() => ({
  paused: false,
  listCampaigns: vi.fn(),
  pauseCampaign: vi.fn(),
}));

vi.mock('@/lib/api/services', () => ({
  advertiserApi: {
    listCampaigns: mock.listCampaigns,
    pauseCampaign: mock.pauseCampaign,
    resumeCampaign: vi.fn(),
    archiveCampaign: vi.fn(),
  },
}));

function campaign(id: string, name: string) {
  return {
    id,
    name,
    status: 'active',
    bidType: 'cpm',
    bidAmountMinor: 100n,
    budgetTotalMinor: 10_000n,
    budgetSpentMinor: 1_000n,
    currency: 'USD',
    impressions: 10,
    clicks: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    creatives: [{ status: 'approved' }],
  };
}

beforeEach(() => {
  cleanup();
  mock.paused = false;
  mock.pauseCampaign.mockReset();
  mock.pauseCampaign.mockImplementation(async () => {
    mock.paused = true;
  });
  mock.listCampaigns.mockReset();
  mock.listCampaigns.mockImplementation(async ({ page }: { page: number }) => {
    if (page === 2) {
      return {
        data: {
          campaigns: mock.paused ? [] : [campaign('last-active', 'Last active campaign')],
          total: mock.paused ? 20 : 21,
        },
      };
    }
    return {
      data: {
        campaigns: [campaign('page-one', mock.paused ? 'Remaining active' : 'Page one campaign')],
        total: mock.paused ? 20 : 21,
      },
    };
  });
});

describe('advertiser campaign pagination', () => {
  it('returns to the last valid page when a status mutation empties the current page', async () => {
    render(<AdvertiserCampaignsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Last active campaign')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(await screen.findByText('Remaining active')).toBeTruthy();
    await waitFor(() => {
      expect(mock.listCampaigns).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  type CampaignActionState,
  clampCampaignPage,
  getCampaignActions,
  getCampaignRejectionMessage,
} from './campaign-actions';

describe('campaign pagination', () => {
  it('clamps a filtered page after a mutation removes its last row', () => {
    expect(clampCampaignPage(2, 20, 20)).toBe(1);
    expect(clampCampaignPage(2, 21, 20)).toBe(2);
  });
});

// A-020: Advertiser campaign Pause/Resume/Edit actions must be shown only for
// the matching status. The visibility logic lives in the pure `getCampaignActions`
// helper (extracted from the page JSX) so it can be unit-tested without a React
// DOM harness.

function campaign(
  status: string,
  creatives?: { status: string; rejectionReason?: string | null }[],
  rejectionReason?: string | null,
): CampaignActionState {
  return {
    id: 'c1',
    name: 'Campaign',
    status,
    bidType: 'cpm',
    bidAmountMinor: 0n,
    budgetTotalMinor: 0n,
    budgetSpentMinor: 0n,
    currency: 'USD',
    impressions: 0,
    clicks: 0,
    createdAt: '',
    rejectionReason,
    creatives,
  };
}

describe('campaign action visibility by status (A-020)', () => {
  it('only allows Pause for active campaigns', () => {
    const a = getCampaignActions(campaign('active'));
    expect(a.canPause).toBe(true);
    expect(a.canResume).toBe(false);
    expect(a.canEdit).toBe(false);
    expect(a.canArchive).toBe(true);
  });

  it('only allows Resume for paused campaigns', () => {
    const a = getCampaignActions(campaign('paused'));
    expect(a.canResume).toBe(true);
    expect(a.canPause).toBe(false);
    expect(a.canEdit).toBe(false);
    expect(a.canArchive).toBe(true);
  });

  it('only allows Edit for draft and rejected campaigns', () => {
    expect(getCampaignActions(campaign('draft')).canEdit).toBe(true);
    expect(getCampaignActions(campaign('rejected')).canEdit).toBe(true);
    expect(getCampaignActions(campaign('draft')).canArchive).toBe(true);
    expect(getCampaignActions(campaign('rejected')).canArchive).toBe(true);
  });

  it('only exposes archive for approved campaigns', () => {
    // Approved-but-not-active campaigns are shown a blocker badge instead of
    // Pause/Resume/Edit, but they can still be permanently closed.
    const a = getCampaignActions(campaign('approved'));
    expect(a.canPause).toBe(false);
    expect(a.canResume).toBe(false);
    expect(a.canEdit).toBe(false);
    expect(a.canArchive).toBe(true);
  });

  it('allows submitted campaigns to be archived but hides archived campaign actions', () => {
    expect(getCampaignActions(campaign('submitted'))).toEqual({
      canPause: false,
      canResume: false,
      canEdit: false,
      canArchive: true,
    });
    expect(getCampaignActions(campaign('archived'))).toEqual({
      canPause: false,
      canResume: false,
      canEdit: false,
      canArchive: false,
    });
  });
});

describe('campaign rejection messaging (A-021)', () => {
  it('prefers the campaign-level admin rejection reason', () => {
    expect(
      getCampaignRejectionMessage(
        campaign('rejected', [{ status: 'rejected', rejectionReason: 'Bad creative' }], 'Bad fit'),
      ),
    ).toBe('Bad fit');
  });

  it('falls back to the first creative rejection reason', () => {
    expect(
      getCampaignRejectionMessage(
        campaign('rejected', [{ status: 'rejected', rejectionReason: 'Bad creative' }]),
      ),
    ).toBe('Bad creative');
  });

  it('does not show rejection copy for non-rejected campaigns', () => {
    expect(getCampaignRejectionMessage(campaign('draft', [], 'Reason'))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { type CampaignActionState, getCampaignActions } from './campaign-actions';

// A-020: Advertiser campaign Pause/Resume/Edit actions must be shown only for
// the matching status. The visibility logic lives in the pure `getCampaignActions`
// helper (extracted from the page JSX) so it can be unit-tested without a React
// DOM harness.

function campaign(status: string, creatives?: { status: string }[]): CampaignActionState {
  return {
    id: 'c1',
    name: 'Campaign',
    status,
    bidType: 'cpm',
    bidAmountMinor: 0,
    budgetTotalMinor: 0,
    budgetSpentMinor: 0,
    currency: 'USD',
    impressions: 0,
    clicks: 0,
    createdAt: '',
    creatives,
  };
}

describe('campaign action visibility by status (A-020)', () => {
  it('only allows Pause for active campaigns', () => {
    const a = getCampaignActions(campaign('active'));
    expect(a.canPause).toBe(true);
    expect(a.canResume).toBe(false);
    expect(a.canEdit).toBe(false);
  });

  it('only allows Resume for paused campaigns', () => {
    const a = getCampaignActions(campaign('paused'));
    expect(a.canResume).toBe(true);
    expect(a.canPause).toBe(false);
    expect(a.canEdit).toBe(false);
  });

  it('only allows Edit for draft and rejected campaigns', () => {
    expect(getCampaignActions(campaign('draft')).canEdit).toBe(true);
    expect(getCampaignActions(campaign('rejected')).canEdit).toBe(true);
  });

  it('exposes no lifecycle action for approved campaigns', () => {
    // Approved-but-not-active campaigns are shown a blocker badge instead of
    // Pause/Resume/Edit, so they must surface no lifecycle action.
    const a = getCampaignActions(campaign('approved'));
    expect(a.canPause).toBe(false);
    expect(a.canResume).toBe(false);
    expect(a.canEdit).toBe(false);
  });

  it('exposes no lifecycle action for submitted or archived campaigns', () => {
    expect(getCampaignActions(campaign('submitted'))).toEqual({
      canPause: false,
      canResume: false,
      canEdit: false,
    });
    expect(getCampaignActions(campaign('archived'))).toEqual({
      canPause: false,
      canResume: false,
      canEdit: false,
    });
  });
});

export interface CampaignActionState {
  id: string;
  name: string;
  status: string;
  bidType: string;
  bidAmountMinor: number;
  budgetTotalMinor: number;
  budgetSpentMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
  createdAt: string;
  creatives?: { status: string }[];
}

export interface CampaignActions {
  canPause: boolean;
  canResume: boolean;
  canEdit: boolean;
}

export function getCampaignActions(campaign: CampaignActionState): CampaignActions {
  return {
    canPause: campaign.status === 'active',
    canResume: campaign.status === 'paused',
    canEdit: campaign.status === 'draft' || campaign.status === 'rejected',
  };
}

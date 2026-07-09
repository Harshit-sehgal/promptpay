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
  rejectionReason?: string | null;
  creatives?: { status: string; rejectionReason?: string | null }[];
}

export interface CampaignActions {
  canPause: boolean;
  canResume: boolean;
  canEdit: boolean;
  canArchive: boolean;
}

export function getCampaignActions(campaign: CampaignActionState): CampaignActions {
  return {
    canPause: campaign.status === 'active',
    canResume: campaign.status === 'paused',
    canEdit: campaign.status === 'draft' || campaign.status === 'rejected',
    canArchive: campaign.status !== 'archived',
  };
}

export function getCampaignRejectionMessage(campaign: CampaignActionState): string | null {
  if (campaign.status !== 'rejected') return null;

  const campaignReason = campaign.rejectionReason?.trim();
  if (campaignReason) return campaignReason;

  const creativeReason = campaign.creatives
    ?.map((creative) => creative.rejectionReason?.trim())
    .find((reason): reason is string => Boolean(reason));

  return creativeReason ?? null;
}

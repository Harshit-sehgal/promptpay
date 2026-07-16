export interface CampaignActionState {
  id: string;
  name: string;
  status: string;
  bidType: string;
  bidAmountMinor: bigint;
  budgetTotalMinor: bigint;
  budgetSpentMinor: bigint;
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

export function clampCampaignPage(page: number, total: number, limit: number): number {
  const lastPage = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return Math.min(Math.max(1, page), lastPage);
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

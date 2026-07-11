import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { CampaignService } from '../campaign/campaign.service';
import { PrismaService } from '../config/prisma.service';
import { AdvertiserCampaignTrait } from './advertiser-campaign.trait';
import { AdvertiserDashboardTrait } from './advertiser-dashboard.trait';
import { AdvertiserProfileTrait } from './advertiser-profile.trait';

@Injectable()
export class AdvertiserService {
  constructor(
    public prisma: PrismaService,
    public campaignService: CampaignService,
    public audit: AuditService,
    public googleVerifier: GoogleTokenVerifier,
  ) {}
}

export interface AdvertiserService
  extends AdvertiserProfileTrait, AdvertiserCampaignTrait, AdvertiserDashboardTrait {}

for (const name of Object.getOwnPropertyNames(AdvertiserProfileTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdvertiserService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdvertiserProfileTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdvertiserCampaignTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdvertiserService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdvertiserCampaignTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdvertiserDashboardTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdvertiserService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdvertiserDashboardTrait.prototype, name) as PropertyDescriptor,
  );
}
export * from './advertiser.constants';

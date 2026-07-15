import { Injectable } from '@nestjs/common';

import { UserStatus } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { DeveloperService } from '../developer/developer.service';
import { EmailQueueService } from '../email/email-queue.service';
import { FraudService } from '../fraud/fraud.service';
import { PayoutService } from '../payout/payout.service';
import { AdminCampaignsTrait } from './admin-campaigns.trait';
import { AdminDevicesTrait } from './admin-devices.trait';
import { AdminFraudTrait } from './admin-fraud.trait';
import { AdminIntegrationsTrait } from './admin-integrations.trait';
import { AdminOverviewTrait } from './admin-overview.trait';
import { AdminPayoutsTrait } from './admin-payouts.trait';
import { AdminUsersTrait } from './admin-users.trait';

@Injectable()
export class AdminService {
  constructor(
    public prisma: PrismaService,
    public audit: AuditService,
    public payoutService: PayoutService,
    public fraudService: FraudService,
    public developerService: DeveloperService,
    public emailQueueService: EmailQueueService,
  ) {}
  static readonly ALLOWED_ADMIN_STATUSES: UserStatus[] = ['active', 'restricted', 'banned'];
}

export interface AdminService
  extends
    AdminOverviewTrait,
    AdminUsersTrait,
    AdminCampaignsTrait,
    AdminPayoutsTrait,
    AdminFraudTrait,
    AdminDevicesTrait,
    AdminIntegrationsTrait {}

for (const name of Object.getOwnPropertyNames(AdminOverviewTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminOverviewTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdminUsersTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminUsersTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdminCampaignsTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminCampaignsTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdminPayoutsTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminPayoutsTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdminFraudTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminFraudTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdminDevicesTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminDevicesTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AdminIntegrationsTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AdminService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AdminIntegrationsTrait.prototype, name) as PropertyDescriptor,
  );
}
export * from './admin.constants';

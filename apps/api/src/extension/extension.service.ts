import { LRUCache } from 'lru-cache';
import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { ComplianceService } from '../compliance/compliance.service';
import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { LedgerService } from '../ledger/ledger.service';
import { ServedAd } from './extension.constants';
import { ExtensionAdTrait } from './extension-ad.trait';
import { ExtensionDeviceReportTrait } from './extension-device-report.trait';
import { ExtensionWaitTrait } from './extension-wait.trait';

@Injectable()
export class ExtensionService {
  constructor(
    public prisma: PrismaService,
    public audit: AuditService,
    public ledger: LedgerService,
    public fraud: FraudService,
    public compliance: ComplianceService,
    public googleVerifier: GoogleTokenVerifier,
  ) {}
  adCache: LRUCache<string, { ad: ServedAd }> = new LRUCache<
    string,
    {
      ad: ServedAd;
    }
  >({
    max: 10000,
    ttl: 60000,
  });
  logger: Logger = new Logger(ExtensionService.name);
  recentAuditRejections: LRUCache<string, boolean> = new LRUCache<string, boolean>({
    max: 500,
    ttl: 60000,
  });
}

export interface ExtensionService
  extends ExtensionDeviceReportTrait, ExtensionAdTrait, ExtensionWaitTrait {}

for (const name of Object.getOwnPropertyNames(ExtensionDeviceReportTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    ExtensionService.prototype,
    name,
    Object.getOwnPropertyDescriptor(
      ExtensionDeviceReportTrait.prototype,
      name,
    ) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(ExtensionAdTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    ExtensionService.prototype,
    name,
    Object.getOwnPropertyDescriptor(ExtensionAdTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(ExtensionWaitTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    ExtensionService.prototype,
    name,
    Object.getOwnPropertyDescriptor(ExtensionWaitTrait.prototype, name) as PropertyDescriptor,
  );
}
export * from './extension.constants';

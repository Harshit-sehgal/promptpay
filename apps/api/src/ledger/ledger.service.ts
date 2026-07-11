import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { LedgerAdminTrait } from './ledger-admin.trait';
import { LedgerBalanceTrait } from './ledger-balance.trait';
import { LedgerEarningsTrait } from './ledger-earnings.trait';
import { LedgerMathTrait } from './ledger-math.trait';

@Injectable()
export class LedgerService {
  constructor(
    public prisma: PrismaService,
    public audit: AuditService,
  ) {}
}

export interface LedgerService
  extends LedgerMathTrait, LedgerEarningsTrait, LedgerBalanceTrait, LedgerAdminTrait {}

for (const name of Object.getOwnPropertyNames(LedgerMathTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    LedgerService.prototype,
    name,
    Object.getOwnPropertyDescriptor(LedgerMathTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(LedgerEarningsTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    LedgerService.prototype,
    name,
    Object.getOwnPropertyDescriptor(LedgerEarningsTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(LedgerBalanceTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    LedgerService.prototype,
    name,
    Object.getOwnPropertyDescriptor(LedgerBalanceTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(LedgerAdminTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    LedgerService.prototype,
    name,
    Object.getOwnPropertyDescriptor(LedgerAdminTrait.prototype, name) as PropertyDescriptor,
  );
}
export * from './ledger.constants';

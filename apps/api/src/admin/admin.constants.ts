import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';

import { RecoveryDebtCaseStatus, ToolTypeEnum } from '@waitlayer/db';

export const DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES = 15;

export const MAX_DEVICE_RECOVERY_TOKEN_MINUTES = 60;

export const DEFAULT_RECOVERY_DEBT_CURRENCY = 'USD';

export const ACTIVE_RECOVERY_DEBT_CASE_STATUSES = [
  RecoveryDebtCaseStatus.open,
  RecoveryDebtCaseStatus.in_collections,
];

export type CurrencyAmountGroup = {
  currency: string;
  _sum: {
    amountMinor: number | null;
  };
};

export function hashDeviceRecoveryToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeOptionalToolType(
  toolType?: string,
  throwOnInvalid = true,
): ToolTypeEnum | undefined {
  const normalized = toolType?.trim();
  if (!normalized) return undefined;
  if ((Object.values(ToolTypeEnum) as string[]).includes(normalized)) {
    return normalized as ToolTypeEnum;
  }
  if (!throwOnInvalid) return undefined;
  throw new BadRequestException(`Unsupported toolType '${normalized}'`);
}

export function sanitizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function normalizeOptionalCurrency(value: string | undefined): string | undefined {
  const currency = value?.trim().toUpperCase();
  if (!currency) return undefined;
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException('currency must be a 3-letter ISO currency code');
  }
  return currency;
}

export function netCurrencyAmounts(
  credits: CurrencyAmountGroup[],
  debits: CurrencyAmountGroup[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of credits) {
    totals[row.currency] = (totals[row.currency] ?? 0) + (row._sum.amountMinor ?? 0);
  }
  for (const row of debits) {
    totals[row.currency] = (totals[row.currency] ?? 0) - (row._sum.amountMinor ?? 0);
  }
  return totals;
}

export function recoveryDebtCaseKey(userId: string, currency: string): string {
  return `${userId}:${currency}`;
}

export function toTerminalRecoveryDebtStatus(
  status: 'recovered' | 'written_off' | 'closed',
): RecoveryDebtCaseStatus {
  switch (status) {
    case 'recovered':
      return RecoveryDebtCaseStatus.recovered;
    case 'written_off':
      return RecoveryDebtCaseStatus.written_off;
    case 'closed':
      return RecoveryDebtCaseStatus.closed;
  }
}

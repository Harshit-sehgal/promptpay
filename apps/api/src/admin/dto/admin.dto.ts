import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength,Min } from 'class-validator';

import { FraudSeverity } from '@waitlayer/shared';

// ── Campaign approval ──

export class ApproveCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectCampaignDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

// ── Payout approval ──

export class ApprovePayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Optional partial-approval amount (minor units). When omitted the
   * payout is approved at its full `requestedAmountMinor`. When provided
   * it MUST be `> 0` and `<= requestedAmountMinor` — a partial payout the
   * admin authorised after fraud review. Setting this writes the
   * `approvedAmountMinor` column authoritatively so the downstream
   * `processPayout` / `markPayoutPaid` reconciliation guards compare
   * against the approved amount rather than silently falling back to the
   * requested amount (which would let a reduced approval be paid at the
   * original figure).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedAmountMinor?: number;
}

export class RejectPayoutDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class MarkPayoutPaidDto {
  @IsString()
  @MaxLength(255)
  providerTxId!: string;

  @IsString()
  paidAt!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @MaxLength(3)
  currency!: string;
}

// ── Fraud ──

export class ResolveFraudFlagDto {
  @IsIn(['confirmed', 'invalid'])
  decision!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class FraudFlagsQueryDto {
  /**
   * Comma-separated list of statuses to filter by (e.g. "open,reviewing"
   * or "resolved_valid,resolved_invalid"). Accepts any FraudFlagStatus
   * value. If omitted, no status filter is applied.
   */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(FraudSeverity)
  severity?: FraudSeverity;

  @IsOptional()
  @IsString()
  flagType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

// ── Users ──

export class UsersQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

// ── Device recovery ──

export class IssueDeviceRecoveryTokenDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  expiresInMinutes?: number;
}

// ── Recovery debt operations ──

export class RecoveryDebtCasesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minAmountMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class OpenRecoveryDebtCaseDto {
  @IsOptional()
  @IsIn(['open', 'in_collections'])
  status?: 'open' | 'in_collections';

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ResolveRecoveryDebtCaseDto {
  @IsIn(['recovered', 'written_off', 'closed'])
  status!: 'recovered' | 'written_off' | 'closed';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ── Tool Integrations ──

export class ToggleToolIntegrationDto {
  @IsIn(['true', 'false'])
  isActive!: string;
}

// ── Webhooks ──

export class WebhookEventsQueryDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  processingStatus?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ── Audit ──

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  actorRole?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

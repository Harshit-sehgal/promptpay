import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { FraudSeverity } from '@waitlayer/shared';

import { toBigIntOrOriginal } from '../../common/transforms/bigint.transform';
import { IsBigInt, MinBigInt } from '../../common/validators/bigint.validators';

// ── Campaign approval ──

export class ApproveCampaignDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectCampaignDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

// ── Payout approval ──

export class ApprovePayoutDto {
  @ApiProperty({ required: false })
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
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBigInt()
  @MinBigInt(1n)
  @Transform(toBigIntOrOriginal)
  approvedAmountMinor?: bigint;
}

export class RejectPayoutDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class MarkPayoutPaidDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  providerTxId!: string;

  @ApiProperty()
  @IsString()
  paidAt!: string;

  @ApiProperty()
  @IsBigInt()
  @MinBigInt(1n)
  @Transform(toBigIntOrOriginal)
  amountMinor!: bigint;

  @ApiProperty()
  @IsString()
  @MaxLength(3)
  currency!: string;
}

// ── Fraud ──

export class ResolveFraudFlagDto {
  @ApiProperty()
  @IsIn(['confirmed', 'invalid'])
  decision!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class EscalateFraudFlagDto {
  @ApiProperty({ required: false, description: 'Reason for escalation' })
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
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEnum(FraudSeverity)
  severity?: FraudSeverity;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  flagType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;
}

// ── Users ──

export class UsersQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;
}

// ── Device recovery ──

export class IssueDeviceRecoveryTokenDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  @Type(() => Number)
  expiresInMinutes?: number;
}

export class AdminDevicesQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  toolType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class ArchiveRefundQueueQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

// ── Recovery debt operations ──

export class RecoveryDebtCasesQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  minAmountMinor?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class OpenRecoveryDebtCaseDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['open', 'in_collections'])
  status?: 'open' | 'in_collections';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalReference?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ResolveRecoveryDebtCaseDto {
  @ApiProperty()
  @IsIn(['recovered', 'written_off', 'closed'])
  status!: 'recovered' | 'written_off' | 'closed';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalReference?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ── Tool Integrations ──

export class ToggleToolIntegrationDto {
  @ApiProperty()
  @IsIn(['true', 'false'])
  isActive!: string;
}

// ── Webhooks ──

export class WebhookEventsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  processingStatus?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

// ── Audit ──

export class AuditLogQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  actorRole?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

// ── Payout account verification ─

// ── Metrics ──

export class AdminMetricsQueryDto {
  @ApiProperty({ required: false, default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  @Type(() => Number)
  days?: number;

  @ApiProperty({ required: false, default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class PayoutAccountVerifyDto {
  @ApiProperty()
  @IsIn([true, false])
  verified!: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PayoutAccountFreezeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReleasePayoutFenceDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    required: false,
    description: 'Provider transaction identifier from the reconciled payout',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerTxId?: string;

  @ApiProperty({
    required: false,
    description: 'Final resolution summary (e.g. paid, failed, cancelled)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}

/** Internal options shape for {@link AdminPayoutsTrait.releasePayoutFence}. */
export interface ReleasePayoutFenceOptions {
  payoutAccountId: string;
  reviewerId: string;
  reviewerRole: string;
  reason: string;
  providerTxId?: string;
  resolution?: string;
}
/**
 * Reconciliation telemetry surfaced on fenced-account views (P1.11). These
 * mirror the P1.10 columns on {@link PayoutRequest} and let operators triage a
 * stuck initiation fence without a second lookup.
 */
export class FencedAccountOwnerDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
}
export class FencedAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() destination!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isFrozen!: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Id of the in-flight payout holding the durable initiation fence.',
  })
  @IsOptional()
  initiationPayoutId!: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: FencedAccountOwnerDto,
    description: 'Owner of the fenced payout account.',
  })
  @IsOptional()
  user!: FencedAccountOwnerDto | null;

  @ApiProperty({
    description:
      'Number of provider reconciliation poll attempts recorded against the fenced payout.',
  })
  reconciliationAttempts!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'ISO-8601 timestamp of the most recent reconciliation poll for the fenced payout.',
  })
  @IsOptional()
  lastReconciliationAt!: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'ISO-8601 timestamp when the fenced payout was escalated for manual review.',
  })
  @IsOptional()
  escalatedAt!: string | null;
}

/** Paginated response for {@link AdminController.getFencedAccounts}. */
export class FencedAccountListResponseDto {
  @ApiProperty({ type: () => [FencedAccountDto] })
  items!: FencedAccountDto[];

  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

/**
 * Response for {@link AdminController.releasePayoutFence}. Carries the cleared
 * account plus the reconciliation telemetry of the payout whose fence was
 * released, so operators retain the context after the link is severed.
 */
export class ReleasePayoutFenceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() destination!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isFrozen!: boolean;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Always null after a successful fence release.',
  })
  @IsOptional()
  initiationPayoutId!: string | null;

  @ApiProperty({
    description:
      'Number of provider reconciliation poll attempts recorded against the released payout.',
  })
  reconciliationAttempts!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'ISO-8601 timestamp of the most recent reconciliation poll for the released payout.',
  })
  @IsOptional()
  lastReconciliationAt!: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'ISO-8601 timestamp when the released payout was escalated for manual review.',
  })
  @IsOptional()
  escalatedAt!: string | null;
}

export class ResolveDeadLetterDto {
  @ApiProperty({
    description: 'Reason the dead-letter row is being resolved (operator decision).',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

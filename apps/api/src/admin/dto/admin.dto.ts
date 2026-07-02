import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';
import { FraudSeverity, FraudFlagStatus } from '@waitlayer/shared';

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
  @IsOptional()
  @IsEnum(FraudFlagStatus)
  status?: FraudFlagStatus;

  @IsOptional()
  @IsEnum(FraudSeverity)
  severity?: FraudSeverity;
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

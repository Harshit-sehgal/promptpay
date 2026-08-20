import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { AdPlacementType, ToolType } from '@ateva/shared';

import { WAIT_STATE_MAX_DURATION_SECONDS } from '../extension.constants';

export class AdRequestDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sessionId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @ApiProperty()
  @IsEnum(ToolType)
  toolType!: ToolType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    each: true,
    message: 'allowedCategories entries must be lowercase slug strings (letters, numbers, hyphens)',
  })
  @MaxLength(64, { each: true })
  allowedCategories?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    each: true,
    message: 'blockedCategories entries must be lowercase slug strings (letters, numbers, hyphens)',
  })
  @MaxLength(64, { each: true })
  blockedCategories?: string[];

  // Optional ISO-3166-1 alpha-2 country code, supplied by the client so
  // country targeting can be enforced without server-side geolocation
  // (issue A-056). Falls back to the developer's profile country.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  signature!: string;
}

export class AdRenderedDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @ApiProperty()
  @IsDateString()
  renderedAt!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  visibleSurface?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  signature!: string;
}

export class QualifiedImpressionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @ApiProperty()
  @IsDateString()
  qualifiedAt!: string;

  @ApiProperty()
  @IsNumber()
  @IsInt()
  @Min(0)
  @Max(WAIT_STATE_MAX_DURATION_SECONDS * 1000)
  visibleDurationMs!: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  signature!: string;
}

export class AdClickDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @ApiProperty()
  @IsDateString()
  clickedAt!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  signature!: string;
}

/**
 * Canonical set of report reasons. Closed-set to prevent unbounded free-text
 * stored in reason column (which admins may render later). Deviant clients
 * cannot inject HTML or invent reasons for adversarial filtering.
 */
export const REPORT_AD_REASONS = [
  'inappropriate_content',
  'misleading',
  'broken_link',
  'privacy_concern',
  'fraud',
  'other',
] as const;

/**
 * WL-063: request a non-cash sandbox placement for an explicit placement type
 * (e.g. `completion_return`). Only served on a sandbox deployment; the client
 * always receives `mode: 'sandbox'` / `hasCashValue: false` responses.
 */
export class SandboxPlacementDto {
  @ApiProperty({ enum: AdPlacementType })
  @IsEnum(AdPlacementType)
  placementType!: AdPlacementType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  correlationId!: string;

  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  signature!: string;
}

export class ReportAdDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @ApiProperty({ enum: REPORT_AD_REASONS })
  @IsString()
  @IsIn(REPORT_AD_REASONS)
  @MinLength(1)
  @MaxLength(128)
  reason!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  details?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  signature!: string;
}

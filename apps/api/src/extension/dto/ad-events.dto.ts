import { IsArray, IsDateString,IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

import { ToolType } from '@waitlayer/shared';

export class AdRequestDto {
  @IsUUID()
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sessionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @IsEnum(ToolType)
  toolType!: ToolType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCategories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedCategories?: string[];

  // Optional ISO-3166-1 alpha-2 country code, supplied by the client so
  // country targeting can be enforced without server-side geolocation
  // (issue A-056). Falls back to the developer's profile country.
  @IsOptional()
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

export class AdRenderedDto {
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @IsDateString()
  renderedAt!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  visibleSurface?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

export class QualifiedImpressionDto {
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @IsDateString()
  qualifiedAt!: string;

  @IsNumber()
  @Min(0)
  visibleDurationMs!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

export class AdClickDto {
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @IsDateString()
  clickedAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

export class ReportAdDto {
  @IsString()
  @MinLength(1)
  impressionToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  details?: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

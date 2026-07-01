import { IsString, IsEnum, IsUUID, IsOptional, IsArray, IsNumber, Min, MinLength, MaxLength } from 'class-validator';
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

  @IsString()
  @MinLength(1)
  renderedAt!: string;

  @IsOptional()
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

  @IsString()
  @MinLength(1)
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

  @IsString()
  @MinLength(1)
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
}

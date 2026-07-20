import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { FALSE_POSITIVE_REASONS, FalsePositiveReason, ToolType } from '@waitlayer/shared';

export class WaitSignalDto {
  @ApiProperty({
    description: 'Signal category. Must not contain user code or PII.',
    enum: ['ai_generation', 'command_execution', 'active_task', 'lifecycle_event', 'inactivity'],
  })
  @IsEnum(['ai_generation', 'command_execution', 'active_task', 'lifecycle_event', 'inactivity'])
  type!: 'ai_generation' | 'command_execution' | 'active_task' | 'lifecycle_event' | 'inactivity';

  @ApiPropertyOptional({ description: 'Optional human-readable context (no code/PII).' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  details?: string;
}

export class WaitStateStartDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sessionId!: string;

  @ApiProperty()
  @IsEnum(ToolType)
  toolType!: ToolType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Categorized signals used to score this wait state.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WaitSignalDto)
  signals?: WaitSignalDto[];

  @ApiPropertyOptional({ description: 'Version of the detector that produced the signals.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  detectorVersion?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  signature!: string;
}

export class WaitStateEndDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  @Matches(/^\d+$/, { message: 'durationSeconds must contain decimal digits only' })
  durationSeconds!: string; // serialized as string from extension, parsed to int

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  signature!: string;
}

export class FlagFalsePositiveDto {
  @ApiPropertyOptional({
    description:
      'Normalized false-positive reason code (P1 #16). Persisted with the report for detector-quality analytics.',
    enum: FALSE_POSITIVE_REASONS,
  })
  @IsOptional()
  @IsIn(FALSE_POSITIVE_REASONS)
  reason?: FalsePositiveReason;

  @ApiPropertyOptional({
    description: 'Optional bounded free-text note (no code/PII).',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

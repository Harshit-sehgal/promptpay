import { IsEnum, IsString, IsUUID, MaxLength,MinLength } from 'class-validator';

import { ToolType } from '@waitlayer/shared';

export class WaitStateStartDto {
  @IsUUID()
  deviceId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sessionId!: string;

  @IsEnum(ToolType)
  toolType!: ToolType;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

export class WaitStateEndDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16)
  durationSeconds!: string; // serialized as string from extension, parsed to int

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

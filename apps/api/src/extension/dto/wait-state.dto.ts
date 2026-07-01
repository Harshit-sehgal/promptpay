import { IsString, IsEnum, IsUUID, MinLength, MaxLength } from 'class-validator';
import { ToolType, EventType } from '@waitlayer/shared';

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
  duration!: string; // serialized as string from extension, parsed to int

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  signature!: string;
}

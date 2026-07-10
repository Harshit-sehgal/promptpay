import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { ToolType } from '@waitlayer/shared';

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

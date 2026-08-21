import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import type { AgentLifecycleEventV1 } from '@ateva/agent-protocol';

export class AgentEventsBatchDto {
  @ApiProperty({ description: 'Canonical protocol schema version.', example: 1 })
  @IsDefined()
  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @ApiProperty({ description: 'Environment/run identity bound to the API deployment.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  environmentId!: string;

  @ApiProperty({ description: 'Registered device that owns the installation.' })
  @IsUUID()
  deviceId!: string;

  @ApiProperty({ description: 'Installation-scoped pseudonymous identifier.' })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  installationId!: string;

  @ApiProperty({ description: 'Up to 100 sanitized, non-financial lifecycle events.' })
  @IsArray()
  @ArrayMaxSize(100)
  events!: AgentLifecycleEventV1[];

  @ApiProperty({
    description: 'HMAC over the canonical batch envelope using the registered device secret.',
  })
  @IsString()
  @MinLength(64)
  @MaxLength(128)
  signature!: string;
}

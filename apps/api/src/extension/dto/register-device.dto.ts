import { IsString, IsEnum, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ToolType } from '@waitlayer/shared';

export class RegisterDeviceDto {
  @IsEnum(ToolType)
  toolType!: ToolType;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  fingerprintHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  extensionVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  publicKey?: string;
}

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

  /**
   * Required for re-registration (device already exists for this userId +
   * fingerprint). Proof-of-possession of the previously-issued per-device
   * secret prevents a malicious user who merely knows another user's
   * fingerprintHash from calling /extension/register-device and rotating
   * that user's secret out from under them — which would leak the fresh
   * rotated secret to the attacker in the response.
   *
   * On first registration this field is unused (no prior secret exists).
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  existingEventSecret?: string;
}

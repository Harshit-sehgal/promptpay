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

  /**
   * Recovery path for a same-account reinstall where the local SecretStorage
   * copy of `eventSecret` was lost. This is only accepted for an already
   * authenticated user registering the same fingerprint and only after
   * verifying the account password. Google-linked accounts can use
   * `recoveryGoogleIdToken`; future providers need equivalent re-auth.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  recoveryPassword?: string;

  /**
   * Recovery path for linked Google accounts. The token must verify through
   * the same Google verifier used by /auth/google and must match the
   * authenticated user's linked googleId.
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  recoveryGoogleIdToken?: string;
}

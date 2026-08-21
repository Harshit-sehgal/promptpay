import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { ToolType } from '@ateva/shared';

export class RegisterDeviceDto {
  @ApiProperty()
  @IsEnum(ToolType)
  toolType!: ToolType;

  /**
   * Legacy device pseudonym accepted for older clients. New clients should
   * send installationId instead; the API derives this field with its keyed
   * privacy pseudonymizer before persistence.
   */
  @ApiProperty({ required: false, deprecated: true })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  fingerprintHash?: string;

  /** Stable random per-installation ID generated locally by current clients. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  installationId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  extensionVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  platform?: string;

  @ApiProperty({ required: false })
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
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(16)
  existingEventSecret?: string;

  /**
   * Recovery path for a same-account reinstall where the local SecretStorage
   * copy of `eventSecret` was lost. This is only accepted for an already
   * authenticated user registering the same fingerprint and only after
   * verifying the account password. Google-linked accounts can use
   * `recoveryGoogleIdToken`; non-Google passwordless accounts require a
   * support-issued `recoverySupportToken`.
   */
  @ApiProperty({ required: false })
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
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(4096)
  recoveryGoogleIdToken?: string;

  /**
   * One-time support/admin recovery token for non-Google passwordless
   * accounts. The server stores only a hash, enforces expiry, and consumes
   * the token before rotating the device secret.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  recoverySupportToken?: string;
}

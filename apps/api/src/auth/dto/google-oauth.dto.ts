import { IsBoolean, IsEnum, IsOptional, IsString, Matches,MaxLength } from 'class-validator';

import { SIGNUP_ALLOWED_ROLES,UserRole } from '@waitlayer/shared';

export class GoogleOAuthDto {
  @IsString()
  @MaxLength(4096)
  idToken!: string;

  @IsOptional()
  @IsEnum(SIGNUP_ALLOWED_ROLES, {
    message: 'Role must be developer or advertiser — privileged roles cannot be self-assigned',
  })
  role?: UserRole;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorToken must be a 6-digit TOTP code' })
  twoFactorToken?: string;

  /**
   * Required proof of age/terms acceptance for FIRST-TIME Google signups. When
   * Google creates a brand-new account there is no other signup form, so the
   * client must have collected the consent checkbox before calling this
   * endpoint. Existing Google users (already linked) skip this check (A-034).
   */
  @IsOptional()
  @IsBoolean()
  ageConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  policyVersion?: string;
}

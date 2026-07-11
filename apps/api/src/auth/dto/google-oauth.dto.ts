import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { SIGNUP_ALLOWED_ROLES, UserRole } from '@waitlayer/shared';

export class GoogleOAuthDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4096)
  idToken!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEnum(SIGNUP_ALLOWED_ROLES, {
    message: 'Role must be developer or advertiser — privileged roles cannot be self-assigned',
  })
  role?: UserRole;

  @ApiProperty({ required: false })
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
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  ageConfirmed?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  termsAccepted?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  policyVersion?: string;
}

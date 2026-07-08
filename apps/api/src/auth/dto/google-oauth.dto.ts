import { IsEnum, IsOptional, IsString, Matches,MaxLength } from 'class-validator';

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
}

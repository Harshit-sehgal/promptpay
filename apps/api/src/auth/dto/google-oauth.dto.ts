import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { UserRole, SIGNUP_ALLOWED_ROLES } from '@waitlayer/shared';

export class GoogleOAuthDto {
  @IsString()
  @MaxLength(4096)
  idToken!: string;

  @IsOptional()
  @IsEnum(SIGNUP_ALLOWED_ROLES, {
    message: 'Role must be developer or advertiser — privileged roles cannot be self-assigned',
  })
  role?: UserRole;
}

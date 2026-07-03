import { IsEmail, IsString, IsEnum, MinLength, MaxLength, IsOptional } from 'class-validator';
import { UserRole, SIGNUP_ALLOWED_ROLES } from '@waitlayer/shared';

export class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsEnum(SIGNUP_ALLOWED_ROLES, {
    message: 'Role must be developer or advertiser — privileged roles cannot be self-assigned',
  })
  role!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  referrerCode?: string;
}

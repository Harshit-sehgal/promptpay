import { IsEmail, IsEnum, IsOptional,IsString, MaxLength } from 'class-validator';

import { SIGNUP_ALLOWED_ROLES,UserRole } from '@waitlayer/shared';

import { IsStrongPassword } from '../../common/validators/password.validator';

export class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  @IsStrongPassword()
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

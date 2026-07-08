import { IsBoolean, IsEmail, IsEnum, IsOptional,IsString, MaxLength } from 'class-validator';

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

  /**
   * Required proof that the user is at least 18 and has accepted the current
   * Terms of Service / Privacy Policy. Account creation is refused unless both
   * are true (A-034). The policy version the client accepted is recorded so a
   * future version bump can re-prompt via the consent re-prompt flow.
   */
  @IsBoolean()
  ageConfirmed!: boolean;

  @IsBoolean()
  termsAccepted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  policyVersion?: string;
}

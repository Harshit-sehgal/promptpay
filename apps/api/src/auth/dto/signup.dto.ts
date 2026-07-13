import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { SIGNUP_ALLOWED_ROLES, UserRole } from '@waitlayer/shared';

import { IsStrongPassword } from '../../common/validators/password.validator';
import { transformAuthEmail } from '../email-normalization';

export class SignUpDto {
  @ApiProperty()
  @Transform(transformAuthEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @IsStrongPassword()
  password!: string;

  @ApiProperty()
  @IsEnum(SIGNUP_ALLOWED_ROLES, {
    message: 'Role must be developer or advertiser — privileged roles cannot be self-assigned',
  })
  role!: UserRole;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  country?: string;

  @ApiProperty({ required: false })
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
  @ApiProperty()
  @IsBoolean()
  ageConfirmed!: boolean;

  @ApiProperty()
  @IsBoolean()
  termsAccepted!: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  policyVersion?: string;
}

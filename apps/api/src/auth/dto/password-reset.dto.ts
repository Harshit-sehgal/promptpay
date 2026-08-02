import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { IsStrongPassword } from '../../common/validators/password.validator';
import { transformAuthEmail } from '../email-normalization';

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(transformAuthEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  // RS256-signed reset tokens are ~800 chars; keep a generous ceiling.
  @MaxLength(4096)
  token!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @IsStrongPassword()
  newPassword!: string;
}

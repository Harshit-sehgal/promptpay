import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
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
  token!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @IsStrongPassword()
  newPassword!: string;
}

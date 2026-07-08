import { IsEmail, IsString, MaxLength } from 'class-validator';

import { IsStrongPassword } from '../../common/validators/password.validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MaxLength(128)
  @IsStrongPassword()
  newPassword!: string;
}

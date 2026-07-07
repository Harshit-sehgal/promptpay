import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFactorToken must be a 6-digit TOTP code' })
  twoFactorToken?: string;
}

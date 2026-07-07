import { IsString, Matches } from 'class-validator';

export class TwoFactorEnableDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit TOTP code' })
  token!: string;
}

export class TwoFactorDisableDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit TOTP code' })
  token!: string;
}

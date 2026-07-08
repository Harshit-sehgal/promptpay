import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class TwoFactorEnableDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit TOTP code' })
  token!: string;
}

export class TwoFactorDisableDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit TOTP code' })
  token!: string;
}

import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { IsBcryptPasswordLength } from '../../common/validators/password.validator';

export class TwoFactorEnableDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit TOTP code' })
  token!: string;
}

export class TwoFactorSetupDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @IsBcryptPasswordLength()
  currentPassword?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  googleIdToken?: string;
}

export class TwoFactorBackupCodesRegenerateDto extends TwoFactorEnableDto {}

export class TwoFactorDisableDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit TOTP code' })
  token!: string;
}

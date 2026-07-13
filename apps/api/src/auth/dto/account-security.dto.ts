import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import {
  IsBcryptPasswordLength,
  IsStrongPassword,
} from '../../common/validators/password.validator';

export class SetSocialPasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4096)
  googleIdToken!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @IsStrongPassword()
  newPassword!: string;
}

export class LinkGoogleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4096)
  idToken!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @IsBcryptPasswordLength()
  currentPassword?: string;
}

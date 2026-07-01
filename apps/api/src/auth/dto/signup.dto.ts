import { IsEmail, IsString, IsEnum, MinLength, MaxLength, IsOptional, IsUUID } from 'class-validator';
import { UserRole } from '@waitlayer/shared';

export class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsEnum(UserRole)
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
  @IsUUID()
  referrerCode?: string;
}

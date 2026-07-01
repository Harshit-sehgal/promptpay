import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { UserRole } from '@waitlayer/shared';

export class GoogleOAuthDto {
  @IsString()
  @MaxLength(4096)
  idToken!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

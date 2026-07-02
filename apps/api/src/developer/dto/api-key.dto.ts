import { IsArray, IsOptional, IsString, IsIn, MinLength, MaxLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @IsOptional()
  @IsString()
  advertiserId?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string; // ISO 8601 date string
}

export class RevokeApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
import { IsArray, IsOptional, IsString, MinLength, MaxLength, IsUUID, IsDateString, ArrayMinSize, ArrayMaxSize, ArrayUnique } from 'class-validator';

const ALLOWED_API_KEY_SCOPES = [
  'campaigns:read',
  'campaigns:write',
  'reports:read',
  'reports:write',
  'ledger:read',
  'advertiser:read',
  'advertiser:write',
  'developer:read',
  'developer:write',
  'extension:read',
  'extension:write',
  'payout:read',
  'payout:write',
] as const;

export class CreateApiKeyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  scopes!: string[];

  @IsOptional()
  @IsUUID()
  advertiserId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expiresAt must be a valid ISO 8601 date' })
  expiresAt?: string; // ISO 8601 date string
}

export class RevokeApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}

export { ALLOWED_API_KEY_SCOPES };

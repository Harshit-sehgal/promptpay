import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Self-service API keys are scoped for machine-to-machine *integrations*
// against routes that actually opt in to API-key auth. Extension/CLI ad events
// remain user-session + device-signature flows, not API-key flows.
//
// Sensitive scopes that move real money (`payout:*`) or destroy/exfiltrate
// account data (`developer:write` -> export-data/delete-account) are
// intentionally NOT mintable here. Those endpoints remain JWT-only so a leaked
// long-lived key can never add a payout method, request a payout, export
// personal data, or delete the account. They are kept as a single source of
// truth below so the danger is explicit; if M2M payout/export is ever a
// deliberate product, add it back behind short-expiry + 2FA-step-up issuance,
// not the default list.
const ALLOWED_API_KEY_SCOPES = [
  'campaigns:read',
  'campaigns:write',
  'reports:read',
  'ledger:read',
  'advertiser:read',
  'advertiser:write',
  'developer:read',
] as const;

const REMOVED_SENSITIVE_API_KEY_SCOPES = [
  'payout:read',
  'payout:write',
  'developer:write',
] as const;

const UNSUPPORTED_API_KEY_SCOPES = ['extension:read', 'extension:write', 'reports:write'] as const;

export class CreateApiKeyDto {
  @ApiProperty()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  scopes!: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  advertiserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt must be a valid ISO 8601 date' })
  expiresAt?: string; // ISO 8601 date string
}

export class RevokeApiKeyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}

export { ALLOWED_API_KEY_SCOPES, REMOVED_SENSITIVE_API_KEY_SCOPES, UNSUPPORTED_API_KEY_SCOPES };

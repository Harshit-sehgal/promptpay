import { ArrayMaxSize, ArrayMinSize, ArrayUnique,IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// Self-service API keys are scoped for machine-to-machine *integrations*
// (extension/CLI ad events, reporting, campaign management), NOT money
// movement or account-takeover-capable actions. Sensitive scopes that move
// real money (`payout:*`) or destroy/exfiltrate account data
// (`developer:write` → export-data/delete-account) are intentionally NOT
// mintable here — those endpoints remain JWT-only so a leaked long-lived key
// can never add a payout method, request a payout, export personal data, or
// delete the account. They are kept as a single source of truth below so the
// danger is explicit; if M2M payout/export is ever a deliberate product, add
// it back behind short-expiry + 2FA-step-up issuance, not the default list.
const ALLOWED_API_KEY_SCOPES = [
  'campaigns:read',
  'campaigns:write',
  'reports:read',
  'reports:write',
  'ledger:read',
  'advertiser:read',
  'advertiser:write',
  'developer:read',
  'extension:read',
  'extension:write',
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

import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Advertiser waitlist signup (LAUNCH_PLAN Phase 2 step 11).
 *
 * Public and unauthenticated by design — the point is to capture interest
 * before accounts can spend. The endpoint is throttled at 5 req/min (its own
 * guard) and validation is strict: `email` is mandatory and normalized to
 * lowercase in the service; `consent` MUST be true (GDPR marketing consent —
 * a waitlist address may later be emailed); `website` is a honeypot field
 * that real users never fill and bots do (mirrors FeedbackService).
 */
export class CreateWaitlistDto {
  @ApiProperty({ example: 'marketing@example.com' })
  // Trim + lowercase at the DTO boundary so `IsEmail` sees the canonical form
  // (the service re-normalizes defensively for non-pipe callers).
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Email must be valid' })
  @MaxLength(254, { message: 'Email must be at most 254 characters' })
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120, { message: 'Company must be at most 120 characters' })
  company?: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code' })
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/, { message: 'Country must be a 2-letter ISO code' })
  country?: string;

  @ApiProperty({ description: 'GDPR marketing consent; must be true' })
  @IsBoolean()
  consent!: boolean;

  /** Honeypot field. Real users never fill this; bots do. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}

export class WaitlistQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'invited', 'onboarded', 'declined'] })
  @IsOptional()
  @IsIn(['pending', 'invited', 'onboarded', 'declined'])
  status?: 'pending' | 'invited' | 'onboarded' | 'declined';

  @ApiPropertyOptional({ description: '1-based page (parsed defensively, A-121)' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Page size (parsed defensively, A-121)' })
  @IsOptional()
  @IsString()
  limit?: string;
}

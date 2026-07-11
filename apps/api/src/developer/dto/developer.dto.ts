import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  adsEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  quietMode?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  quietModeStart?: string; // "HH:MM"

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  quietModeEnd?: string; // "HH:MM"

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  maxAdsPerHour?: number;

  /**
   * A-058: IANA timezone identifier (e.g. "America/New_York", "Asia/Kolkata")
   * used to evaluate quiet mode in the developer's local wall-clock time
   * instead of the API server's timezone. Validated server-side against the
   * set of tz identifiers the runtime actually knows (rejects typos / attempts
   * to stash arbitrary strings). When unset, quiet mode evaluates in UTC.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /**
   * A-057: per-developer persisted blocked category slugs. Merged with any
   * per-request client-supplied arrays during ad selection so enforcement is
   * guaranteed server-side even when the client omits them.
   *
   * Boundary validation: each entry must be a lowercase slug (letters,
   * numbers, hyphens). This rejects typo'd or free-text preferences (e.g.
   * "Finance!", "") before they can be persisted as a blocking rule that
   * would never match a real campaign category. Full taxonomy-membership
   * validation against the advertiser Category table is a follow-up product
   * step (sharing one taxonomy with the advertiser category picker).
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    each: true,
    message: 'blockedCategories entries must be lowercase slug strings (letters, numbers, hyphens)',
  })
  blockedCategories?: string[];
}

export class EarningsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class DeleteAccountDto {
  @ApiProperty()
  @IsString()
  @Matches(/^DELETE_MY_ACCOUNT$/, {
    message: 'confirmation must be exactly DELETE_MY_ACCOUNT',
  })
  confirmation!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  currentPassword?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  googleIdToken?: string;
}

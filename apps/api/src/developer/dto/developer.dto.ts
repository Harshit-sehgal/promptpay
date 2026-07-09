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

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  adsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  quietMode?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  quietModeStart?: string; // "HH:MM"

  @IsOptional()
  @IsString()
  @MaxLength(5)
  quietModeEnd?: string; // "HH:MM"

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  maxAdsPerHour?: number;

  /**
   * A-058: IANA timezone identifier (e.g. "America/New_York", "Asia/Kolkata")
   * used to evaluate quiet mode in the developer's local wall-clock time
   * instead of the API server's timezone. Validated server-side against the
   * set of tz identifiers the runtime actually knows (rejects typos / attempts
   * to stash arbitrary strings). When unset, quiet mode evaluates in UTC.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /**
   * A-057: per-developer persisted blocked category slugs. Merged with any
   * per-request client-supplied arrays during ad selection so enforcement is
   * guaranteed server-side even when the client omits them.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  blockedCategories?: string[];
}

export class EarningsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DeleteAccountDto {
  @IsString()
  @Matches(/^DELETE_MY_ACCOUNT$/, {
    message: 'confirmation must be exactly DELETE_MY_ACCOUNT',
  })
  confirmation!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  googleIdToken?: string;
}

import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

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

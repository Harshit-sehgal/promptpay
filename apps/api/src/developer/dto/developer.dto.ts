import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

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
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
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

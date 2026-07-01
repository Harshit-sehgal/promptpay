import { IsEmail, IsString, IsOptional, IsUrl, IsInt, IsBoolean, IsEnum, MaxLength, Min, Max } from 'class-validator';
import { BidType } from '@waitlayer/shared';

export class CreateProfileDto {
  @IsString()
  @MaxLength(100)
  companyName!: string;

  @IsEmail()
  billingEmail!: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  websiteUrl?: string;
}

export class CreateCampaignDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(50)
  category!: string;

  @IsEnum(BidType)
  bidType!: BidType;

  @IsString()
  @MaxLength(10)
  currency!: string;

  @IsInt()
  @Min(1)
  bidAmountMinor!: number;

  @IsInt()
  @Min(1)
  budgetTotalMinor!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  frequencyCapPerHour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  frequencyCapPerDay?: number;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  bidAmountMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  budgetTotalMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  frequencyCapPerHour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  frequencyCapPerDay?: number;
}

export class CreateCountryTargetingDto {
  @IsString()
  @MaxLength(2)
  countryCode!: string;

  @IsBoolean()
  include!: boolean;
}

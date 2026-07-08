import { IsEmail, IsString, IsOptional, IsUrl, IsIn, IsInt, IsBoolean, IsEnum, MaxLength, Min, Max, Length, Matches } from 'class-validator';
import { BidType } from '@waitlayer/shared';

const DEPOSIT_CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'inr', 'brl', 'mxn', 'sgd'] as const;

export class CreateProfileDto {
  @IsString()
  @MaxLength(100)
  companyName!: string;

  @IsEmail()
  billingEmail!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
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

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an uppercase ISO 4217 code' })
  currency?: string;

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

/** Deposit-session body was previously unvalidated raw `{ amountMinor, currency }`
 *  — a zero/negative/float amount could reach Stripe's unit_amount.
 *  This DTO closes that gap. */
export class CreateDepositSessionDto {
  @IsInt()
  @Min(100, { message: 'Minimum deposit is 100 minor units' })
  amountMinor!: number;

  @IsOptional()
  @IsIn(DEPOSIT_CURRENCIES, {
    message: 'Currency must be one of the supported deposit currencies',
  })
  currency?: string;
}

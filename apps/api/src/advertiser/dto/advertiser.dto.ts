import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BidType, depositMinimumMinor } from '@waitlayer/shared';

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
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an uppercase ISO 4217 code' })
  currency?: string;

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
 *  This DTO enforces the global integer floor; the per-currency minimum
 *  (see `depositMinimumMinor()` in @waitlayer/shared) is re-checked in the
 *  controller/service once the currency is normalized, where the dynamic
 *  policy value can be read safely. class-validator's `@Min` takes a static
 *  number, not a per-field-value callback. */
export class CreateDepositSessionDto {
  @IsInt()
  @Min(depositMinimumMinor('USD'), {
    message: (args) =>
      `Minimum deposit is ${depositMinimumMinor(
        (args.object as CreateDepositSessionDto).currency ?? 'USD',
      )} minor units`,
  })
  amountMinor!: number;

  @IsOptional()
  @IsIn(DEPOSIT_CURRENCIES, {
    message: 'Currency must be one of the supported deposit currencies',
  })
  currency?: string;
}

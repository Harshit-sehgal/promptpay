import { Transform, Type } from 'class-transformer';
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
import { ApiProperty } from '@nestjs/swagger';

import { BidType, depositMinimumMinor } from '@waitlayer/shared';

import { toBigIntOrOriginal } from '../../common/transforms/bigint.transform';
import { IsBigInt, MinBigInt } from '../../common/validators/bigint.validators';

const DEPOSIT_CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'inr', 'brl', 'mxn', 'sgd'] as const;

export class CreateProfileDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  companyName!: string;

  @ApiProperty()
  @IsEmail()
  billingEmail!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  websiteUrl?: string;
}

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  category!: string;

  @ApiProperty()
  @IsEnum(BidType)
  bidType!: BidType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an uppercase ISO 4217 code' })
  currency?: string;

  @ApiProperty()
  @IsBigInt()
  @MinBigInt(1n)
  @Transform(toBigIntOrOriginal)
  bidAmountMinor!: bigint;

  @ApiProperty()
  @IsBigInt()
  @MinBigInt(1n)
  @Transform(toBigIntOrOriginal)
  budgetTotalMinor!: bigint;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @Type(() => Number)
  frequencyCapPerHour?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  frequencyCapPerDay?: number;
}

export class UpdateCampaignDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBigInt()
  @MinBigInt(1n)
  @Transform(toBigIntOrOriginal)
  bidAmountMinor?: bigint;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBigInt()
  @MinBigInt(1n)
  @Transform(toBigIntOrOriginal)
  budgetTotalMinor?: bigint;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an uppercase ISO 4217 code' })
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @Type(() => Number)
  frequencyCapPerHour?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  frequencyCapPerDay?: number;
}

export class CreateCountryTargetingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2)
  countryCode!: string;

  @ApiProperty()
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
  @ApiProperty()
  @IsBigInt()
  @MinBigInt(BigInt(depositMinimumMinor('USD')), {
    message: (args) =>
      `Minimum deposit is ${depositMinimumMinor(
        (args.object as CreateDepositSessionDto).currency ?? 'USD',
      )} minor units`,
  })
  @Transform(toBigIntOrOriginal)
  amountMinor!: bigint;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(DEPOSIT_CURRENCIES, {
    message: 'Currency must be one of the supported deposit currencies',
  })
  currency?: string;
}

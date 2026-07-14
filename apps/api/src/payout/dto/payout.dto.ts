import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { payoutMinimumMinor, PayoutProvider } from '@waitlayer/shared';

import { toBigIntOrOriginal } from '../../common/transforms/bigint.transform';
import { IsBigInt, MinBigInt } from '../../common/validators/bigint.validators';

export class AddPayoutMethodDto {
  @ApiProperty()
  @IsEnum(PayoutProvider)
  provider!: PayoutProvider;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  destination!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class RequestPayoutDto {
  @ApiProperty()
  @IsUUID()
  payoutAccountId!: string;

  @ApiProperty()
  @IsBigInt()
  // The per-currency payout minimum (see `payoutMinimumMinor()` in
  // @waitlayer/shared) is enforced in the service once the currency is
  // parsed. The static floor below is a defensive lower bound. See A-031.
  @MinBigInt(BigInt(payoutMinimumMinor(null)), {
    message: (args) =>
      `Minimum payout is ${payoutMinimumMinor(
        (args.object as RequestPayoutDto).currency,
      )} minor units`,
  })
  @Transform(toBigIntOrOriginal)
  amountMinor!: bigint;

  @ApiProperty()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an uppercase ISO 4217 code' })
  currency!: string;

  /** Optional: specify exact earnings entry IDs to allocate.
   *  If omitted, the oldest confirmed entries are auto-selected. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  earningsEntryIds?: string[];

  /** Optional client-supplied idempotency key. Replaying a request with the
   *  same key returns the original payout instead of creating a duplicate. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

export class PayoutHistoryQueryDto {
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

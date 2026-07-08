import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches,Max, MaxLength, Min } from 'class-validator';

import { PayoutProvider, payoutMinimumMinor } from '@waitlayer/shared';

export class AddPayoutMethodDto {
  @IsEnum(PayoutProvider)
  provider!: PayoutProvider;

  @IsString()
  @MaxLength(255)
  destination!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

export class RequestPayoutDto {
  @IsUUID()
  payoutAccountId!: string;

  @IsInt()
  @Min((args) => payoutMinimumMinor((args.object as RequestPayoutDto).currency), {
    message: (args) =>
      `Minimum payout is ${payoutMinimumMinor((args.object as RequestPayoutDto).currency)} minor units`,
  })
  amountMinor!: number;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an uppercase ISO 4217 code' })
  currency!: string;

  /** Optional: specify exact earnings entry IDs to allocate.
   *  If omitted, the oldest confirmed entries are auto-selected. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  earningsEntryIds?: string[];
}

export class PayoutHistoryQueryDto {
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

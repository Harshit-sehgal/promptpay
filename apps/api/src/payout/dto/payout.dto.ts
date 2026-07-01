import { IsInt, IsOptional, IsString, Min, Max, MaxLength, IsEnum } from 'class-validator';
import { PayoutProvider } from '@waitlayer/shared';

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
  @IsString()
  payoutAccountId!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @MaxLength(3)
  currency!: string;
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

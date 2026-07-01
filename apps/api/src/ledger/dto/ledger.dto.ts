import { IsInt, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';

export class LedgerHistoryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  ledgerKind?: string; // 'earnings' | 'advertiser' | 'platform'

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

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

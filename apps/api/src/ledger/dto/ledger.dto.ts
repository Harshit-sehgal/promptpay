import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class LedgerHistoryQueryDto {
  @IsOptional()
  @IsIn(['earnings', 'advertiser', 'platform'])
  ledgerKind?: string; // 'earnings' | 'advertiser' | 'platform'

  @IsOptional()
  @IsString()
  @IsIn(['estimated', 'pending', 'confirmed', 'held', 'reversed', 'paid', 'void'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

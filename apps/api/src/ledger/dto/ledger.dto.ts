import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LedgerHistoryQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['earnings', 'advertiser', 'platform'])
  ledgerKind?: string; // 'earnings' | 'advertiser' | 'platform'

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsIn(['estimated', 'pending', 'confirmed', 'held', 'reversed', 'paid', 'void'])
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

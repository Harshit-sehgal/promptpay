import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplyReferralDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  code!: string;
}

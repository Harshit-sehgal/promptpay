import { IsString, MinLength } from 'class-validator';

export class ApplyReferralDto {
  @IsString()
  @MinLength(1)
  code!: string;
}

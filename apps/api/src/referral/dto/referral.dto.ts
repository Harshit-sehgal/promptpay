import { IsString } from 'class-validator';

export class ApplyReferralDto {
  @IsString()
  code: string;
}
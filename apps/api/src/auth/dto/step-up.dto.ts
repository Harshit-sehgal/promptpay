import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StepUpRequestDto {
  @ApiProperty({
    description: 'Action the step-up token will be scoped to',
    example: 'payout:request',
  })
  @IsString()
  action: string;

  @ApiProperty({ description: 'Current TOTP code or backup code', example: '123456' })
  @IsString()
  @Matches(/^\d{6}$|^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, {
    message: 'Token must be a 6-digit TOTP code or a backup code',
  })
  token: string;
}

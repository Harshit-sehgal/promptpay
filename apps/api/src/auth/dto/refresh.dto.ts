import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token issued at login/signup/rotation.' })
  @IsString()
  refreshToken!: string;
}

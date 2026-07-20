import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token issued at login/signup/rotation.' })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiProperty({
    required: false,
    description:
      'A still-valid access JWT, exchanged for a fresh pair (CLI / VSCode-extension clients).',
  })
  @IsOptional()
  @IsString()
  accessToken?: string;
}

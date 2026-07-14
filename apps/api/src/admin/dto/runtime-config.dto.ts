import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRuntimeConfigDto {
  @ApiProperty({ description: 'New value as JSON string', example: '{"enabled":false}' })
  @IsString()
  value!: string;

  @ApiPropertyOptional({ description: 'Human-readable reason for the change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ToggleRuntimeConfigDto {
  @ApiProperty({ description: 'Desired enabled state' })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Human-readable reason for the change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

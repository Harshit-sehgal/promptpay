import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Validation for POST /fraud/flags/:id/resolve.
 *
 * Previously this controller used an inline `@Body() body: { isValid: boolean;
 * reviewNote?: string }` type — inline types have no class-validator metadata,
 * so the global ValidationPipe could not validate or transform the payload.
 * A truthy non-boolean (e.g. `isValid: 'yes'`) would flow straight into
 * `FraudService.resolveFlag`, where `isValid` gates whether earnings are
 * REVERSED (truthy → reverse) or RELEASED (falsy → release). That's a
 * money-mutating endpoint with no input validation.
 *
 * This DTO uses a closed enum `decision: 'confirmed' | 'invalid'` (matching
 * the admin controller's ResolveFraudFlagDto) and bounds `note` to 500 chars.
 */
export class ResolveFlagDto {
  @ApiProperty()
  @IsIn(['confirmed', 'invalid'])
  decision!: 'confirmed' | 'invalid';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

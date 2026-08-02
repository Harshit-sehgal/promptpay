import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  // RS256-signed stateless tokens are ~800 chars; keep a generous ceiling.
  @MaxLength(4096)
  token!: string;
}

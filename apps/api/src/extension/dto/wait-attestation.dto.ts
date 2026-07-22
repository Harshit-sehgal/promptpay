import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWaitAttestationSessionDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiProperty({
    description: 'Client-generated wait identifier; contains no prompt or source text.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  waitStateId!: string;

  @ApiProperty({ description: 'Opaque client session identifier for the wait operation.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sessionId!: string;

  @ApiProperty({ description: 'Approved external attestation provider identifier.' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(64)
  provider!: string;
}

export class ConsumeWaitAttestationDto {
  @ApiProperty({ description: 'Opaque attestation-session id returned by the start endpoint.' })
  @IsUUID()
  attestationSessionId!: string;

  @ApiProperty({ description: 'Provider/server-signed RS256 assertion. Never persisted raw.' })
  @IsString()
  @MinLength(32)
  @MaxLength(16_384)
  assertion!: string;
}

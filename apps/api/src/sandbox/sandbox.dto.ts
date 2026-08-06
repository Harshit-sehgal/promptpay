import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SandboxResetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'environmentId contains unsupported characters' })
  environmentId!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  resetToken!: string;
}

export class SandboxFaucetDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey contains unsupported characters' })
  idempotencyKey!: string;
}

export class SandboxPayoutDto {
  @IsInt()
  @Min(1)
  @Max(100_000)
  amountMinor!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^sandbox:[A-Za-z0-9._:-]+$/, { message: 'destinationAlias must be a sandbox alias' })
  destinationAlias!: string;

  @IsIn([
    'paid',
    'processing',
    'failed',
    'ambiguous',
    'reversed',
    'callback_before_response',
    'duplicate_callback',
    'timeout',
    'reconciliation_escalation',
  ])
  outcome!:
    | 'paid'
    | 'processing'
    | 'failed'
    | 'ambiguous'
    | 'reversed'
    | 'callback_before_response'
    | 'duplicate_callback'
    | 'timeout'
    | 'reconciliation_escalation';

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey contains unsupported characters' })
  idempotencyKey!: string;
}

export class SandboxDepositDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amountMinor!: number;

  @IsIn([
    'approved',
    'processing',
    'declined',
    'refunded',
    'disputed',
    'timeout',
    'duplicate_callback',
    'delayed_callback',
    'callback_before_response',
    'currency_mismatch',
    'amount_mismatch',
  ])
  outcome!:
    | 'approved'
    | 'processing'
    | 'declined'
    | 'refunded'
    | 'disputed'
    | 'timeout'
    | 'duplicate_callback'
    | 'delayed_callback'
    | 'callback_before_response'
    | 'currency_mismatch'
    | 'amount_mismatch';

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey contains unsupported characters' })
  idempotencyKey!: string;
}

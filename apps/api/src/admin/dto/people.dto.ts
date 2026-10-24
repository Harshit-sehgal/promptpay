import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import type { Prisma } from '@ateva/db';

// `AdvertiserWaitlistStatus` is not re-exported by @ateva/db, so the Prisma
// input type is the compile-time check that this list matches the enum.
export const WAITLIST_STATUSES = [
  'pending',
  'invited',
  'onboarded',
  'declined',
] as const satisfies readonly NonNullable<Prisma.AdvertiserWaitlistCreateInput['status']>[];

export class SetWaitlistStatusDto {
  @ApiProperty({ enum: WAITLIST_STATUSES })
  @IsString()
  @IsIn(WAITLIST_STATUSES)
  status!: (typeof WAITLIST_STATUSES)[number];
}

export const NOTE_MAX_LENGTH = 2000;
export const TAG_MAX_PER_PERSON = 10;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class AddPersonNoteDto {
  @ApiProperty({ minLength: 1, maxLength: NOTE_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(NOTE_MAX_LENGTH)
  body!: string;
}

export class SetPersonTagsDto {
  @ApiProperty({
    type: [String],
    description: `Lowercase letters, digits and hyphens, 1 to 32 chars, at most ${TAG_MAX_PER_PERSON}`,
  })
  @IsArray()
  // Generous transport bound; the service enforces the real limit after
  // normalising and collapsing duplicates.
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags!: string[];
}

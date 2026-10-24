import { IsIn, IsString } from 'class-validator';
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

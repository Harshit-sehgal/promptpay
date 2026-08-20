import { UserStatus } from '@ateva/shared';

export function isActiveAccountStatus(status: string | null | undefined): boolean {
  return status === UserStatus.ACTIVE;
}

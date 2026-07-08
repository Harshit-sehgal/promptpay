import { UserStatus } from '@waitlayer/shared';

export function isActiveAccountStatus(status: string | null | undefined): boolean {
  return status === UserStatus.ACTIVE;
}

import { describe, expect, it } from 'vitest';

import { UserStatus } from '@waitlayer/shared';

import { isActiveAccountStatus } from './account-status';

describe('isActiveAccountStatus (A-048 / #4)', () => {
  it('is true only for the ACTIVE status', () => {
    expect(isActiveAccountStatus(UserStatus.ACTIVE)).toBe(true);
  });

  it('is false for any other value or missing status', () => {
    expect(isActiveAccountStatus('not-active')).toBe(false);
    expect(isActiveAccountStatus(undefined)).toBe(false);
    expect(isActiveAccountStatus(null)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { getDashboardPath, resolveSignupIntent } from './auth-routing';

describe('auth routing helpers', () => {
  it('resolves explicit developer signup URLs', () => {
    expect(resolveSignupIntent('?role=developer')).toEqual({
      role: 'developer',
      referrerCode: '',
    });
  });

  it('resolves explicit advertiser signup URLs', () => {
    expect(resolveSignupIntent('?role=advertiser')).toEqual({
      role: 'advertiser',
      referrerCode: '',
    });
  });

  it('keeps referral signup URLs developer-only', () => {
    expect(resolveSignupIntent('?role=advertiser&ref= invite-123 ')).toEqual({
      role: 'developer',
      referrerCode: 'INVITE-123',
    });
  });

  it('falls invalid role values back to developer', () => {
    expect(resolveSignupIntent('?role=admin')).toEqual({
      role: 'developer',
      referrerCode: '',
    });
  });

  it('maps roles to dashboards', () => {
    expect(getDashboardPath('advertiser')).toBe('/advertiser');
    expect(getDashboardPath('admin')).toBe('/admin');
    expect(getDashboardPath('super_admin')).toBe('/admin');
    expect(getDashboardPath('developer')).toBe('/developer');
    expect(getDashboardPath(undefined)).toBe('/developer');
  });
});

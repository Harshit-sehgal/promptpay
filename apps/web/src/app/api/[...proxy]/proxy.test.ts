import { describe, expect, it } from 'vitest';

import { ALLOWED_PATH_PREFIXES, isProxyPathAllowed, stripSensitiveFields } from './route';

describe('proxy allowlist (A-006)', () => {
  it('permits known developer, auth, admin, and payout prefixes', () => {
    expect(isProxyPathAllowed('/auth/me')).toBe(true);
    expect(isProxyPathAllowed('/auth/2fa/setup')).toBe(true);
    expect(isProxyPathAllowed('/developer/dashboard')).toBe(true);
    expect(isProxyPathAllowed('/developer/delete-account')).toBe(true);
    expect(isProxyPathAllowed('/developer/delete-account/confirm')).toBe(true);
    expect(isProxyPathAllowed('/auth/verify-email/request')).toBe(true);
    expect(isProxyPathAllowed('/advertiser/campaigns')).toBe(true);
    expect(isProxyPathAllowed('/admin/users')).toBe(true);
    expect(isProxyPathAllowed('/admin/devices')).toBe(true);
    expect(isProxyPathAllowed('/payout/request')).toBe(true);
    expect(isProxyPathAllowed('/ledger/balance')).toBe(true);
    expect(isProxyPathAllowed('/health')).toBe(true);
  });

  it('denies paths outside the allowlist (including extension endpoints)', () => {
    expect(isProxyPathAllowed('/extension/register-device')).toBe(false);
    expect(isProxyPathAllowed('/admin/internal/secret')).toBe(false);
    expect(isProxyPathAllowed('/developer/api-keys/revoke')).toBe(true);
    expect(isProxyPathAllowed('/../evil')).toBe(false);
  });

  it('has a non-empty allowlist', () => {
    expect(ALLOWED_PATH_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe('proxy response scrubbing (A-005 / A-006)', () => {
  it('strips tokens and secrets from normal responses', () => {
    const body = {
      accessToken: 'a',
      refreshToken: 'r',
      secret: 's',
      eventSecret: 'e',
      data: { secret: 'nested', name: 'ok' },
    };
    const out = stripSensitiveFields(body) as Record<string, unknown>;
    expect(out.accessToken).toBeUndefined();
    expect(out.refreshToken).toBeUndefined();
    expect(out.secret).toBeUndefined();
    expect(out.eventSecret).toBeUndefined();
    expect((out.data as Record<string, unknown>).secret).toBeUndefined();
    expect((out.data as Record<string, unknown>).name).toBe('ok');
  });

  it('preserves the TOTP secret only for the 2FA setup path', () => {
    const setup = { secret: 'TOTPKEY', otpauthUrl: 'u', ok: 1 };
    const out = stripSensitiveFields(setup, true) as Record<string, unknown>;
    expect(out.secret).toBe('TOTPKEY');
    expect(out.otpauthUrl).toBe('u');
    expect(out.ok).toBe(1);

    // The same body, without the setup flag, is stripped.
    const stripped = stripSensitiveFields(setup) as Record<string, unknown>;
    expect(stripped.secret).toBeUndefined();
  });
});

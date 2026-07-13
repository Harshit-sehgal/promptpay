import { describe, expect, it } from 'vitest';

import { envSchema, loadEnv } from '@waitlayer/config';

// All env values are provided as a plain object (mimicking process.env, which
// is always strings in real life). z.coerce.number() handles numeric coercion
// from string inputs, so we pass strings where a real deploy would.
//
// This suite is intentionally DB-free: it only exercises the zod schema and the
// thin loadEnv wrapper. It does NOT import AppModule or Prisma.

// A minimal valid DEVELOPMENT environment: only the fields without a default
// and without production-only refinements are required.
function baseDevEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a-very-long-development-jwt-secret-value-32plus',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

// A complete production environment that satisfies every production refine
// except the one a given test deliberately omits/breaks.
function baseProdEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a-very-long-production-jwt-secret-value-32plus!!',
    REDIS_URL: 'redis://localhost:6379',
    TOTP_SECRET_ENCRYPTION_KEY: 'production-totp-encryption-key-32plus!!!',
    PRIVACY_HASH_KEY: 'production-privacy-hmac-key-at-least-32-characters',
    API_BASE_URL: 'https://api.waitlayer.com',
    WEB_BASE_URL: 'https://app.waitlayer.com',
    EMAIL_DRIVER: 'resend',
    EMAIL_FROM: 'security@waitlayer.com',
    RESEND_API_KEY: 'resend-production-key',
    PAYOUT_REQUIRE_2FA: 'true',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('env validation (config module)', () => {
  it('accepts a minimal valid DEVELOPMENT environment', () => {
    const result = envSchema.safeParse(baseDevEnv());
    expect(result.success).toBe(true);
  });

  it('rejects NODE_ENV=production without REDIS_URL', () => {
    const { REDIS_URL, ...env } = baseProdEnv();
    void REDIS_URL;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects NODE_ENV=production without TOTP_SECRET_ENCRYPTION_KEY', () => {
    const { TOTP_SECRET_ENCRYPTION_KEY, ...env } = baseProdEnv();
    void TOTP_SECRET_ENCRYPTION_KEY;
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects NODE_ENV=production with wildcard WEB_BASE_URL', () => {
    const result = envSchema.safeParse(baseProdEnv({ WEB_BASE_URL: '*' }));
    expect(result.success).toBe(false);
  });

  it('rejects a JWT_SECRET containing the "change-me" placeholder', () => {
    const result = envSchema.safeParse(
      baseDevEnv({
        JWT_SECRET: 'change-me-this-is-a-long-enough-placeholder-secret-32',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a JWT_SECRET starting with "dev-jwt-secret"', () => {
    const result = envSchema.safeParse(
      baseDevEnv({
        JWT_SECRET: 'dev-jwt-secret-a-very-long-enough-placeholder-value-32',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects WISE_MODE=live without WISE_API_TOKEN', () => {
    const result = envSchema.safeParse(baseDevEnv({ WISE_MODE: 'live' }));
    expect(result.success).toBe(false);
  });

  it('accepts WISE_MODE=live when token and profile id are present', () => {
    const result = envSchema.safeParse(
      baseDevEnv({
        WISE_MODE: 'live',
        WISE_API_TOKEN: 'wise-token',
        WISE_PROFILE_ID: 'wise-profile',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects PAYPAL_MODE=live without PAYPAL_CLIENT_ID', () => {
    const result = envSchema.safeParse(baseDevEnv({ PAYPAL_MODE: 'live' }));
    expect(result.success).toBe(false);
  });

  it('accepts PAYPAL_MODE=live when client id and secret are present', () => {
    const result = envSchema.safeParse(
      baseDevEnv({
        PAYPAL_MODE: 'live',
        PAYPAL_CLIENT_ID: 'paypal-client',
        PAYPAL_CLIENT_SECRET: 'paypal-secret',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('coerces API_PORT from a string to a number', () => {
    const result = envSchema.safeParse(baseDevEnv({ API_PORT: '4002' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.API_PORT).toBe(4002);
      expect(typeof result.data.API_PORT).toBe('number');
    }
  });

  it('rejects TRUST_PROXY_HOPS above 3', () => {
    const result = envSchema.safeParse(baseDevEnv({ TRUST_PROXY_HOPS: '4' }));
    expect(result.success).toBe(false);
  });

  it.each(['0', '65536', '1.5'])('rejects an invalid API port (%s)', (API_PORT) => {
    expect(envSchema.safeParse(baseDevEnv({ API_PORT })).success).toBe(false);
  });

  it('rejects production payout configuration without mandatory MFA', () => {
    expect(envSchema.safeParse(baseProdEnv({ PAYOUT_REQUIRE_2FA: 'false' })).success).toBe(false);
  });

  it('rejects explicitly disabling webhook reclaim in production', () => {
    expect(envSchema.safeParse(baseProdEnv({ WEBHOOK_RECLAIM_CRON: 'false' })).success).toBe(false);
  });

  it('rejects the removed async-webhook switch in every environment', () => {
    expect(envSchema.safeParse(baseDevEnv({ WEBHOOK_ASYNC_PROCESSING: 'true' })).success).toBe(false);
  });

  it('strictly validates payout-provider override JSON', () => {
    expect(
      envSchema.safeParse(
        baseDevEnv({ WAITLAYER_PAYOUT_PROVIDER_STATUS: '{"unknown":"available"}' }),
      ).success,
    ).toBe(false);
    expect(
      envSchema.safeParse(
        baseDevEnv({ WAITLAYER_PAYOUT_PROVIDER_STATUS: '{"wise":"coming_soon"}' }),
      ).success,
    ).toBe(true);
  });

  it('bounds operational timeout and cron controls', () => {
    expect(envSchema.safeParse(baseDevEnv({ EMAIL_PROVIDER_TIMEOUT_MS: '999' })).success).toBe(false);
    expect(envSchema.safeParse(baseDevEnv({ PROVIDER_CALL_TIMEOUT_MS: '120001' })).success).toBe(false);
    expect(envSchema.safeParse(baseDevEnv({ WEBHOOK_RECLAIM_CRON_BATCH_SIZE: '1001' })).success).toBe(false);
  });

  it('loadEnv returns parsed config for a valid environment', () => {
    const env = loadEnv(baseDevEnv());
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_URL).toContain('postgresql://');
  });

  it('loadEnv throws on an invalid environment', () => {
    expect(() => loadEnv(baseDevEnv({ JWT_SECRET: 'short' }))).toThrow();
  });
});

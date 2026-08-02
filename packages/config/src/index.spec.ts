import { describe, expect, it } from 'vitest';

import { envSchema, loadEnv } from './index';

const BASE_ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost:5432/waitlayer' };

function validKey(): string {
  return Buffer.alloc(32, 7).toString('base64');
}

function fullProductionEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost:5432/waitlayer',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----',
    JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBg==\n-----END PUBLIC KEY-----',
    BFF_TRUST_PROXY_HOPS: '1',
    ALLOWED_COUNTRIES: 'US,IN',
    ALLOWED_CURRENCIES: 'USD,INR',
    PAYOUT_DESTINATION_COOLDOWN_HOURS: '24',
    PAYOUT_REQUIRE_2FA: 'true',
    PRIVACY_HASH_KEY: validKey(),
    EMAIL_QUEUE_SECRET: 'email-queue-secret-1234567890abcdef',
    OPS_ALERT_EMAIL: 'ops@example.com',
    EMAIL_DRIVER: 'resend',
    RESEND_API_KEY: 're_test_1234567890abcdef',
    EMAIL_FROM: 'alerts@waitlayer.com',
    API_BASE_URL: 'https://api.waitlayer.com',
    WEB_BASE_URL: 'https://waitlayer.com',
    TOTP_SECRET_ENCRYPTION_KEY: 'totp-encryption-key-1234567890abcdef',
    PAYOUT_ENCRYPTION_KEY: validKey(),
    PAYOUT_HMAC_KEY: Buffer.alloc(32, 9).toString('base64'),
    JWT_SECRET: 'a-solid-random-secret-1234567890abc',
  };
}

function samplePublicKey(): string {
  return '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttest\n-----END PUBLIC KEY-----';
}

describe('@waitlayer/config env schema', () => {
  it('loads a minimal development environment with defaults', () => {
    const env = loadEnv(BASE_ENV);
    expect(env.NODE_ENV).toBe('test');
    expect(env.API_PORT).toBe(4002);
    expect(env.WEB_PORT).toBe(3000);
    expect(env.JWT_ISSUER).toBe('waitlayer');
    expect(env.JWT_AUDIENCE).toBe('waitlayer-client');
    expect(env.THROTTLE_AUTH_SHORT_LIMIT).toBeUndefined();
  });

  it('accepts throttle overrides with coerced ints >= 1', () => {
    const env = loadEnv({
      ...BASE_ENV,
      THROTTLE_AUTH_SHORT_LIMIT: '200',
      THROTTLE_AUTH_LONG_LIMIT: '500',
      THROTTLE_EXTENSION_LIMIT: '600',
      THROTTLE_DEFAULT_LIMIT: '1000',
    });
    expect(env.THROTTLE_AUTH_SHORT_LIMIT).toBe(200);
    expect(env.THROTTLE_DEFAULT_LIMIT).toBe(1000);
  });

  it('rejects non-integer and zero throttle limits', () => {
    expect(() => loadEnv({ ...BASE_ENV, THROTTLE_AUTH_SHORT_LIMIT: '0' })).toThrow();
    expect(() => loadEnv({ ...BASE_ENV, THROTTLE_EXTENSION_LIMIT: 'abc' })).toThrow();
  });

  it('rejects country/currency allowlists with malformed codes', () => {
    expect(() => loadEnv({ ...BASE_ENV, ALLOWED_COUNTRIES: 'USA' })).toThrow();
    expect(() => loadEnv({ ...BASE_ENV, ALLOWED_CURRENCIES: 'USDollar' })).toThrow();
    expect(() => loadEnv({ ...BASE_ENV, ALLOWED_CURRENCIES: 'US' })).toThrow();
    expect(() => loadEnv({ ...BASE_ENV, ALLOWED_COUNTRIES: 'US,CA' })).not.toThrow();
    expect(() => loadEnv({ ...BASE_ENV, ALLOWED_CURRENCIES: 'USD,EUR' })).not.toThrow();
  });

  it('rejects known placeholder JWT_SECRETs', () => {
    expect(() => loadEnv({ ...BASE_ENV, JWT_SECRET: 'change-me-1234567890abcdef' })).toThrow();
    expect(() =>
      loadEnv({ ...BASE_ENV, JWT_SECRET: 'dev-jwt-secret-1234567890abcdef' }),
    ).toThrow();
    expect(() =>
      loadEnv({ ...BASE_ENV, JWT_SECRET: 'a-solid-random-secret-1234567890abc' }),
    ).not.toThrow();
  });

  it('validates the payout-provider status override map', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        WAITLAYER_PAYOUT_PROVIDER_STATUS: JSON.stringify({
          wise: 'available',
          paypal_email: 'coming_soon',
        }),
      }),
    ).not.toThrow();
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        WAITLAYER_PAYOUT_PROVIDER_STATUS: JSON.stringify({
          unknown_provider: 'available',
        }),
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        WAITLAYER_PAYOUT_PROVIDER_STATUS: 'not-json',
      }),
    ).toThrow();
  });

  it('requires production policy inputs', () => {
    const prod = { ...BASE_ENV, NODE_ENV: 'production' };
    expect(() => loadEnv(prod)).toThrow('Invalid environment configuration');

    const minimal = loadEnv(fullProductionEnv());
    expect(minimal.NODE_ENV).toBe('production');
  });

  it('rejects the reference wait-attestation stub bridge in production', () => {
    expect(() => loadEnv(fullProductionEnv())).not.toThrow();
    expect(() =>
      loadEnv({
        ...fullProductionEnv(),
        WAIT_ATTESTATION_ISSUERS: JSON.stringify([
          {
            provider: 'waitlayer-stub-bridge',
            issuer: 'https://stub.example.com',
            audience: 'waitlayer-client',
            publicKeys: { k1: samplePublicKey() },
          },
        ]),
      }),
    ).toThrow('Invalid environment configuration');
    expect(() =>
      loadEnv({ ...fullProductionEnv(), VERIFIED_WAIT_ATTESTATION_VERSIONS: 'stub-v1' }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts a real attestation issuer outside production', () => {
    const env = loadEnv({
      ...BASE_ENV,
      WAIT_ATTESTATION_ISSUERS: JSON.stringify([
        {
          provider: 'independent-attester',
          issuer: 'https://attest.example.com',
          audience: 'waitlayer-client',
          publicKeys: { k1: samplePublicKey() },
        },
      ]),
    });
    expect(env.WAIT_ATTESTATION_ISSUERS).toContain('independent-attester');
  });

  it('exposes the schema type for consumers', () => {
    expect(envSchema).toBeDefined();
    const parsed = envSchema.safeParse(BASE_ENV);
    expect(parsed.success).toBe(true);
  });
});

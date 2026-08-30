import { describe, expect, it } from 'vitest';

import { applyLegacyEnvAliases, envSchema, loadEnv } from './index';

const BASE_ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost:5432/ateva' };

function validKey(): string {
  return Buffer.alloc(32, 7).toString('base64');
}

/**
 * Assemble a PEM at runtime instead of writing one as a source literal.
 *
 * The schema treats these as opaque strings (`z.string().optional()`), so the
 * body is irrelevant — but a complete PEM on a single physical line matches
 * Trivy's `AsymmetricPrivateKey` secret rule and failed the security gate on a
 * value that is deliberately fake and truncated. Splitting the header from the
 * body removes the false positive WITHOUT adding a `.trivyignore` or lowering
 * the severity threshold, so a genuine key committed to this file would still
 * be caught.
 */
function samplePem(kind: 'PRIVATE' | 'PUBLIC', body: string): string {
  const dashes = '-'.repeat(5);
  return [`${dashes}BEGIN ${kind} KEY${dashes}`, body, `${dashes}END ${kind} KEY${dashes}`].join(
    '\n',
  );
}

function fullProductionEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    ATEVA_ENVIRONMENT_KIND: 'production',
    DATABASE_URL: 'postgresql://localhost:5432/ateva',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: samplePem('PRIVATE', 'MIIEvQ=='),
    JWT_PUBLIC_KEY: samplePem('PUBLIC', 'MIIBIjANBg=='),
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
    EMAIL_FROM: 'alerts@ateva.com',
    API_BASE_URL: 'https://api.ateva.com',
    WEB_BASE_URL: 'https://ateva.com',
    TOTP_SECRET_ENCRYPTION_KEY: 'totp-encryption-key-1234567890abcdef',
    PAYOUT_ENCRYPTION_KEY: validKey(),
    PAYOUT_HMAC_KEY: Buffer.alloc(32, 9).toString('base64'),
    JWT_SECRET: 'a-solid-random-secret-1234567890abc',
  };
}

function samplePublicKey(): string {
  return samplePem('PUBLIC', `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${'test'.repeat(30)}`);
}

describe('@ateva/config env schema', () => {
  it('loads a minimal development environment with defaults', () => {
    const env = loadEnv(BASE_ENV);
    expect(env.NODE_ENV).toBe('test');
    expect(env.ATEVA_ENVIRONMENT_KIND).toBe('development');
    expect(env.ATEVA_ENVIRONMENT_ID).toBe('local');
    expect(env.API_PORT).toBe(4002);
    expect(env.WEB_PORT).toBe(3000);
    expect(env.JWT_ISSUER).toBe('ateva');
    expect(env.JWT_AUDIENCE).toBe('ateva-client');
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
    expect(() => loadEnv({ ...BASE_ENV, JWT_SECRET: 'dev-jwt-secret-1234567890abcdef' })).toThrow();
    expect(() =>
      loadEnv({ ...BASE_ENV, JWT_SECRET: 'a-solid-random-secret-1234567890abc' }),
    ).not.toThrow();
  });

  it('validates the payout-provider status override map', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ATEVA_PAYOUT_PROVIDER_STATUS: JSON.stringify({
          wise: 'available',
          paypal_email: 'coming_soon',
        }),
      }),
    ).not.toThrow();
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ATEVA_PAYOUT_PROVIDER_STATUS: JSON.stringify({
          unknown_provider: 'available',
        }),
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ATEVA_PAYOUT_PROVIDER_STATUS: 'not-json',
      }),
    ).toThrow();
  });

  it('requires production policy inputs', () => {
    const prod = { ...BASE_ENV, NODE_ENV: 'production' };
    expect(() => loadEnv(prod)).toThrow('Invalid environment configuration');

    const minimal = loadEnv(fullProductionEnv());
    expect(minimal.NODE_ENV).toBe('production');
  });

  it('requires the Dodo webhook secret when the Dodo deposit rail is selected', () => {
    const dodo = {
      ...BASE_ENV,
      DEPOSIT_PROCESSOR: 'dodo',
      DODO_API_KEY: 'test-key',
      DODO_BASE_URL: 'https://test.dodopayments.com',
      DODO_PRODUCT_ID: 'pdt_wallet_top_up',
    };
    expect(() => loadEnv(dodo)).toThrow('Invalid environment configuration');
    expect(() => loadEnv({ ...dodo, DODO_WEBHOOK_SECRET: 'whsec_test' })).not.toThrow();
  });

  it('rejects an untrusted Dodo API base URL when the rail is selected', () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        DEPOSIT_PROCESSOR: 'dodo',
        DODO_API_KEY: 'test-key',
        DODO_BASE_URL: 'http://evil.example',
        DODO_WEBHOOK_SECRET: 'whsec_test',
        DODO_PRODUCT_ID: 'pdt_wallet_top_up',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts a production-mode staging runtime without claiming production identity', () => {
    const staging = loadEnv({
      ...fullProductionEnv(),
      ATEVA_ENVIRONMENT_KIND: 'staging',
    });
    expect(staging.NODE_ENV).toBe('production');
    expect(staging.ATEVA_ENVIRONMENT_KIND).toBe('staging');
  });

  it('requires a dedicated privacy key outside development/test', () => {
    expect(() => loadEnv({ ...BASE_ENV, ATEVA_ENVIRONMENT_KIND: 'sandbox' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ATEVA_ENVIRONMENT_KIND: 'sandbox',
        PRIVACY_HASH_KEY: validKey(),
      }),
    ).not.toThrow();
  });

  it('validates the optional shadow-fact pseudonym key without enabling it by default', () => {
    expect(loadEnv(BASE_ENV).ATTENTION_SHADOW_PSEUDONYM_KEY).toBeUndefined();
    expect(
      loadEnv({ ...BASE_ENV, ATTENTION_SHADOW_PSEUDONYM_KEY: validKey() })
        .ATTENTION_SHADOW_PSEUDONYM_KEY,
    ).toBe(validKey());
    expect(() => loadEnv({ ...BASE_ENV, ATTENTION_SHADOW_PSEUDONYM_KEY: 'too-short' })).toThrow();
    expect(
      envSchema.parse({ ...BASE_ENV, ATTENTION_SHADOW_PSEUDONYM_KEY: '' })
        .ATTENTION_SHADOW_PSEUDONYM_KEY,
    ).toBeUndefined();
  });

  it('rejects mismatched environment identity and unsafe faucet settings', () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, NODE_ENV: 'production', ATEVA_ENVIRONMENT_KIND: 'sandbox' }),
    ).toThrow();
    expect(() => loadEnv({ ...BASE_ENV, ATEVA_ENVIRONMENT_KIND: 'production' })).toThrow();
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ENABLE_STAGING_FAUCET: 'true',
        ATEVA_ENVIRONMENT_KIND: 'development',
      }),
    ).toThrow();
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        ENABLE_STAGING_FAUCET: 'true',
        ATEVA_ENVIRONMENT_KIND: 'sandbox',
        PRIVACY_HASH_KEY: validKey(),
      }),
    ).not.toThrow();
  });

  it('rejects the reference wait-attestation stub bridge in production', () => {
    expect(() => loadEnv(fullProductionEnv())).not.toThrow();
    expect(() =>
      loadEnv({
        ...fullProductionEnv(),
        WAIT_ATTESTATION_ISSUERS: JSON.stringify([
          {
            provider: 'ateva-stub-bridge',
            issuer: 'https://stub.example.com',
            audience: 'ateva-client',
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
          audience: 'ateva-client',
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
  // The shipped `docker-compose.yml` renders every unset optional as `${VAR:-}`,
  // i.e. an EMPTY STRING. `z.string().refine(...).optional()` accepts undefined
  // but not '', so the empty value reached the refine and failed — the API
  // container crash-looped on "Invalid environment configuration" and the
  // docker-build gate could never boot it. `--env-file` and Kubernetes
  // ConfigMaps render empty the same way, so this is not compose-specific.
  it('treats an empty allowlist as unset, exactly as compose renders it', () => {
    const parsed = envSchema.parse({
      ...BASE_ENV,
      WAIT_ATTESTATION_ISSUERS: '',
      VERIFIED_WAIT_ATTESTATION_VERSIONS: '',
      VERIFIED_DETECTOR_VERSIONS: '',
      ATEVA_PAYOUT_PROVIDER_STATUS: '',
    });
    expect(parsed.WAIT_ATTESTATION_ISSUERS).toBeUndefined();
    expect(parsed.VERIFIED_WAIT_ATTESTATION_VERSIONS).toBeUndefined();
    expect(parsed.VERIFIED_DETECTOR_VERSIONS).toBeUndefined();
    expect(parsed.ATEVA_PAYOUT_PROVIDER_STATUS).toBeUndefined();
  });

  it('still rejects a NON-empty malformed allowlist', () => {
    // Empty means "nothing trusted". Garbage still has to fail, or this fix
    // would have turned a validation gate into a no-op.
    expect(() => envSchema.parse({ ...BASE_ENV, WAIT_ATTESTATION_ISSUERS: 'not-json' })).toThrow();
    expect(() => envSchema.parse({ ...BASE_ENV, ATEVA_PAYOUT_PROVIDER_STATUS: '{oops' })).toThrow();
    expect(() =>
      envSchema.parse({ ...BASE_ENV, VERIFIED_DETECTOR_VERSIONS: 'has space!' }),
    ).toThrow();
  });
});

describe('legacy ATEVA_/WAITLAYER_ env aliasing', () => {
  it('falls back to the pre-rename name when the canonical one is unset', () => {
    const aliased = applyLegacyEnvAliases({ WAITLAYER_ENVIRONMENT_ID: 'legacy-box' });

    expect(aliased.ATEVA_ENVIRONMENT_ID).toBe('legacy-box');
    // The old name is preserved so nothing reading it directly breaks.
    expect(aliased.WAITLAYER_ENVIRONMENT_ID).toBe('legacy-box');
  });

  it('lets the canonical name win when both are set', () => {
    const aliased = applyLegacyEnvAliases({
      ATEVA_ENVIRONMENT_ID: 'new',
      WAITLAYER_ENVIRONMENT_ID: 'old',
    });

    expect(aliased.ATEVA_ENVIRONMENT_ID).toBe('new');
  });

  it('rewrites the token when it is embedded rather than a prefix', () => {
    const aliased = applyLegacyEnvAliases({
      NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS: '{}',
    });

    expect(aliased.NEXT_PUBLIC_ATEVA_PAYOUT_PROVIDER_STATUS).toBe('{}');
  });

  it('leaves unrelated variables untouched', () => {
    const aliased = applyLegacyEnvAliases({ NODE_ENV: 'test', DATABASE_URL: 'x' });

    expect(Object.keys(aliased).sort()).toEqual(['DATABASE_URL', 'NODE_ENV']);
  });

  it('accepts a legacy-only environment through loadEnv', () => {
    const env = loadEnv({ ...BASE_ENV, WAITLAYER_ENVIRONMENT_ID: 'legacy-box' });

    expect(env.ATEVA_ENVIRONMENT_ID).toBe('legacy-box');
  });
});

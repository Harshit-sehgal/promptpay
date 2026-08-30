import { z } from 'zod';

import { ENVIRONMENT_KINDS } from './environment';

// Mirrors the full `PAYOUT_PROVIDERS` catalogue from packages/shared so an
// operator copying the .env.example override map never trips config
// validation. Stub-only providers (payoneer/razorpay/dodo_payments) are still
// rejected at registration regardless of any override, so accepting them here
// is harmless — it only prevents an inconsistent boot-time rejection.
const PAYOUT_PROVIDERS = new Set([
  'paypal_email',
  'manual',
  'paypal_payouts',
  'stripe_connect',
  'wise',
  'payoneer',
  'razorpay',
  'dodo_payments',
]);

function validProviderStatusJson(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return Object.entries(parsed).every(
      ([provider, status]) =>
        PAYOUT_PROVIDERS.has(provider) && (status === 'available' || status === 'coming_soon'),
    );
  } catch {
    return false;
  }
}

function validVersionAllowlist(value: string): boolean {
  if (value.trim() === '') return true;
  return value.split(',').every((v) => /^[A-Za-z0-9._-]+$/.test(v.trim()) && v.trim().length > 0);
}

function validCodeAllowlist(value: string, pattern: RegExp): boolean {
  if (value.trim() === '') return true;
  const entries = value.split(',').map((entry) => entry.trim());
  return entries.length > 0 && entries.every((entry) => pattern.test(entry));
}

function isCanonical256BitBase64(value: string | undefined): boolean {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function isKnownDevelopmentKey(value: string): boolean {
  return new Set([
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  ]).has(value);
}

/** Validate only the shape of externally supplied attestation issuers. The
 * public keys themselves are validated by RS256 verification at use time. */
function validWaitAttestationIssuers(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const providers = new Set<string>();
    return parsed.every((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const candidate = entry as Record<string, unknown>;
      const hasValidShape =
        typeof candidate.provider === 'string' &&
        /^[A-Za-z0-9._-]{1,64}$/.test(candidate.provider) &&
        typeof candidate.issuer === 'string' &&
        /^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(candidate.issuer) &&
        typeof candidate.audience === 'string' &&
        candidate.audience.length >= 1 &&
        candidate.audience.length <= 256 &&
        !!candidate.publicKeys &&
        typeof candidate.publicKeys === 'object' &&
        !Array.isArray(candidate.publicKeys) &&
        Object.keys(candidate.publicKeys as Record<string, unknown>).length > 0 &&
        Object.entries(candidate.publicKeys as Record<string, unknown>).every(
          ([kid, pem]) =>
            /^[A-Za-z0-9._-]{1,128}$/.test(kid) &&
            typeof pem === 'string' &&
            pem.length > 64 &&
            pem.replace(/\\n/g, '\n').includes('-----BEGIN PUBLIC KEY-----') &&
            pem.replace(/\\n/g, '\n').includes('-----END PUBLIC KEY-----'),
        );
      if (!hasValidShape) {
        return false;
      }
      const provider = candidate.provider as string;
      if (providers.has(provider)) return false;
      providers.add(provider);
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * The repository includes a deliberately non-independent bridge for local and
 * staging development. Its identity is part of the public sample
 * configuration, so reject it by name rather than relying on an operator to
 * remember that it must never be promoted to a real-money deployment.
 */
function containsReferenceWaitAttestationStub(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const issuers: unknown = JSON.parse(value);
    return (
      Array.isArray(issuers) &&
      issuers.some(
        (issuer) =>
          !!issuer &&
          typeof issuer === 'object' &&
          (issuer as { provider?: unknown }).provider === 'ateva-stub-bridge',
      )
    );
  } catch {
    // Shape validation reports malformed JSON separately.
    return false;
  }
}

function containsReferenceWaitAttestationVersion(value: string | undefined): boolean {
  return (value ?? '')
    .split(',')
    .map((version) => version.trim())
    .includes('stub-v1');
}

const DODO_API_HOSTS = new Set(['test.dodopayments.com', 'live.dodopayments.com']);

function isValidDodoBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '' || url.pathname === '/') &&
      DODO_API_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isProductionOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.pathname.replace(/\/+$/, '') &&
      !url.search &&
      !url.hash &&
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Treat an EMPTY environment variable as "not configured".
 *
 * `z.string().refine(...).optional()` accepts `undefined` but NOT `''` — an
 * empty string is defined, so it reaches the refine and fails. Every real
 * deployment mechanism supplies empty rather than absent: `docker-compose.yml`
 * uses `${VAR:-}`, `--env-file` keeps blank keys, and Kubernetes ConfigMaps
 * render empty values. The shipped compose file therefore could not boot the
 * API at all — it crash-looped on
 * `WAIT_ATTESTATION_ISSUERS: must be a valid wait-attestation issuer array`.
 *
 * This does NOT weaken anything: for these allowlists, empty and unset mean the
 * same thing — nothing is trusted. Fail-closed behaviour is unchanged, and the
 * runtime settlement gate independently blocks earnings without a real issuer.
 */
const optionalAllowlist = (validate: (value: string) => boolean, message: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().refine(validate, message).optional(),
  );

const optionalSecret = (minimumLength: number, maximumLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(minimumLength).max(maximumLength).optional(),
  );

const envSchema = z
  .object({
    // General
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // Product/deployment identity. This is deliberately separate from
    // NODE_ENV: a sandbox may run a production-shaped build, while production
    // must never boot with sandbox facilities enabled.
    ATEVA_ENVIRONMENT_KIND: z.enum(ENVIRONMENT_KINDS).default('development'),
    ATEVA_ENVIRONMENT_ID: z.string().min(1).max(128).default('local'),
    // Operator-only bearer for resetting one isolated sandbox environment.
    // It is intentionally optional at boot; the reset endpoint fails closed
    // until an operator explicitly configures it in a test/sandbox deployment.
    SANDBOX_RESET_TOKEN: z.string().min(32).max(256).optional(),
    ENABLE_STAGING_FAUCET: z.enum(['true', 'false']).default('false'),

    // Database
    DATABASE_URL: z.string(),
    DIRECT_URL: z.string().optional(),

    // Redis
    REDIS_URL: z.string().optional(),
    // Bounded socket connect timeout for the runtime-config Redis pub/sub
    // clients. Fail fast (instead of retrying forever) when Redis is
    // unreachable so API boot never hangs; the 30s config cache TTL remains
    // the resilience fallback.
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(2000),

    // API
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4002),
    API_BASE_URL: z.string().default('http://localhost:4002'),

    // Web
    WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    WEB_BASE_URL: z.string().default('http://localhost:3000'),

    // Reverse-proxy trust hops. Behind an LB/ingress, `req.ip` resolves to the
    // proxy unless Express is told how many hops to trust. This powers
    // per-IP brute-force tracking and rate limiting, so a wrong value either
    // (a) keys abuse controls off the proxy IP (trivially bypassable) or
    // (b) over-trusts client-supplied X-Forwarded-For (IP spoofing). Must be a
    // non-negative integer; 0 is valid for direct exposure, default 1.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(1),
    // Keep the web BFF proxy chain in the shared production configuration so
    // client-IP derivation cannot silently diverge between web and API.
    BFF_TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(3).optional(),

    // Rate-limit buckets (requests per TTL). These are operator overrides for
    // the defaults in `apps/api/src/app.module.ts`; production should keep the
    // tight defaults and only raise them for controlled test/CI environments
    // (e.g. an isolated e2e API that must complete many auth calls quickly).
    // A raised limit must never be deployed to a public production API.
    THROTTLE_AUTH_SHORT_LIMIT: z.coerce.number().int().min(1).optional(),
    THROTTLE_AUTH_LONG_LIMIT: z.coerce.number().int().min(1).optional(),
    THROTTLE_EXTENSION_LIMIT: z.coerce.number().int().min(1).optional(),
    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).optional(),

    // Paid-launch policy. These are intentionally explicit deployment inputs:
    // an empty list is useful for telemetry-only development, but production
    // must choose its launch jurisdictions and settlement currency instead of
    // inheriting an open-ended negative blocklist.
    ALLOWED_COUNTRIES: z
      .string()
      .default('')
      .refine((value) => validCodeAllowlist(value, /^[A-Za-z]{2}$/), {
        message: 'ALLOWED_COUNTRIES must be a comma-separated ISO alpha-2 allowlist',
      }),
    ALLOWED_CURRENCIES: z
      .string()
      .default('')
      .refine((value) => validCodeAllowlist(value, /^[A-Za-z]{3}$/), {
        message: 'ALLOWED_CURRENCIES must be a comma-separated ISO 4217 allowlist',
      }),

    // Auth
    // NOTE: min(32) catches length, but a 32-char placeholder (e.g.
    // "change-me-in-production-32chars-ok") passes zod and is forgeable in
    // any deployment that ships it. The refine() below rejects the small
    // set of known public placeholders so they cannot reach production.
    //
    // JWT_PRIVATE_KEY / JWT_PUBLIC_KEY: RS256 key pair for access/refresh
    // tokens. The private key lives ONLY in the API; the public key is shared
    // with the web middleware so it can verify httpOnly cookies at the Edge.
    // JWT_SECRET: symmetric secret used for refresh-token HMAC integrity and
    // BFF rate-limit identity signing. It is NOT used for JWT signing.
    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    // JWT_PUBLIC_KEYS: optional newline-separated list of *additional* (or the
    // full set of) accepted RS256 public keys for zero-downtime key rotation.
    // Tokens carry a `kid` header; verification selects the matching key from
    // this set (plus JWT_PUBLIC_KEY). During rotation, set JWT_PRIVATE_KEY/
    // JWT_PUBLIC_KEY to the new pair and list the previous public key here so
    // pre-rotation access and refresh tokens keep verifying until the longest
    // token lifetime has elapsed (JWT_REFRESH_TTL by default).
    JWT_PUBLIC_KEYS: z.string().optional(),
    // Standard JWT issuer/audience. Defaults keep dev/test simple while
    // allowing production to pin tokens to a concrete deployment.
    JWT_ISSUER: z.string().default('ateva'),
    JWT_AUDIENCE: z.string().default('ateva-client'),
    JWT_SECRET: z
      .string()
      .min(32)
      .refine(
        (s) =>
          !s.includes('change-me') &&
          !s.includes('replace-with') &&
          !s.startsWith('dev-jwt-secret'),
        { message: 'JWT_SECRET must not be a known placeholder' },
      )
      .optional(),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    // App-level encryption key for server-stored TOTP secrets. Required in
    // production so a database-only leak does not expose reusable MFA seeds.
    TOTP_SECRET_ENCRYPTION_KEY: z.string().optional(),
    // App-level encryption key for queued email payloads. Required in production
    // so a database-only leak does not expose password-reset/email-verify tokens.
    EMAIL_QUEUE_SECRET: z.string().min(32).optional(),
    // Extension events use per-device eventSecret values issued at device
    // registration. There is intentionally no shared global extension HMAC.

    // Wait-detector source allowlist. Comma-separated list of detector
    // versions that the platform treats as verified. Empty/missing means all
    // sources are unverified (fail-closed). Example: "1.0.0,1.1.0".
    VERIFIED_DETECTOR_VERSIONS: optionalAllowlist(
      validVersionAllowlist,
      'must be a comma-separated list of version tokens (a-z,0-9,.,_,-)',
    ),

    // JSON array of independently operated wait-attestation issuers. Each
    // entry is { provider, issuer, audience, publicKeys: { kid: PEM } }.
    // This remains optional while wait.earnings is disabled; enabling real
    // money without it is blocked independently by the runtime settlement gate.
    WAIT_ATTESTATION_ISSUERS: optionalAllowlist(
      validWaitAttestationIssuers,
      'must be a valid wait-attestation issuer array',
    ),

    // Versions emitted by the separately operated attestation provider. This
    // is intentionally distinct from client detector versions: promoting a
    // packaged detector build must not implicitly trust an attester build.
    VERIFIED_WAIT_ATTESTATION_VERSIONS: optionalAllowlist(
      validVersionAllowlist,
      'must be a comma-separated allowlist of wait-attestation versions',
    ),

    // Stripe (advertiser deposits — INACTIVE at launch, decision D2)
    STRIPE_PUBLIC_KEY: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    // Observed env var name in the Stripe provider / web checkout is
    // STRIPE_PUBLISHABLE_KEY. Accept both spellings so either variable can be
    // present without an Invalid env failure.
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),

    // Dodo Payments (advertiser deposits — launch money-in rail, decision D1).
    // Dodo is a Merchant of Record and supports money-IN (checkout) only; it
    // has no third-party payout API (developer payouts run on platform rails).
    DODO_API_KEY: z.string().optional(),
    DODO_BASE_URL: z.string().optional(),
    DODO_WEBHOOK_SECRET: z.string().optional(),
    // Checkout is product-based; the operator creates a "wallet top-up"
    // product (pay-what-you-want) in the Dodo dashboard and supplies its id.
    DODO_PRODUCT_ID: z.string().optional(),

    // Money-in processor selection. Unset means no deposit rail is configured
    // and the deposit-session endpoint fails closed with a clean 400 (W1.1).
    DEPOSIT_PROCESSOR: z.enum(['stripe', 'dodo']).optional(),

    // Google OAuth (extension + web sign-in)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_AUTH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(5_000),
    // Mock Google is off by default. The verifier accepts either the current
    // MOCK_GOOGLE_ENABLED=1 flag or the legacy ALLOW_MOCK_GOOGLE=true alias,
    // and still requires NODE_ENV !== 'production'.
    MOCK_GOOGLE_ENABLED: z.string().optional(),
    ALLOW_MOCK_GOOGLE: z.string().optional(),

    // Email
    EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
    EMAIL_FROM: z.email().default('noreply@ateva.local'),
    // Operator alert recipient for system-generated security/financial alerts
    // (money-integrity drift, payout-account freeze, etc.). If unset, alerts
    // are only logged (dev); production must set this to a monitored mailbox.
    OPS_ALERT_EMAIL: z.email().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),

    // Keyed pseudonymization for IP addresses and other low-entropy values.
    // A plain SHA-256 hash is reversible by enumerating the IPv4 space.
    PRIVACY_HASH_KEY: z.string().min(32).optional(),
    // Keyed pseudonymization for privacy-safe adaptive-attention shadow facts.
    // Optional because the materializer is opt-in; an empty value means the
    // job remains disabled. The key never belongs in a client or build arg.
    ATTENTION_SHADOW_PSEUDONYM_KEY: optionalSecret(32, 256),

    // Sentry (error monitoring)
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),

    // Payout security: when 'true', requesting a payout requires the account to
    // have MFA (TOTP) enrolled. Off by default so existing developer flows are
    // unaffected until 2FA adoption is broad enough.
    PAYOUT_REQUIRE_2FA: z.enum(['true', 'false']).default('false'),
    // Payout security: anti-account-takeover control. When > 0, a payout sent to
    // a destination that was added/changed within this many hours requires the
    // account to have MFA enrolled. This blocks an attacker who gains a session
    // from silently repointing payouts to a fresh destination. Off (0) by
    // default so existing developer flows are unaffected until enabled.
    PAYOUT_DESTINATION_COOLDOWN_HOURS: z.coerce.number().int().min(0).max(720).default(0),
    // Earnings hold periods (days) per trust tier — DODO_PAYMENTS_PLAN §8.11.
    // Defaults match `PAYOUT_HOLD_DAYS` in @ateva/shared; an operator may
    // lengthen them (e.g. to cover Dodo's settlement cycle) without a code
    // change. The `RESTRICTED`/`BANNED` -1 ("indefinite") contract is NOT
    // overridable — these keys only admit positive integers.
    PAYOUT_HOLD_DAYS_NEW_ACCOUNT: z.coerce.number().int().min(1).max(365).default(30),
    PAYOUT_HOLD_DAYS_NORMAL: z.coerce.number().int().min(1).max(365).default(14),
    PAYOUT_HOLD_DAYS_HIGH_TRUST: z.coerce.number().int().min(1).max(365).default(7),
    // Hold applied to earnings from unverified detector sources (see
    // ledger-math getHoldDays); floored to the base tier, so a value below the
    // trust tier's hold is a no-op by design.
    PAYOUT_HOLD_DAYS_EXTENDED: z.coerce.number().int().min(1).max(365).default(60),
    // AES-256-GCM encryption key for payout destinations stored at rest.
    // Expected as a base64-encoded 32-byte (256-bit) key. Required in production
    // so a database-only leak does not expose raw payout destinations.
    PAYOUT_ENCRYPTION_KEY: z.string().optional(),
    // P0.6: Separate HMAC key for payout destination duplicate/fraud matching.
    // Independent of PAYOUT_ENCRYPTION_KEY so a compromise of one key does not
    // reveal the other's output. Same format: base64-encoded 32-byte key.
    // Required in production.
    PAYOUT_HMAC_KEY: z.string().optional(),
    ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    // A-030: server-side mirror of the web's NEXT_PUBLIC_ATEVA_PAYOUT_
    // PROVIDER_STATUS gate. JSON map provider -> 'available' | 'coming_soon'.
    // Operators set this on the API so registration rejects gated providers.
    ATEVA_PAYOUT_PROVIDER_STATUS: optionalAllowlist(
      validProviderStatusJson,
      'must be a valid known-provider status JSON map',
    ),

    // PayPal (payouts — later)
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

    // Wise (payouts — dev stub, real API in production when configured)
    WISE_API_TOKEN: z.string().optional(),
    // WISE_PROFILE_ID selects the Wise business profile that holds the balance
    // used to fund developer payouts. Required for live transfers.
    WISE_PROFILE_ID: z.string().optional(),
    WISE_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
    // Fail closed until the operator has verified the account-specific email
    // recipient corridor in Wise sandbox/live.
    WISE_EMAIL_RECIPIENTS_VERIFIED: z.enum(['true', 'false']).default('false'),

    // ── Feature / behaviour toggles ──

    // Launch incentive split: when 'true', impression/click earnings use the
    // 80/10/10 (developer/platform/reserve) split instead of the standard
    // 60/30/10. Off by default so operators opt in explicitly. Read by
    // LedgerService via process.env (validated here at boot).
    LAUNCH_SPLIT_ENABLED: z.enum(['true', 'false']).default('false'),

    // Webhook processing mode. When 'true', Stripe webhook events are
    // acknowledged (HTTP 200) and processed off the request thread via the
    // in-process event bus. When 'false' (default), processing stays inline so
    // behaviour is unchanged and integration tests remain synchronous.
    // Legacy switch retained only to reject stale deploy manifests. Webhooks
    // are processed synchronously; `true` would otherwise be a silent no-op.
    WEBHOOK_ASYNC_PROCESSING: z.literal('false').optional(),
    SWAGGER_ENABLED: z.enum(['true', 'false']).default('false'),

    // ── Cron intervals (ms) ──
    // All crons fall back to safe defaults; operators can override per deploy.
    PAYOUT_POLL_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(600_000),
    PAYOUT_POLL_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    RETENTION_CRON_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(3_600_000)
      .max(604_800_000)
      .default(86_400_000),
    LEDGER_MATURATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(600_000),
    LEDGER_MATURATION_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(500),
    LEDGER_MATURATION_RUN_CAP: z.coerce.number().int().min(1).max(20_000).default(5_000),
    WEBHOOK_RECLAIM_CRON: z.enum(['true', 'false']).optional(),
    WEBHOOK_RECLAIM_CRON_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(300_000),
    WEBHOOK_RECLAIM_CRON_AGE_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(2_592_000_000)
      .default(2_100_000),
    WEBHOOK_RECLAIM_CRON_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),

    // Per-call timeout (ms) for external PSP provider calls (initiate / status
    // checks). Protects cron loops and payout processing from hanging on an
    // unresponsive provider.
    PROVIDER_CALL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  })
  .refine(
    (env) => {
      // Staging must run the same optimized/security-sensitive Node mode as
      // production so its release evidence exercises fail-closed rate limits,
      // MFA guards, key handling, email/provider checks, and disabled mocks.
      // Product identity remains separate: only the real production database
      // may declare ATEVA_ENVIRONMENT_KIND=production.
      if (
        env.NODE_ENV === 'production' &&
        !['staging', 'production'].includes(env.ATEVA_ENVIRONMENT_KIND)
      ) {
        return false;
      }
      if (env.ATEVA_ENVIRONMENT_KIND === 'production' && env.NODE_ENV !== 'production') {
        return false;
      }
      return true;
    },
    {
      message:
        'NODE_ENV=production requires a staging or production environment kind, and production environment kind requires NODE_ENV=production.',
      path: ['ATEVA_ENVIRONMENT_KIND'],
    },
  )
  .refine(
    (env) => {
      if (
        env.ENABLE_STAGING_FAUCET === 'true' &&
        !['test', 'sandbox', 'staging'].includes(env.ATEVA_ENVIRONMENT_KIND)
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'ENABLE_STAGING_FAUCET is allowed only in test, sandbox, or staging environments.',
      path: ['ENABLE_STAGING_FAUCET'],
    },
  )
  .refine(
    (env) => {
      if (env.ATEVA_ENVIRONMENT_KIND === 'sandbox' && env.NODE_ENV === 'production') return false;
      return true;
    },
    {
      message: 'A sandbox environment cannot boot as NODE_ENV=production.',
      path: ['ATEVA_ENVIRONMENT_KIND'],
    },
  )
  .refine(
    (env) => {
      if (env.NODE_ENV === 'production' && !env.REDIS_URL) return false;
      return true;
    },
    {
      message:
        'REDIS_URL is required in production for distributed rate limiting and brute-force tracking',
      path: ['REDIS_URL'],
    },
  )
  .refine(
    (env) => {
      if (env.NODE_ENV !== 'production') return true;
      return Boolean(env.JWT_PRIVATE_KEY) && Boolean(env.JWT_PUBLIC_KEY) && Boolean(env.JWT_SECRET);
    },
    {
      message:
        'JWT_PRIVATE_KEY, JWT_PUBLIC_KEY and JWT_SECRET are required in production. JWT_SECRET is used for refresh-token HMAC and BFF identity signing.',
      path: ['JWT_PRIVATE_KEY'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYOUT_REQUIRE_2FA === 'true', {
    message: 'PAYOUT_REQUIRE_2FA=true is required in production.',
    path: ['PAYOUT_REQUIRE_2FA'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.BFF_TRUST_PROXY_HOPS), {
    message: 'BFF_TRUST_PROXY_HOPS is required in production for consistent client-IP derivation.',
    path: ['BFF_TRUST_PROXY_HOPS'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ALLOWED_COUNTRIES.trim() !== '', {
    message: 'ALLOWED_COUNTRIES is required in production for explicit launch geography.',
    path: ['ALLOWED_COUNTRIES'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ALLOWED_CURRENCIES.trim() !== '', {
    message: 'ALLOWED_CURRENCIES is required in production for explicit settlement policy.',
    path: ['ALLOWED_CURRENCIES'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYOUT_DESTINATION_COOLDOWN_HOURS >= 24, {
    message: 'PAYOUT_DESTINATION_COOLDOWN_HOURS must be at least 24 hours in production.',
    path: ['PAYOUT_DESTINATION_COOLDOWN_HOURS'],
  })
  .refine(
    (env) =>
      !['sandbox', 'staging', 'production'].includes(env.ATEVA_ENVIRONMENT_KIND) ||
      Boolean(env.PRIVACY_HASH_KEY),
    {
      message:
        'PRIVACY_HASH_KEY is required in sandbox, staging, and production and must be at least 32 characters.',
      path: ['PRIVACY_HASH_KEY'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.EMAIL_QUEUE_SECRET), {
    message: 'EMAIL_QUEUE_SECRET is required in production and must be at least 32 characters.',
    path: ['EMAIL_QUEUE_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.OPS_ALERT_EMAIL), {
    message: 'OPS_ALERT_EMAIL is required in production for financial and security alerts.',
    path: ['OPS_ALERT_EMAIL'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (!containsReferenceWaitAttestationStub(env.WAIT_ATTESTATION_ISSUERS) &&
        !containsReferenceWaitAttestationVersion(env.VERIFIED_WAIT_ATTESTATION_VERSIONS)),
    {
      message:
        'The reference ateva-stub-bridge / stub-v1 attester is local/staging-only and is forbidden in production.',
      path: ['WAIT_ATTESTATION_ISSUERS'],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.EMAIL_DRIVER === 'resend' &&
        Boolean(env.RESEND_API_KEY) &&
        !env.EMAIL_FROM.toLowerCase().includes('ateva.local') &&
        !env.EMAIL_FROM.toLowerCase().includes('no-reply@ateva.dev')),
    {
      message: 'Production email requires resend credentials and a non-development sender.',
      path: ['EMAIL_DRIVER'],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (isProductionOrigin(env.API_BASE_URL) && isProductionOrigin(env.WEB_BASE_URL)),
    {
      message: 'API_BASE_URL and WEB_BASE_URL must be credential-free HTTPS origins in production.',
      path: ['WEB_BASE_URL'],
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.WEBHOOK_RECLAIM_CRON !== 'false', {
    message: 'WEBHOOK_RECLAIM_CRON cannot be explicitly disabled in production.',
    path: ['WEBHOOK_RECLAIM_CRON'],
  })
  .refine(
    (env) => {
      if (
        env.NODE_ENV === 'production' &&
        (!env.TOTP_SECRET_ENCRYPTION_KEY || env.TOTP_SECRET_ENCRYPTION_KEY.length < 32)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'TOTP_SECRET_ENCRYPTION_KEY is required in production and must be at least 32 characters.',
      path: ['TOTP_SECRET_ENCRYPTION_KEY'],
    },
  )
  .refine(
    (env) => {
      if (
        env.NODE_ENV === 'production' &&
        (!isCanonical256BitBase64(env.PAYOUT_ENCRYPTION_KEY) ||
          isKnownDevelopmentKey(env.PAYOUT_ENCRYPTION_KEY!))
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'PAYOUT_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key and not a development value in production.',
      path: ['PAYOUT_ENCRYPTION_KEY'],
    },
  )
  .refine(
    (env) => {
      if (
        env.NODE_ENV === 'production' &&
        (!isCanonical256BitBase64(env.PAYOUT_HMAC_KEY) ||
          isKnownDevelopmentKey(env.PAYOUT_HMAC_KEY!))
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'PAYOUT_HMAC_KEY must be a canonical base64-encoded 32-byte key and not a development value in production.',
      path: ['PAYOUT_HMAC_KEY'],
    },
  )
  .refine(
    (env) => env.NODE_ENV !== 'production' || env.PAYOUT_ENCRYPTION_KEY !== env.PAYOUT_HMAC_KEY,
    {
      message: 'PAYOUT_ENCRYPTION_KEY and PAYOUT_HMAC_KEY must be different in production.',
      path: ['PAYOUT_HMAC_KEY'],
    },
  )
  .refine(
    (env) => {
      // If Stripe is enabled (secret key present) the webhook signing secret
      // MUST also be set. An empty STRIPE_WEBHOOK_SECRET with a live secret key
      // causes the Stripe SDK to reject every legitimate webhook's signature
      // — silently breaking deposit/refund/dispute processing. Fail fast at
      // startup rather than at the first webhook. (When Stripe is entirely
      // off, the webhook controller short-circuits with `stripe_not_configured`
      // and never reaches signature verification.)
      if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) return false;
      return true;
    },
    {
      message:
        'STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set — Stripe webhooks cannot be verified without it.',
      path: ['STRIPE_WEBHOOK_SECRET'],
    },
  )
  .refine((env) => env.DEPOSIT_PROCESSOR !== 'dodo' || isValidDodoBaseUrl(env.DODO_BASE_URL), {
    message:
      'DODO_BASE_URL must be https://test.dodopayments.com or https://live.dodopayments.com when DEPOSIT_PROCESSOR=dodo.',
    path: ['DODO_BASE_URL'],
  })
  .refine(
    (env) => {
      // A test Dodo key/base URL must never reach production when the Dodo
      // rail is actually selected. D3 recorded the operator's key is a TEST
      // key on https://test.dodopayments.com; a live key is still pending.
      // Gated on DEPOSIT_PROCESSOR === 'dodo': a stray test base URL in a
      // production env with the rail unselected is inert (the deposit endpoint
      // fails closed), and must not break boot — the same rule as the
      // completeness checks below.
      if (
        env.NODE_ENV === 'production' &&
        env.DEPOSIT_PROCESSOR === 'dodo' &&
        env.DODO_BASE_URL &&
        /test\.dodopayments\.com|dodopayments\.com\/test/i.test(env.DODO_BASE_URL)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'DODO_BASE_URL must be the live endpoint (not the test base URL) when DEPOSIT_PROCESSOR=dodo in production.',
      path: ['DODO_BASE_URL'],
    },
  )
  .refine(
    (env) => {
      // Selecting the Dodo processor requires a complete Dodo configuration,
      // otherwise the endpoint fails closed at runtime with no clear cause.
      // DODO_WEBHOOK_SECRET is included: without it every legitimate webhook
      // signature is rejected, so deposits would credit nothing. (A stray
      // DODO_API_KEY with no processor selected is fine — the deposit endpoint
      // fails closed because DEPOSIT_PROCESSOR is unset.)
      if (env.DEPOSIT_PROCESSOR === 'dodo') {
        if (
          !env.DODO_API_KEY ||
          !env.DODO_BASE_URL ||
          !env.DODO_WEBHOOK_SECRET ||
          !env.DODO_PRODUCT_ID
        ) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'DEPOSIT_PROCESSOR=dodo requires DODO_API_KEY, DODO_BASE_URL, DODO_WEBHOOK_SECRET and DODO_PRODUCT_ID.',
      path: ['DEPOSIT_PROCESSOR'],
    },
  )
  .refine(
    (env) => {
      // In production, CORS is locked to a single concrete `WEB_BASE_URL` origin
      // (credentials: true). A wildcard / '*' origin with credentials is rejected
      // by browsers, and an empty/malformed origin would make `enableCors` fall
      // back to reflecting any Origin — a CSRF/credential-leak vector. Fail fast.
      if (env.NODE_ENV === 'production') {
        const origin = env.WEB_BASE_URL.trim();
        if (!origin || origin === '*' || !/^https?:\/\/[^\s/]+/.test(origin)) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'WEB_BASE_URL must be a concrete http(s) origin (not "*") in production — CORS uses credentials: true.',
      path: ['WEB_BASE_URL'],
    },
  )
  .refine(
    (env) => {
      // Wise live mode requires a token + profile id. sandbox is OK without
      // them (the Wise provider fails closed / stubs in dev).
      if (env.WISE_MODE === 'live' && (!env.WISE_API_TOKEN || !env.WISE_PROFILE_ID)) return false;
      return true;
    },
    {
      message: 'WISE_API_TOKEN and WISE_PROFILE_ID are required when WISE_MODE is "live"',
      path: ['WISE_API_TOKEN'],
    },
  )
  .refine(
    (env) => {
      // PayPal live mode requires credentials. sandbox is OK without them
      // (the PayPal provider stubs/falls-back gracefully in dev).
      if (env.PAYPAL_MODE === 'live' && (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET))
        return false;
      return true;
    },
    {
      message: 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required when PAYPAL_MODE is "live"',
      path: ['PAYPAL_CLIENT_ID'],
    },
  );

/**
 * Legacy environment-variable names from before the Ateva rename.
 *
 * The canonical prefix is now `ATEVA_*`, but deployed environments, CI secrets,
 * operator `.env` files and compose files still carry `ATEVA_*`. This schema
 * deliberately fails closed on a missing variable, so a hard cutover would take
 * every environment down until each secret store was updated in the same moment.
 *
 * Instead, an unset `ATEVA_*` variable falls back to its `ATEVA_*` twin, so
 * secrets can migrate independently of the code. `ATEVA_*` always wins when both
 * are set. Also covers embedded occurrences such as
 * `NEXT_PUBLIC_ATEVA_PAYOUT_*`. Delete this shim once no environment sets
 * the old prefix.
 */
const LEGACY_ENV_TOKEN = 'WAITLAYER_';
const CANONICAL_ENV_TOKEN = 'ATEVA_';

export function applyLegacyEnvAliases(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...source };

  for (const [key, value] of Object.entries(source)) {
    if (!key.includes(LEGACY_ENV_TOKEN) || value === undefined) continue;

    const canonicalKey = key.split(LEGACY_ENV_TOKEN).join(CANONICAL_ENV_TOKEN);
    if (merged[canonicalKey] === undefined) merged[canonicalKey] = value;
  }

  return merged;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(applyLegacyEnvAliases(source));
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return result.data;
}

export type Env = z.infer<typeof envSchema>;

export { envSchema };
export * from './environment';

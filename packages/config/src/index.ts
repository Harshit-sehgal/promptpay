import { z } from 'zod';

const PAYOUT_PROVIDERS = new Set([
  'paypal_email',
  'manual',
  'paypal_payouts',
  'stripe_connect',
  'wise',
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

const envSchema = z
  .object({
    // General
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Database
    DATABASE_URL: z.string(),
    DIRECT_URL: z.string().optional(),

    // Redis
    REDIS_URL: z.string().optional(),

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
    JWT_ISSUER: z.string().default('waitlayer'),
    JWT_AUDIENCE: z.string().default('waitlayer-client'),
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
    VERIFIED_DETECTOR_VERSIONS: z
      .string()
      .refine(
        validVersionAllowlist,
        'must be a comma-separated list of version tokens (a-z,0-9,.,_,-)',
      )
      .optional(),

    // JSON array of independently operated wait-attestation issuers. Each
    // entry is { provider, issuer, audience, publicKeys: { kid: PEM } }.
    // This remains optional while wait.earnings is disabled; enabling real
    // money without it is blocked independently by the runtime settlement gate.
    WAIT_ATTESTATION_ISSUERS: z
      .string()
      .refine(validWaitAttestationIssuers, 'must be a valid wait-attestation issuer array')
      .optional(),

    // Versions emitted by the separately operated attestation provider. This
    // is intentionally distinct from client detector versions: promoting a
    // packaged detector build must not implicitly trust an attester build.
    VERIFIED_WAIT_ATTESTATION_VERSIONS: z
      .string()
      .refine(
        validVersionAllowlist,
        'must be a comma-separated allowlist of wait-attestation versions',
      )
      .optional(),

    // Stripe (advertiser deposits)
    STRIPE_PUBLIC_KEY: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    // Observed env var name in the Stripe provider / web checkout is
    // STRIPE_PUBLISHABLE_KEY. Accept both spellings so either variable can be
    // present without an Invalid env failure.
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),

    // Google OAuth (extension + web sign-in)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_TOKENINFO_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(5_000),
    // Mock Google is off by default. The verifier accepts either the current
    // MOCK_GOOGLE_ENABLED=1 flag or the legacy ALLOW_MOCK_GOOGLE=true alias,
    // and still requires NODE_ENV !== 'production'.
    MOCK_GOOGLE_ENABLED: z.string().optional(),
    ALLOW_MOCK_GOOGLE: z.string().optional(),

    // Email
    EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
    EMAIL_FROM: z.email().default('noreply@waitlayer.local'),
    // Operator alert recipient for system-generated security/financial alerts
    // (money-integrity drift, payout-account freeze, etc.). If unset, alerts
    // are only logged (dev); production must set this to a monitored mailbox.
    OPS_ALERT_EMAIL: z.email().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),

    // Keyed pseudonymization for IP addresses and other low-entropy values.
    // A plain SHA-256 hash is reversible by enumerating the IPv4 space.
    PRIVACY_HASH_KEY: z.string().min(32).optional(),

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
    // A-030: server-side mirror of the web's NEXT_PUBLIC_WAITLAYER_PAYOUT_
    // PROVIDER_STATUS gate. JSON map provider -> 'available' | 'coming_soon'.
    // Operators set this on the API so registration rejects gated providers.
    WAITLAYER_PAYOUT_PROVIDER_STATUS: z
      .string()
      .refine(validProviderStatusJson, 'must be a valid known-provider status JSON map')
      .optional(),

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
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.PRIVACY_HASH_KEY), {
    message: 'PRIVACY_HASH_KEY is required in production and must be at least 32 characters.',
    path: ['PRIVACY_HASH_KEY'],
  })
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
      (env.EMAIL_DRIVER === 'resend' &&
        Boolean(env.RESEND_API_KEY) &&
        !env.EMAIL_FROM.toLowerCase().includes('waitlayer.local') &&
        !env.EMAIL_FROM.toLowerCase().includes('no-reply@waitlayer.dev')),
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
        (!env.PAYOUT_ENCRYPTION_KEY || env.PAYOUT_ENCRYPTION_KEY.length < 32)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'PAYOUT_ENCRYPTION_KEY is required in production and must be at least 32 characters (base64-encoded 256-bit key).',
      path: ['PAYOUT_ENCRYPTION_KEY'],
    },
  )
  .refine(
    (env) => {
      if (
        env.NODE_ENV === 'production' &&
        (!env.PAYOUT_HMAC_KEY || env.PAYOUT_HMAC_KEY.length < 32)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'PAYOUT_HMAC_KEY is required in production and must be at least 32 characters (base64-encoded 256-bit key). This is a separate key from PAYOUT_ENCRYPTION_KEY for HMAC destination matching.',
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

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return result.data;
}

export type Env = z.infer<typeof envSchema>;

export { envSchema };

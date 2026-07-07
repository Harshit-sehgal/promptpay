import { z } from 'zod';

const envSchema = z.object({
  // General
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string(),
  DIRECT_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().optional(),

  // API
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),

  // Web
  WEB_PORT: z.coerce.number().default(3000),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),

  // Reverse-proxy trust hops. Behind an LB/ingress, `req.ip` resolves to the
  // proxy unless Express is told how many hops to trust. This powers
  // per-IP brute-force tracking and rate limiting, so a wrong value either
  // (a) keys abuse controls off the proxy IP (trivially bypassable) or
  // (b) over-trusts client-supplied X-Forwarded-For (IP spoofing). Must be a
  // positive integer; default 1 (single reverse proxy).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(1),

  // Auth
  // NOTE: min(32) catches length, but a 32-char placeholder (e.g.
  // "change-me-in-production-32chars-ok") passes zod and is forgeable in
  // any deployment that ships it. The refine() below rejects the small
  // set of known public placeholders so they cannot reach production.
  JWT_SECRET: z
    .string()
    .min(32)
    .refine(
      (s) =>
        !s.includes('change-me') &&
        !s.includes('replace-with') &&
        !s.startsWith('dev-jwt-secret'),
      { message: 'JWT_SECRET must not be a known placeholder' },
    ),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  // App-level encryption key for server-stored TOTP secrets. Required in
  // production so a database-only leak does not expose reusable MFA seeds.
  TOTP_SECRET_ENCRYPTION_KEY: z.string().optional(),
  // Extension events use per-device eventSecret values issued at device
  // registration. There is intentionally no shared global extension HMAC.

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
  // Mock Google is off by default. The verifier accepts either the current
  // MOCK_GOOGLE_ENABLED=1 flag or the legacy ALLOW_MOCK_GOOGLE=true alias,
  // and still requires NODE_ENV !== 'production'.
  MOCK_GOOGLE_ENABLED: z.string().optional(),
  ALLOW_MOCK_GOOGLE: z.string().optional(),

  // Email
  EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('noreply@waitlayer.local'),
  RESEND_API_KEY: z.string().optional(),

  // Sentry (error monitoring)
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),

  // Payout security: when 'true', requesting a payout requires the account to
  // have MFA (TOTP) enrolled. Off by default so existing developer flows are
  // unaffected until 2FA adoption is broad enough.
  PAYOUT_REQUIRE_2FA: z.string().optional(),

  // PayPal (payouts — later)
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  // Wise (payouts — dev stub, real API in production when configured)
  WISE_API_TOKEN: z.string().optional(),
  WISE_API_VERSION: z.string().default('3.0'),
  // WISE_PROFILE_ID selects the Wise business profile that holds the balance
  // used to fund developer payouts. Required for live transfers.
  WISE_PROFILE_ID: z.string().optional(),
  WISE_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
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
    if (env.PAYPAL_MODE === 'live' && (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)) return false;
    return true;
  },
  {
    message:
      'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required when PAYPAL_MODE is "live"',
    path: ['PAYPAL_CLIENT_ID'],
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

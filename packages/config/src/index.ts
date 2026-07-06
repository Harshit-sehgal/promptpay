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

  // PayPal (payouts — later)
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
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

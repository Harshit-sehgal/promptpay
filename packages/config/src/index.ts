import { z } from 'zod';

const envSchema = z.object({
  // General
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string(),
  DIRECT_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // API
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),

  // Web
  WEB_PORT: z.coerce.number().default(3000),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),

  // Auth
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Stripe (advertiser deposits)
  STRIPE_PUBLIC_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // PayPal (payouts — later)
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
});

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

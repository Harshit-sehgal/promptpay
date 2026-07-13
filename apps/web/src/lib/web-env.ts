import { z } from 'zod';

/**
 * Web (Next.js) environment validation (A-016).
 *
 * The API validates its env via `@waitlayer/config`. The web app reads a
 * smaller, security-relevant subset (JWT_SECRET for middleware JWT
 * verification, the API base URL, cookie security). We validate the same
 * subset here so a bad web deploy fails fast instead of silently breaking
 * auth at runtime.
 *
 * `JWT_SECRET` MUST match the API's `JWT_SECRET` — the middleware verifies the
 * auth cookie with it. If they diverge, protected routes will reject every
 * valid token and bounce logged-in users to /login. In production we therefore
 * require it to be present and >= 32 chars. In dev/test we are lenient so
 * local runs without the var still work (the middleware simply can't verify
 * and redirects to login, which is the safe default).
 */
const PUBLIC_JWT_SECRETS = new Set([
  'dev-only-docker-compose-jwt-secret-at-least-32-char',
  'change-me-in-production-32chars-ok',
]);

function safeCredentialEndpoint(value: string, allowInternalHttp: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const internal = allowInternalHttp && !hostname.includes('.');
    return url.protocol === 'https:' || (url.protocol === 'http:' && (loopback || internal));
  } catch {
    return false;
  }
}

const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    JWT_SECRET: z.string().min(32).optional(),
    NEXT_PUBLIC_API_URL: z.string().optional(),
    API_INTERNAL_URL: z.string().optional(),
    BFF_TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(3).default(1),
    COOKIE_SECURE: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      (!env.JWT_SECRET || PUBLIC_JWT_SECRETS.has(env.JWT_SECRET))
    ) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'production secret required' });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.NEXT_PUBLIC_API_URL &&
      !safeCredentialEndpoint(env.NEXT_PUBLIC_API_URL, false)
    ) {
      ctx.addIssue({ code: 'custom', path: ['NEXT_PUBLIC_API_URL'], message: 'unsafe endpoint' });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.API_INTERNAL_URL &&
      !safeCredentialEndpoint(env.API_INTERNAL_URL, true)
    ) {
      ctx.addIssue({ code: 'custom', path: ['API_INTERNAL_URL'], message: 'unsafe endpoint' });
    }
  });

export interface WebEnv {
  NODE_ENV: 'development' | 'production' | 'test';
  JWT_SECRET?: string;
  NEXT_PUBLIC_API_URL?: string;
  API_INTERNAL_URL?: string;
  BFF_TRUST_PROXY_HOPS?: number;
  COOKIE_SECURE?: string;
}

/**
 * Validate the web env. In production, a missing/short JWT_SECRET throws a
 * clear error so the deploy fails before serving traffic. In dev/test it
 * returns the parsed (possibly partial) env without throwing.
 */
export function validateWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const parsed = webEnvSchema.safeParse(source);
  if (!parsed.success) {
    if (source.NODE_ENV === 'production') {
      throw new Error(
        `Invalid web environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
      );
    }
    return {
      NODE_ENV: (source.NODE_ENV as WebEnv['NODE_ENV']) ?? 'development',
      JWT_SECRET: source.JWT_SECRET,
      NEXT_PUBLIC_API_URL: source.NEXT_PUBLIC_API_URL,
      API_INTERNAL_URL: source.API_INTERNAL_URL,
      BFF_TRUST_PROXY_HOPS: source.BFF_TRUST_PROXY_HOPS
        ? Number(source.BFF_TRUST_PROXY_HOPS)
        : undefined,
      COOKIE_SECURE: source.COOKIE_SECURE,
    };
  }
  return parsed.data;
}

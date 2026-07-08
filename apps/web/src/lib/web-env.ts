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
const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32).optional(),
  NEXT_PUBLIC_API_URL: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
});

export interface WebEnv {
  NODE_ENV: 'development' | 'production' | 'test';
  JWT_SECRET?: string;
  NEXT_PUBLIC_API_URL?: string;
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
      COOKIE_SECURE: source.COOKIE_SECURE,
    };
  }
  return parsed.data;
}

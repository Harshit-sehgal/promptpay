# Rate Limiting & Brute-Force Protection

The API enforces per-IP rate limits and brute-force tracking. This is
production-critical for credential stuffing, extension fraud, and abuse of
paid endpoints.

## How it works

- Built on NestJS `@nestjs/throttler` with a **Redis-backed storage**
  (`RedisBackedThrottlerStorage`). Distributed counters require `REDIS_URL`,
  which is **mandatory in production** (the config rejects a production boot
  without it).
- The tracker key is `ip:<client-ip>`, where the IP comes from Express's
  resolved `req.ip` (honouring `TRUST_PROXY_HOPS`). Do **not** key off
  `X-Forwarded-For` directly — an attacker can rotate it per request and defeat
  the limit. See `apps/api/src/common/guards/throttle-by-route.guard.ts`.

## Buckets (defined in `apps/api/src/app.module.ts`)

| Bucket         | Limit            | Applies to                                                        |
| -------------- | ---------------- | ----------------------------------------------------------------- |
| `auth-short`   | 10 req / 60s     | Login, signup, password reset, `/auth/google`, email verification |
| `auth-long`    | 30 req / 300s    | Token refresh (`/auth/refresh`)                                   |
| `extension`    | 60 req / 60s     | All `/extension/*` event traffic (catches rate-limit fraud)       |
| `default`      | 200 req / 60s    | Everything else                                                   |

`/health` is excluded via `@SkipThrottle`.

## Configuration

Rate limits are **not** env-tunable today — they are constants in
`app.module.ts`. To change a limit, edit the `throttlers` array there and bump
the relevant ADR / changelog. If you need env-driven limits, add typed vars to
`packages/config` (see `docs/ENV_REFERENCE.md`) and wire them into the
`ThrottlerModule.forRootAsync` factory.

## Brute-force guard

`BruteForceGuard` (`apps/api/src/common/guards/brute-force.guard.ts`) adds
sliding-window counters on top of the throttle buckets for sensitive routes
(e.g. consecutive failed logins), using `RedisWindowCounter`. Failed auth
returns a generic error that does not disclose whether the email exists.

## Tuning guidance

- Behind a load balancer / ingress, set `TRUST_PROXY_HOPS` correctly (default
  `1`). A wrong value either keys abuse off the proxy IP (bypassable) or
  over-trusts client `X-Forwarded-For` (spoofable).
- `extension` is intentionally tight: extension event spam is a direct fraud
  vector on the paid-impression economy.
- In tests, throttlers are overridden so E2E suites aren't rate-limited
  (see `*.spec.ts` overrides).

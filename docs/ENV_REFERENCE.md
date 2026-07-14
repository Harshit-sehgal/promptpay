# Environment Variable Reference

All variables are validated at boot by `@waitlayer/config` (Zod schema in
`packages/config/src`). Unknown variables are ignored; **required** variables
missing or invalid cause the process to exit at startup. See `.env.example` for
a copy-paste template.

`req` = required (process fails to start if unset/!valid). `opt` = optional.
Default shown where one exists.

## General

| Variable    | Req | Default       | Purpose                                 |
| ----------- | --- | ------------- | --------------------------------------- |
| `NODE_ENV`  | opt | `development` | `development` \| `production` \| `test` |
| `LOG_LEVEL` | opt | `info`        | `debug` \| `info` \| `warn` \| `error`  |

## Database

| Variable       | Req | Default | Purpose                                                   |
| -------------- | --- | ------- | --------------------------------------------------------- |
| `DATABASE_URL` | req | —       | Full Prisma connection string (pooled). Must be set.      |
| `DIRECT_URL`   | opt | —       | Direct (non-pooled) URL for `prisma migrate` / shadow DB. |

## Redis

| Variable    | Req  | Default | Purpose                                                                                   |
| ----------- | ---- | ------- | ----------------------------------------------------------------------------------------- |
| `REDIS_URL` | opt* | —       | Redis for distributed rate limiting + brute-force tracking. **Required in `production`.** |

\* `REDIS_URL` is optional in dev/test but **required in production** (the config
`refine()` rejects a production boot without it).

## API

| Variable           | Req | Default                 | Purpose                                                             |
| ------------------ | --- | ----------------------- | ------------------------------------------------------------------- |
| `API_PORT`         | opt | `4002`                  | Port the NestJS API listens on.                                     |
| `API_BASE_URL`     | opt | `http://localhost:4002` | Public base URL of the API.                                         |
| `WEB_BASE_URL`     | opt | `http://localhost:3000` | Frontend base URL (CORS / email links).                             |
| `TRUST_PROXY_HOPS` | opt | `1`                     | Reverse-proxy trust hops for `req.ip` (0–3). See rate-limiting doc. |

## Web

| Variable                       | Req | Default | Purpose                               |
| ------------------------------ | --- | ------- | ------------------------------------- |
| `WEB_PORT`                     | opt | `3000`  | Next.js port.                         |
| `NEXT_PUBLIC_API_URL`          | opt | —       | Browser-exposed API URL (web only).   |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | opt | —       | Google OAuth client id (browser).     |
| `NEXT_PUBLIC_ALLOW_MOCK_AUTH`  | opt | —       | Shows mock-auth UI in web (dev only). |

## Auth

| Variable                     | Req | Default | Purpose                                                                                                                                  |
| ---------------------------- | --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`            | req | —       | PEM-encoded RSA private key for RS256 access/refresh tokens.                                                                             |
| `JWT_PUBLIC_KEY`             | req | —       | PEM-encoded RSA public key for RS256 verification. Shared with the web middleware.                                                       |
| `JWT_SECRET`                 | req | —       | Symmetric secret, **min 32 chars**. Used for refresh-token HMAC integrity and BFF rate-limit identity signing. NOT used for JWT signing. |
| `JWT_ACCESS_TTL`             | opt | `15m`   | Access token lifetime.                                                                                                                   |
| `JWT_REFRESH_TTL`            | opt | `30d`   | Refresh token lifetime.                                                                                                                  |
| `TOTP_SECRET_ENCRYPTION_KEY` | opt | —       | App-level key for encrypted server-stored TOTP seeds. **Required in production** for MFA.                                                |
| `GOOGLE_CLIENT_ID`           | opt | —       | Google OAuth client id (server-side verification).                                                                                       |
| `MOCK_GOOGLE_ENABLED`        | opt | —       | `1` enables mock Google verifier (ignored in production).                                                                                |
| `ALLOW_MOCK_GOOGLE`          | opt | —       | `true` legacy alias for `MOCK_GOOGLE_ENABLED` (ignored in prod).                                                                         |

## Stripe (advertiser deposits)

| Variable                 | Req | Default | Purpose                         |
| ------------------------ | --- | ------- | ------------------------------- |
| `STRIPE_PUBLIC_KEY`      | opt | —       | Publishable key (browser-safe). |
| `STRIPE_SECRET_KEY`      | opt | —       | Secret key (server).            |
| `STRIPE_WEBHOOK_SECRET`  | opt | —       | Webhook signature secret.       |
| `STRIPE_PUBLISHABLE_KEY` | opt | —       | Alias for `STRIPE_PUBLIC_KEY`.  |

## Email

| Variable         | Req | Default                   | Purpose                                      |
| ---------------- | --- | ------------------------- | -------------------------------------------- |
| `EMAIL_DRIVER`   | opt | `console`                 | `console` \| `resend`.                       |
| `EMAIL_FROM`     | opt | `noreply@waitlayer.local` | From address.                                |
| `RESEND_API_KEY` | opt | —                         | Resend API key (when `EMAIL_DRIVER=resend`). |

## Sentry (error monitoring)

| Variable             | Req | Default | Purpose                     |
| -------------------- | --- | ------- | --------------------------- |
| `SENTRY_DSN`         | opt | —       | Sentry DSN. No-op if unset. |
| `SENTRY_ENVIRONMENT` | opt | —       | Sentry environment label.   |

## Payout security

| Variable                            | Req | Default | Purpose                                                                          |
| ----------------------------------- | --- | ------- | -------------------------------------------------------------------------------- |
| `PAYOUT_REQUIRE_2FA`                | opt | —       | `true` requires MFA-enrolled account to request payouts.                         |
| `PAYOUT_DESTINATION_COOLDOWN_HOURS` | opt | —       | If > 0, newly-added/changed payout destinations require MFA for that many hours. |

## Payout providers (payouts — later / dev stubs)

| Variable               | Req | Default   | Purpose                          |
| ---------------------- | --- | --------- | -------------------------------- |
| `PAYPAL_CLIENT_ID`     | opt | —         | PayPal client id.                |
| `PAYPAL_CLIENT_SECRET` | opt | —         | PayPal secret.                   |
| `PAYPAL_MODE`          | opt | `sandbox` | `sandbox` \| `live`.             |
| `WISE_API_TOKEN`       | opt | —         | Wise API token.                  |
| `WISE_API_VERSION`     | opt | `3.0`     | Wise API version.                |
| `WISE_PROFILE_ID`      | opt | —         | Wise business profile id (live). |
| `WISE_MODE`            | opt | `sandbox` | `sandbox` \| `live`.             |

## Feature / behaviour toggles

| Variable                   | Req | Default | Purpose                                               |
| -------------------------- | --- | ------- | ----------------------------------------------------- |
| `LAUNCH_SPLIT_ENABLED`     | opt | `false` | Use 80/10/10 (dev/platform/reserve) earnings split.   |
| `WEBHOOK_ASYNC_PROCESSING` | opt | `false` | Process Stripe webhooks off-thread via the event bus. |

## Cron intervals (ms)

| Variable                        | Req | Default    | Purpose                                   |
| ------------------------------- | --- | ---------- | ----------------------------------------- |
| `PAYOUT_POLL_INTERVAL_MS`       | opt | `600000`   | Payout provider poll loop (min 60000).    |
| `RETENTION_CRON_INTERVAL_MS`    | opt | `86400000` | Data-retention sweep (min 3600000).       |
| `LEDGER_MATURATION_INTERVAL_MS` | opt | `600000`   | Ledger maturation job (min 60000).        |
| `PROVIDER_CALL_TIMEOUT_MS`      | opt | `15000`    | Per-call external PSP timeout (min 1000). |

## Notes

- `JWT_SECRET` is validated as **≥ 32 chars** and must not contain the
  substrings `change-me` / `replace-with` or start with `dev-jwt-secret`
  (those placeholders are rejected even at 32 chars).
- Generate secrets with `openssl rand -base64 48`.
- Adding a new variable? Add it to `packages/config/src` **and** update this
  file and `.env.example`.

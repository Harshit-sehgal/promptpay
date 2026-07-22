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

| Variable                                       | Req | Default | Purpose                                                        |
| ---------------------------------------------- | --- | ------- | -------------------------------------------------------------- |
| `WEB_PORT`                                     | opt | `3000`  | Next.js port.                                                  |
| `NEXT_PUBLIC_API_URL`                          | opt | —       | Public API URL; required by the Vercel deployment preflight.   |
| `API_INTERNAL_URL`                             | opt | —       | Server-only API URL preferred by BFF handlers.                 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`                 | opt | —       | Google OAuth client id; required by Vercel preflight.          |
| `NEXT_PUBLIC_ALLOW_MOCK_AUTH`                  | opt | —       | Shows mock-auth UI in local development only.                  |
| `NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS` | opt | —       | JSON provider launch-status map baked into the web build.      |
| `BFF_TRUST_PROXY_HOPS`                         | opt | `1`     | Trusted forwarding hops for BFF network identity (1-3).        |
| `COOKIE_SECURE`                                | opt | —       | Explicit secure-cookie override; production HTTPS is inferred. |

## Auth

| Variable                            | Req | Default            | Purpose                                                                                                                                  |
| ----------------------------------- | --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`                   | req | —                  | PEM-encoded RSA private key for RS256 access/refresh tokens.                                                                             |
| `JWT_PUBLIC_KEY`                    | req | —                  | Current RSA public key. Required by the API and web build.                                                                               |
| `JWT_PUBLIC_KEYS`                   | opt | —                  | Additional public PEM keys. Keep old keys through `JWT_REFRESH_TTL` and pass the set to the web build.                                   |
| `JWT_ISSUER`                        | opt | `waitlayer`        | Expected JWT issuer. Custom values must match the web build.                                                                             |
| `JWT_AUDIENCE`                      | opt | `waitlayer-client` | Base JWT audience. Custom values must match the web build.                                                                               |
| `JWT_SECRET`                        | req | —                  | Symmetric secret, **min 32 chars**. Used for refresh-token HMAC integrity and BFF rate-limit identity signing. NOT used for JWT signing. |
| `JWT_ACCESS_TTL`                    | opt | `15m`              | Access token lifetime.                                                                                                                   |
| `JWT_REFRESH_TTL`                   | opt | `30d`              | Refresh token lifetime.                                                                                                                  |
| `TOTP_SECRET_ENCRYPTION_KEY`        | opt | —                  | App-level key for encrypted server-stored TOTP seeds. **Required in production** for MFA.                                                |
| `ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS` | opt | `900`              | Maximum age of an admin step-up token (60-3600 seconds).                                                                                 |
| `GOOGLE_CLIENT_ID`                  | opt | —                  | Google OAuth client id (server-side verification).                                                                                       |
| `MOCK_GOOGLE_ENABLED`               | opt | —                  | `1` enables mock Google verifier (ignored in production).                                                                                |
| `ALLOW_MOCK_GOOGLE`                 | opt | —                  | `true` legacy alias for `MOCK_GOOGLE_ENABLED` (ignored in prod).                                                                         |

## Stripe (advertiser deposits)

| Variable                 | Req | Default | Purpose                         |
| ------------------------ | --- | ------- | ------------------------------- |
| `STRIPE_PUBLIC_KEY`      | opt | —       | Publishable key (browser-safe). |
| `STRIPE_SECRET_KEY`      | opt | —       | Secret key (server).            |
| `STRIPE_WEBHOOK_SECRET`  | opt | —       | Webhook signature secret.       |
| `STRIPE_PUBLISHABLE_KEY` | opt | —       | Alias for `STRIPE_PUBLIC_KEY`.  |

## Email

| Variable                    | Req  | Default                   | Purpose                                                               |
| --------------------------- | ---- | ------------------------- | --------------------------------------------------------------------- |
| `EMAIL_DRIVER`              | opt  | `console`                 | `console` \| `resend`; production requires `resend`.                  |
| `EMAIL_FROM`                | opt  | `noreply@waitlayer.local` | From address; production requires a non-development sender.           |
| `RESEND_API_KEY`            | opt  | —                         | Resend API key; required by the production email policy.              |
| `EMAIL_QUEUE_SECRET`        | opt* | —                         | 32+ character queued-payload encryption key; required in production.  |
| `EMAIL_PROVIDER_TIMEOUT_MS` | opt  | `10000`                   | Transactional email provider timeout (1000-30000).                    |
| `OPS_ALERT_EMAIL`           | opt* | —                         | Monitored financial/security alert recipient; required in production. |

## Sentry (error monitoring)

| Variable             | Req | Default | Purpose                     |
| -------------------- | --- | ------- | --------------------------- |
| `SENTRY_DSN`         | opt | —       | Sentry DSN. No-op if unset. |
| `SENTRY_ENVIRONMENT` | opt | —       | Sentry environment label.   |

## Payout security

| Variable                            | Req | Default | Purpose                                                                                                        |
| ----------------------------------- | --- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `PAYOUT_ENCRYPTION_KEY`             | opt | —       | Base64-encoded 32-byte AES-256-GCM key for encrypting payout destinations at rest. **Required in production.** |
| `PAYOUT_REQUIRE_2FA`                | opt | —       | `true` requires MFA-enrolled account to request payouts.                                                       |
| `PAYOUT_DESTINATION_COOLDOWN_HOURS` | opt | —       | If > 0, newly-added/changed payout destinations require MFA for that many hours.                               |
| `WAITLAYER_PAYOUT_PROVIDER_STATUS`  | opt | —       | Strict JSON provider -> `available`/`coming_soon` API gate.                                                    |

## Payout providers (payouts — later / dev stubs)

| Variable                         | Req | Default   | Purpose                                                     |
| -------------------------------- | --- | --------- | ----------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`               | opt | —         | PayPal client id.                                           |
| `PAYPAL_CLIENT_SECRET`           | opt | —         | PayPal secret.                                              |
| `PAYPAL_MODE`                    | opt | `sandbox` | `sandbox` \| `live`.                                        |
| `WISE_API_TOKEN`                 | opt | —         | Wise API token.                                             |
| `WISE_API_VERSION`               | opt | `3.0`     | Wise API version.                                           |
| `WISE_PROFILE_ID`                | opt | —         | Wise business profile id (live).                            |
| `WISE_MODE`                      | opt | `sandbox` | `sandbox` \| `live`.                                        |
| `WISE_EMAIL_RECIPIENTS_VERIFIED` | opt | `false`   | Fail-closed confirmation for Wise email-recipient corridor. |

## Extension / wait-detection trust

| Variable                             | Req | Default | Purpose                                                                                                                                          |
| ------------------------------------ | --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VERIFIED_DETECTOR_VERSIONS`         | opt | —       | Comma-separated allowlist of detector versions considered verified (e.g. `1.0.0,1.1.0`). Empty/missing = all sources unverified.                 |
| `WAIT_ATTESTATION_ISSUERS`           | opt | —       | JSON array of independently operated attestation issuers: `{provider, issuer, audience, publicKeys}`. Required to create an attestation session. |
| `VERIFIED_WAIT_ATTESTATION_VERSIONS` | opt | —       | Comma-separated allowlist of signed provider assertion versions. This is intentionally separate from client detector versions.                   |

## Feature / behaviour toggles

| Variable                   | Req | Default | Purpose                                              |
| -------------------------- | --- | ------- | ---------------------------------------------------- |
| `LAUNCH_SPLIT_ENABLED`     | opt | `false` | Use 80/10/10 (dev/platform/reserve) earnings split.  |
| `WEBHOOK_ASYNC_PROCESSING` | opt | `false` | Legacy compatibility flag; only `false` is accepted. |
| `SWAGGER_ENABLED`          | opt | `false` | Expose Swagger/OpenAPI documentation.                |

## Cron intervals (ms)

| Variable                           | Req | Default    | Purpose                                   |
| ---------------------------------- | --- | ---------- | ----------------------------------------- |
| `PAYOUT_POLL_INTERVAL_MS`          | opt | `600000`   | Payout provider poll loop (min 60000).    |
| `PAYOUT_POLL_BATCH_SIZE`           | opt | `100`      | Payouts processed per poll (1-500).       |
| `RETENTION_CRON_INTERVAL_MS`       | opt | `86400000` | Data-retention sweep (min 3600000).       |
| `LEDGER_MATURATION_INTERVAL_MS`    | opt | `600000`   | Ledger maturation job (min 60000).        |
| `LEDGER_MATURATION_BATCH_SIZE`     | opt | `500`      | Entries processed per maturation batch.   |
| `LEDGER_MATURATION_RUN_CAP`        | opt | `5000`     | Maximum entries processed per run.        |
| `WEBHOOK_RECLAIM_CRON`             | opt | —          | May not be `false` in production.         |
| `WEBHOOK_RECLAIM_CRON_INTERVAL_MS` | opt | `300000`   | Stale webhook reclaim interval.           |
| `WEBHOOK_RECLAIM_CRON_AGE_MS`      | opt | `2100000`  | Minimum webhook age before reclaim.       |
| `WEBHOOK_RECLAIM_CRON_BATCH_SIZE`  | opt | `100`      | Webhooks reclaimed per batch.             |
| `PROVIDER_CALL_TIMEOUT_MS`         | opt | `15000`    | Per-call external PSP timeout (min 1000). |

## Privacy and OAuth verification

| Variable                      | Req  | Default | Purpose                                                     |
| ----------------------------- | ---- | ------- | ----------------------------------------------------------- |
| `PRIVACY_HASH_KEY`            | opt* | —       | 32+ character keyed pseudonymization secret; prod required. |
| `GOOGLE_TOKENINFO_TIMEOUT_MS` | opt  | `5000`  | Google token-info request timeout (1000-30000).             |

## Notes

- `JWT_SECRET` is validated as **≥ 32 chars** and must not contain the
  substrings `change-me` / `replace-with` or start with `dev-jwt-secret`
  (those placeholders are rejected even at 32 chars).
- Generate secrets with `openssl rand -base64 48`.
- Adding a new variable? Add it to `packages/config/src` **and** update this
  file and `.env.example`.

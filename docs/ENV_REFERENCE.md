# Environment Variable Reference

All variables are validated at boot by `@ateva/config` (Zod schema in
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

| `ATEVA_ENVIRONMENT_KIND` | opt | `development` | `development` \\| `test` \\| `sandbox` \\| `staging` \\| `production`; production requires `NODE_ENV=production`, and sandbox is never production. |
| `ATEVA_ENVIRONMENT_ID` | opt | `local` | Stable environment/run identifier persisted in the database marker. |
| `SANDBOX_RESET_TOKEN` | opt | — | 32–256 character operator bearer required by the admin-only sandbox reset endpoint; accepted only by `test`/`sandbox` deployments and never a production credential. |
| `NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND` | opt | `development` | Web build identity; valid values are `development`, `test`, `sandbox`, `staging`, and `production`; `sandbox` renders a persistent “Test credits only — no cash value” banner. Production deployments must set this explicitly to `production`. |
| `ENABLE_STAGING_FAUCET` | opt | `false` | Test faucet toggle; accepted only in `test`, `sandbox`, or `staging`. |

## Database

| Variable       | Req | Default | Purpose                                                   |
| -------------- | --- | ------- | --------------------------------------------------------- |
| `DATABASE_URL` | req | —       | Full Prisma connection string (pooled). Must be set.      |
| `DIRECT_URL`   | opt | —       | Direct (non-pooled) URL for `prisma migrate` / shadow DB. |

## Redis

| Variable                   | Req  | Default | Purpose                                                                                                                                                     |
| -------------------------- | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`                | opt* | —       | Redis for distributed rate limiting + brute-force tracking. **Required in `production`.**                                                                   |
| `REDIS_CONNECT_TIMEOUT_MS` | opt  | `2000`  | Bounded Redis pub/sub connection timeout (50–30000 ms); API boot fails fast on an unreachable Redis client and retains the local config-cache TTL fallback. |

\* `REDIS_URL` is optional in dev/test but **required in production** (the config
`refine()` rejects a production boot without it).

## API

| Variable                    | Req | Default                 | Purpose                                                                                                                                  |
| --------------------------- | --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `API_PORT`                  | opt | `4002`                  | Port the NestJS API listens on.                                                                                                          |
| `API_BASE_URL`              | opt | `http://localhost:4002` | Public base URL of the API.                                                                                                              |
| `WEB_BASE_URL`              | opt | `http://localhost:3000` | Frontend base URL (CORS / email links).                                                                                                  |
| `TRUST_PROXY_HOPS`          | opt | `1`                     | Reverse-proxy trust hops for `req.ip` (0–3). See rate-limiting doc.                                                                      |
| `THROTTLE_AUTH_SHORT_LIMIT` | opt | `10`                    | Requests/min on `/auth/login` + `/auth/signup` (+ 2FA) buckets. Raise ONLY for isolated test/CI APIs — never on a public production API. |
| `THROTTLE_AUTH_LONG_LIMIT`  | opt | `30`                    | Requests/min on other auth routes. Same production warning as above.                                                                     |
| `THROTTLE_EXTENSION_LIMIT`  | opt | `60`                    | Requests/min on extension device/wait-report routes.                                                                                     |
| `THROTTLE_DEFAULT_LIMIT`    | opt | `200`                   | Requests/min for all remaining API routes.                                                                                               |

## Web

| Variable                      | Req         | Default | Purpose                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_PORT`                    | opt         | `3000`  | Next.js port.                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_API_URL`         | opt         | —       | Public API URL; required by the Vercel deployment preflight.                                                                                                                                                                                                                              |
| `API_INTERNAL_URL`            | opt         | —       | Server-only API URL preferred by BFF handlers.                                                                                                                                                                                                                                            |
| `NEXT_PUBLIC_ALLOW_MOCK_AUTH` | opt         | —       | Shows mock-auth UI in local development only.                                                                                                                                                                                                                                             |
| `BFF_TRUST_PROXY_HOPS`        | opt         | `1`     | Trusted forwarding hops for BFF network identity (1-3).                                                                                                                                                                                                                                   |
| `COOKIE_SECURE`               | opt         | —       | Explicit secure-cookie override. `false` forces non-Secure cookies in every environment (operator escape hatch for plain-HTTP staging/CI hosts; emits a warning in production). The deploy preflight (`verify-deploy-env.mjs` / `web-env.ts`) still rejects `false` for real deployments. |
| `BFF_TRUST_PROXY_HOPS`        | req in prod | `1` dev | Forwarded-proxy hops trusted by the web BFF; keep aligned with the public edge topology.                                                                                                                                                                                                  |

## Auth

| Variable                            | Req | Default        | Purpose                                                                                                                                  |
| ----------------------------------- | --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`                   | req | —              | PEM-encoded RSA private key for RS256 access/refresh tokens.                                                                             |
| `JWT_PUBLIC_KEY`                    | req | —              | Current RSA public key. Required by the API and web build.                                                                               |
| `JWT_PUBLIC_KEYS`                   | opt | —              | Additional public PEM keys. Keep old keys through `JWT_REFRESH_TTL` and pass the set to the web build.                                   |
| `JWT_ISSUER`                        | opt | `ateva`        | Expected JWT issuer. Custom values must match the web build.                                                                             |
| `JWT_AUDIENCE`                      | opt | `ateva-client` | Base JWT audience. Custom values must match the web build.                                                                               |
| `JWT_SECRET`                        | req | —              | Symmetric secret, **min 32 chars**. Used for refresh-token HMAC integrity and BFF rate-limit identity signing. NOT used for JWT signing. |
| `JWT_ACCESS_TTL`                    | opt | `15m`          | Access token lifetime.                                                                                                                   |
| `JWT_REFRESH_TTL`                   | opt | `30d`          | Refresh token lifetime.                                                                                                                  |
| `TOTP_SECRET_ENCRYPTION_KEY`        | opt | —              | App-level key for encrypted server-stored TOTP seeds. **Required in production** for MFA.                                                |
| `ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS` | opt | `900`          | Maximum age of an admin step-up token (60-3600 seconds).                                                                                 |
| `GOOGLE_CLIENT_ID`                  | opt | —              | Google OAuth client id; the API verifies tokens and serves it to the web through auth config.                                            |
| `MOCK_GOOGLE_ENABLED`               | opt | —              | `1` enables mock Google verifier (ignored in production).                                                                                |
| `ALLOW_MOCK_GOOGLE`                 | opt | —              | `true` legacy alias for `MOCK_GOOGLE_ENABLED` (ignored in prod).                                                                         |

## Advertiser deposits (money-in)

`DEPOSIT_PROCESSOR` selects the money-in rail. **Dodo Payments is the launch
rail (decision D1); Stripe is inactive at launch (D2).** See
`DODO_PAYMENTS_PLAN.md`.

| Variable              | Req | Default | Purpose                                                                                                                                            |
| --------------------- | --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPOSIT_PROCESSOR`   | opt | —       | `stripe` \| `dodo`. Unset = deposits fail closed (400).                                                                                            |
| `DODO_API_KEY`        | opt | —       | Dodo API key. Required when `DEPOSIT_PROCESSOR=dodo`.                                                                                              |
| `DODO_BASE_URL`       | opt | —       | `https://test.dodopayments.com` or `https://live.dodopayments.com`. Required when `DEPOSIT_PROCESSOR=dodo`; test endpoint forbidden in production. |
| `DODO_WEBHOOK_SECRET` | opt | —       | Dodo webhook signing secret (Standard Webhooks). Required when `DEPOSIT_PROCESSOR=dodo`.                                                           |
| `DODO_PRODUCT_ID`     | opt | —       | Wallet top-up product id (pay-what-you-want). Required when `DEPOSIT_PROCESSOR=dodo`.                                                              |

## Stripe (inactive at launch — decision D2)

| Variable                 | Req | Default | Purpose                         |
| ------------------------ | --- | ------- | ------------------------------- |
| `STRIPE_PUBLIC_KEY`      | opt | —       | Publishable key (browser-safe). |
| `STRIPE_SECRET_KEY`      | opt | —       | Secret key (server).            |
| `STRIPE_WEBHOOK_SECRET`  | opt | —       | Webhook signature secret.       |
| `STRIPE_PUBLISHABLE_KEY` | opt | —       | Alias for `STRIPE_PUBLIC_KEY`.  |

## Email

| Variable                    | Req  | Default               | Purpose                                                               |
| --------------------------- | ---- | --------------------- | --------------------------------------------------------------------- |
| `EMAIL_DRIVER`              | opt  | `console`             | `console` \| `resend`; production requires `resend`.                  |
| `EMAIL_FROM`                | opt  | `noreply@ateva.local` | From address; production requires a non-development sender.           |
| `RESEND_API_KEY`            | opt  | —                     | Resend API key; required by the production email policy.              |
| `EMAIL_QUEUE_SECRET`        | opt* | —                     | 32+ character queued-payload encryption key; required in production.  |
| `EMAIL_PROVIDER_TIMEOUT_MS` | opt  | `10000`               | Transactional email provider timeout (1000-30000).                    |
| `OPS_ALERT_EMAIL`           | opt* | —                     | Monitored financial/security alert recipient; required in production. |

## Sentry (error monitoring)

| Variable                         | Req | Default | Purpose                                                                   |
| -------------------------------- | --- | ------- | ------------------------------------------------------------------------- |
| `SENTRY_DSN`                     | opt | —       | Server-side Sentry DSN. No-op if unset.                                   |
| `SENTRY_ENVIRONMENT`             | opt | —       | Server-side Sentry environment label.                                     |
| `NEXT_PUBLIC_SENTRY_DSN`         | opt | —       | Build-time browser Sentry DSN. No-op if unset.                            |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | opt | —       | Build-time browser Sentry environment label; should match the deployment. |
| `SENTRY_ORG`                     | opt | —       | Sentry organization slug for build-time source-map upload.                |
| `SENTRY_PROJECT`                 | opt | —       | Sentry project slug for build-time source-map upload.                     |
| `SENTRY_AUTH_TOKEN`              | opt | —       | Build-only Sentry token for source-map upload; never a runtime secret.    |

## Payout security

| Variable                            | Req | Default                  | Purpose                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAYOUT_ENCRYPTION_KEY`             | opt | —                        | Base64-encoded 32-byte AES-256-GCM key for encrypting payout destinations at rest. **Required in production.**                                                                                                                                                                                                  |
| `PAYOUT_HMAC_KEY`                   | opt | —                        | Base64-encoded 32-byte key for deterministic destination HMACs (duplicate/fraud matching without decrypting). **Required in production.**                                                                                                                                                                       |
| `PAYOUT_REQUIRE_2FA`                | opt | —                        | `true` requires MFA-enrolled account to request payouts.                                                                                                                                                                                                                                                        |
| `PAYOUT_DESTINATION_COOLDOWN_HOURS` | opt | —                        | If > 0, newly-added/changed payout destinations require MFA for that many hours.                                                                                                                                                                                                                                |
| `PAYOUT_FENCE_HIGH_VALUE_MINOR`     | opt | per-currency default map | Global override for the payout-fence release threshold (in minor units, e.g. `1000000` = $10,000 USD). A fence release whose exposure is at or above the threshold requires a distinct second approver (`secondApproverId`). Beats any per-currency `HIGH_VALUE_FENCE_<CUR>_MINOR` override.                    |
| `HIGH_VALUE_FENCE_<CUR>_MINOR`      | opt | per-currency default map | Per-currency threshold (ISO-4217 code in the variable name, e.g. `HIGH_VALUE_FENCE_USD_MINOR=1000000`). Beats the configured policy/default map for that currency but not the global `PAYOUT_FENCE_HIGH_VALUE_MINOR`. Defaults (minor units): USD/EUR/GBP/CAD/AUD/BRL `1000000`, INR `80000000`, JPY `1500000`. |
| `ATEVA_PAYOUT_PROVIDER_STATUS`      | opt | —                        | Strict JSON provider -> `available`/`coming_soon` API gate.                                                                                                                                                                                                                                                     |
| `PAYOUT_HOLD_DAYS_NEW_ACCOUNT`      | opt | `30`                     | Earnings hold (days) for new/low-trust developers (§8.11 float sizing). Validated 1–365.                                                                                                                                                                                                                        |
| `PAYOUT_HOLD_DAYS_NORMAL`           | opt | `14`                     | Earnings hold (days) for normal-trust developers (§8.11 float sizing). Validated 1–365.                                                                                                                                                                                                                         |
| `PAYOUT_HOLD_DAYS_HIGH_TRUST`       | opt | `7`                      | Earnings hold (days) for high-trust developers (§8.11 float sizing). Validated 1–365.                                                                                                                                                                                                                           |
| `PAYOUT_HOLD_DAYS_EXTENDED`         | opt | `60`                     | Earnings hold (days) for unverified detector sources, floored to the base tier (§8.11 float sizing). Validated 1–365. The restricted/banned −1 "indefinite hold" is NOT overridable.                                                                                                                            |

## Paid-launch policy

| Variable             | Req in production | Default | Purpose                                                                                                   |
| -------------------- | ----------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `ALLOWED_COUNTRIES`  | yes               | —       | Comma-separated ISO-3166 alpha-2 positive allowlist. Missing user countries are rejected when configured. |
| `ALLOWED_CURRENCIES` | yes               | —       | Comma-separated ISO-4217 positive settlement allowlist. Missing/unsupported currencies are rejected.      |

## Payout provider credentials (all optional; launch status is separately gated)

PayPal Payouts, Stripe Connect, and Wise have implemented provider paths, but
remain `coming_soon` until the relevant credentials, provider approval, and
sandbox/live capability checks are complete. Payoneer, Razorpay, and Dodo
Payments are fail-closed stubs and cannot be enabled by configuration alone.

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

| Variable                         | Req  | Default | Purpose                                                                                                    |
| -------------------------------- | ---- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `PRIVACY_HASH_KEY`               | opt* | —       | 32+ character keyed pseudonymization secret; prod required.                                                |
| `ATTENTION_SHADOW_PSEUDONYM_KEY` | opt  | —       | 32-256 character key for opt-in privacy-safe adaptive-attention shadow facts; never a client/build secret. |
| `GOOGLE_AUTH_TIMEOUT_MS`         | opt  | `5000`  | Google ID-token verification transport timeout (1000-30000).                                               |

## Notes

- `JWT_SECRET` is validated as **≥ 32 chars** and must not contain the
  substrings `change-me` / `replace-with` or start with `dev-jwt-secret`
  (those placeholders are rejected even at 32 chars).
- Generate secrets with `openssl rand -base64 48`.
- Adding a new variable? Add it to `packages/config/src` **and** update this
  file and `.env.example`.

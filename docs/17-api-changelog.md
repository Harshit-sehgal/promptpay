# WaitLayer API Changelog

All notable changes to the public REST API (`/api/v1`) are documented here.
The API follows a pragmatic versioning scheme: the global prefix is `api/v1`
and breaking changes increment the `vN` prefix.

## [2026-07-09]

### Added

- **OpenAPI / Swagger docs** at `GET /api/v1/docs` (UI) and
  `GET /api/v1/docs-json` (spec), generated from controllers + DTOs.
- **Redis health** reported by `GET /health` (`redis` field: `connected`,
  `error`, or `not_configured`) and `GET /health/metrics`.
- **Structured JSON logging** in production (`type`, `method`, `url`,
  `statusCode`, `durationMs`, `requestId`).
- **DB-level CHECK constraints** on all monetary/count columns (defense-in-depth
  for the three-ledger accounting).
- **2FA login challenge**: `POST /auth/login` returns
  `{ twoFactorRequired: true, message: "Two-factor authentication code required" }`
  when a TOTP-protected account logs in without a code, so clients can prompt
  and resubmit with `twoFactorToken`.

### Changed

- `POST /auth/login` and `POST /auth/google` now accept an optional
  `twoFactorToken` field.

### Security

- TOTP 2FA is enforced server-side on all money-moving endpoints; the 2FA
  challenge is machine-readable so the web, CLI, and VS Code clients can drive
  the second factor without parsing error strings.

## [2026-07-04] — Private Beta Foundation

### Added

- Auth (signup, login, refresh rotation + reuse detection, password reset,
  email verification, TOTP 2FA with encrypted secrets).
- Campaign lifecycle (draft → submitted → approved → active → paused → archived).
- Three-ledger accounting with 60/30/10 (80/10/10 launch) splits.
- Payouts (PayPal, Stripe Connect, Wise, manual; Razorpay/Payoneer stubs).
- Fraud controls (rate limits, brute-force lockouts, CTR/self-click analysis,
  trust scoring).
- Extensions (HMAC-signed, idempotent event pipeline).
- Referrals, API keys, compliance/consent, audit logs, admin tooling.

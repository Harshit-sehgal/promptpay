# ADR 0004: JWT Refresh Rotation + TOTP 2FA

- **Status:** Accepted (2026)
- **Deciders:** WaitLayer engineering

## Context

Developer accounts hold payable balances, so account takeover is a direct
financial risk. We needed session security that detects stolen tokens and a
phishing-resistant second factor.

## Decision

- **Access tokens** are short-lived JWTs (`aud: 'access'`, `jti`); **refresh
  tokens** are JWTs (`aud: 'refresh'`, `jti`, `family`) stored hashed in a
  `Session` table.
- **Refresh rotation:** each refresh issues a new token and verifies the stored
  bcrypt hash; reuse of a rotated token revokes the **entire family**.
- **TOTP 2FA:** RFC 6238 secrets encrypted at rest with
  `TOTP_SECRET_ENCRYPTION_KEY`; login emits a structured `twoFactorRequired`
  challenge so clients can prompt for the code instead of guessing.
- Non-active accounts (`restricted` / `banned` / `deleted`) cannot issue or
  rotate credentials.

## Consequences

- **Positive:** Token theft is contained; 2FA is enforced server-side on every
  money-moving path; 2FA challenge is machine-readable for all clients.
- **Negative:** Requires secure secret storage in production; refresh rotation
  adds a DB lookup per refresh. Acceptable for a financial system.

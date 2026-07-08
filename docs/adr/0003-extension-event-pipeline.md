# ADR 0003: HMAC-Signed, Idempotent Extension Event Pipeline

- **Status:** Accepted (2026)
- **Deciders:** WaitLayer engineering

## Context

Developer clients (VS Code extension, CLI) report wait states and ad events
from untrusted endpoints. We must prove an event truly came from a registered
device owned by the authenticated user, prevent replay, and avoid double
billing.

## Decision

- Each device is issued a **per-device `eventSecret`** at registration, stored
  in the OS secret store (not a shared global HMAC key).
- Every mutating event is signed with `HMAC-SHA256` over a canonical JSON
  payload (sorted keys, signature field excluded) using the device secret.
- All write events require an **idempotency key**; reused keys cannot bypass
  ownership/signature validation.
- Lost local secrets are recoverable only through password re-auth, linked
  Google re-auth, or a one-time support/admin recovery token — never a global
  fallback.

## Consequences

- **Positive:** Replay- and forgery-resistant; privacy-enforced (no PII in ad
  targeting); safe to retry network calls.
- **Negative:** Clients must persist + rotate the device secret; recovery UX is
  more involved. Worth it for the trust model.

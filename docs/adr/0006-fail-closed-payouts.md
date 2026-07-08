# ADR 0006: Fail-Closed Multi-Provider Payout Architecture

- **Status:** Accepted (2026)
- **Deciders:** WaitLayer engineering

## Context

Payouts move real money to developers. Some providers (Razorpay, Payoneer) are
not production-ready, and others (PayPal, Stripe Connect, Wise) require
credentials. We must never initiate a production payout through an unconfigured
or unimplemented provider.

## Decision

- **Provider readiness** is checked before an approved payout is claimed.
- Unimplemented/partial providers (Razorpay, Payoneer) **fail closed in
  production** (allowed only as dev/test stubs).
- PayPal Payouts, Stripe Connect, and Wise call real APIs only when their
  credentials are configured; malformed destinations and non-positive amounts
  are rejected before any network call.
- If a provider explicitly returns `failed`, the payout is marked `failed` and
  its allocations are released transactionally, making earnings available again.

## Consequences

- **Positive:** No accidental movement of real money; clear operator signal
  when a provider is not ready; safe local development with stubs.
- **Negative:** Production payouts require explicit credential configuration
  and (for Stripe Connect) out-of-band onboarding. Intentionally a gate, not a
  friction bug.

# Architecture Decision Records (ADRs)

This directory captures the significant architecture decisions made for
WaitLayer. We use the lightweight [MADR](https://adr.github.io/madr/)-style
format: **Context → Decision → Consequences**.

- `0001` — Record architecture decisions (this index)
- `0002` — Three-ledger double-entry accounting
- `0003` — HMAC-signed, idempotent extension event pipeline
- `0004` — JWT refresh rotation with reuse detection + TOTP 2FA
- `0005` — NestJS Swagger compiler plugin for API documentation
- `0006` — Fail-closed multi-provider payout architecture

See the [Architecture Overview](../16-architecture-overview.md) for how these
fit together.

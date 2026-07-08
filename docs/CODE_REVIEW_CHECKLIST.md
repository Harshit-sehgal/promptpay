# Code Review Checklist

A checklist for reviewers (and authors self-reviewing) before approving a PR.

## Correctness

- [ ] The change does what the PR description claims — verify against the ticket.
- [ ] Error paths are handled; no swallowed exceptions (check `catch` blocks).
- [ ] Async work is awaited; no floating promises that can drop failures.
- [ ] DB writes use transactions where multi-step consistency matters (ledger,
      payout, referral).

## Security

- [ ] No secrets / PII logged. `JWT_SECRET`, tokens, and passwords are never
      printed.
- [ ] New endpoints enforce authn/authz (guards, roles) — especially admin and
      payout routes.
- [ ] Input is validated (zod / class-validator). Untrusted input is not passed
      to `eval`, `exec`, raw SQL, or template injection sinks.
- [ ] Rate limiting / brute-force guards cover new auth or credential routes
      (see `docs/rate-limiting.md`).
- [ ] CORS / CSP unchanged or intentionally relaxed (see helmet config).

## Data & migrations

- [ ] Schema changes ship a Prisma migration (`pnpm db:migrate`), not a hand
      edit. Drift is caught in CI.
- [ ] Migrations are backward-compatible or clearly marked breaking, with a
      rollback note in `docs/ops/migration-rollback.md`.
- [ ] Destructive migrations are reviewed extra carefully (column drops,
      type changes on money/UUID columns).

## Testing & quality

- [ ] New logic has unit/integration tests; happy path **and** failure path.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`
      all pass locally.
- [ ] `eslint --fix` / `prettier --write` applied (pre-commit hook covers this).
- [ ] Imports sorted per `docs/STYLE_GUIDE.md`.

## Observability & ops

- [ ] New env vars are added to `docs/ENV_REFERENCE.md` and `.env.example`.
- [ ] Meaningful log lines / metrics added for user-facing behaviour.
- [ ] Sentry capture used for unexpected errors; no noisy expected errors.
- [ ] Docs updated where behaviour changes (runbooks, ENV_REFERENCE, onboarding).

## Final

- [ ] PR description explains WHY, links the ticket, and notes rollout risk.
- [ ] No `console.log` left in production code paths (use the logger).
- [ ] Changes are small and reviewable; large PRs are split where possible.

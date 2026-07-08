# Incident Response Runbook

First-responder guide when production is degraded or down.

## Severity

| Sev | Definition                                                | Response                       |
| --- | --------------------------------------------------------- | ------------------------------ |
| SEV1 | Full outage / data loss / security breach                 | Page on-call now; all-hands.   |
| SEV2 | Major feature broken (auth, payouts, impressions)         | Page on-call; same-day fix.    |
| SEV3 | Degraded performance / partial failure                    | On-call aware; next-business-day. |
| SEV4 | Cosmetic / non-critical                                    | Track in backlog.              |

## First 15 minutes

1. **Acknowledge** in the alerting tool; declare the incident + severity.
2. **Triage** using `docs/ops/monitoring.md`:
   - Is `/api/v1/health` failing? (LB/instance down)
   - Sentry error spike? (what route/tag?)
   - Postgres/Redis healthy? (connections, memory, lag)
3. **Contain** if unsafe: enable a feature toggle (`LAUNCH_SPLIT_ENABLED`,
   `WEBHOOK_ASYNC_PROCESSING`), or scale the bad revision to 0.
4. **Communicate** in the incident channel; assign a comms lead if SEV1/2.

## Common incidents → action

- **API 5xx / health red:** check Sentry + container crashes (OOM?). Roll back
  per `docs/ops/rollback.md`.
- **Auth failures / 429 storm:** likely credential stuffing — see
  `docs/rate-limiting.md` + `docs/ops/fraud-review-runbook.md`. Verify
  `TRUST_PROXY_HOPS` and Redis not evicting counters.
- **Migration failed on boot:** API waits for Postgres then `migrate deploy`
  errors. Inspect logs; run `migrate deploy` against `DIRECT_URL` manually;
  if a breaking migration, follow `docs/ops/migration-rollback.md`.
- **Payout stuck/failed:** `docs/ops/payout-runbook.md` + ledger
  reconciliation.
- **Ledger mismatch:** `docs/ops/ledger-reconciliation-runbook.md`.
- **Data breach / leaked secret:** rotate the secret immediately, invalidate
  sessions/tokens, and notify per compliance policy (`docs/08-compliance-privacy-checklist.md`).

## Communication

- Keep a running timeline in the incident channel.
- SEV1/2: stakeholder update every 30 min.
- Post-incident: write a blameless postmortem; link root cause + action items.

## Escalation

- On-call engineer → Eng lead → (SEV1) maintainer / owner.
- For security incidents, loop in the security/compliance owner before public
  statements.

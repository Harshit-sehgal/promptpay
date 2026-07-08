# Monitoring & Alerting

WaitLayer ships with Sentry wired in for error monitoring. This doc describes
what to watch and how to alert.

## Error monitoring (Sentry)

- Configured via `SENTRY_DSN` (no-op when unset). Both `api` (NestJS) and `web`
  (Next.js) use the Sentry SDKs; source maps are uploaded in CI when
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` secrets are present.
- Uncaught exceptions and unhandled rejections are captured automatically.
- Use `SENTRY_ENVIRONMENT` to separate `production` / `staging` events.
- **Do not** log secrets, tokens, or PII — Sentry captures stack/local vars.

### Recommended Sentry alerts

- New issue opened in `production`.
- Error rate spike (> 1% of transactions over 5m).
- Specific high-value tags: `payout`, `ledger`, `auth` failures.
- Weekly digest of top issues to the on-call channel.

## Health & metrics

- API exposes `GET /api/v1/health` (used by the Docker `HEALTHCHECK` and your
  LB/ingress). Alert when it returns non-200 or latency is high.
- Emit business metrics from key paths (use your APM / Prometheus exporter):
  - Auth success/failure rate (watch for credential-stuffing spikes — see
    `docs/rate-limiting.md`).
  - Impression/click volume and earn rate (fraud signal).
  - Payout request → paid conversion and failure rate.
  - Ledger maturation backlog.

## Infrastructure

- Postgres: connection count, replication lag, disk. Alert near limits.
- Redis: memory, evictions (rate-limit counters must not evict in prod).
- Container/platform: restart count, OOM, CPU/mem saturation.

## Alert routing

- Route to on-call (PagerDuty/Opsgenie/Slack). See
  `docs/ops/incident-response.md` for severity and who pages.

## Dashboards (suggested)

- Error rate by route + environment (Sentry).
- `health` latency p50/p95/p99.
- Payout funnel + ledger backlog (business KPIs).
- Rate-limit 429 counts by bucket (abuse early-warning).

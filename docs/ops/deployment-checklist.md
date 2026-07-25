# Deployment Checklist

Run through this before and after every production deploy.

## Pre-deploy

- [ ] PR reviewed against `docs/CODE_REVIEW_CHECKLIST.md`; CI green (typecheck,
      lint, test, build, **schema drift** check).
- [ ] Migrations present and reviewed; `pnpm db:migrate` produced a clean
      migration (no manual schema edits). Rollback noted in
      `docs/ops/migration-rollback.md`.
- [ ] All new env vars documented in `docs/ENV_REFERENCE.md` and added to the
      secret manager / `.env.example`.
- [ ] `JWT_SECRET` is a real ≥32-char secret (not a placeholder).
- [ ] `REDIS_URL` set (required in production).
- [ ] `NODE_ENV=production`; `ALLOW_MOCK_GOOGLE` / `MOCK_GOOGLE_ENABLED` unset.
- [ ] `TOTP_SECRET_ENCRYPTION_KEY` set in production before MFA/payouts are live.
- [ ] `TRUST_PROXY_HOPS` matches the LB/ingress topology.
- [ ] `BFF_TRUST_PROXY_HOPS` matches the public web proxy topology and is set
      in Vercel; `COOKIE_SECURE` is not `false`.
- [ ] Vercel build variables are configured: `JWT_PUBLIC_KEY`, `JWT_SECRET`,
      `NEXT_PUBLIC_API_URL` or `API_INTERNAL_URL`,
      `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `JWT_ISSUER`, and `JWT_AUDIENCE`.
- [ ] Production positive `ALLOWED_COUNTRIES` and `ALLOWED_CURRENCIES` are
      selected by product/legal and configured in the API secret manager.
- [ ] `WAIT_ATTESTATION_ISSUERS` and
      `VERIFIED_WAIT_ATTESTATION_VERSIONS` reference an independently operated
      provider; `wait.earnings` remains disabled until its launch experiment is
      evidenced.
- [ ] Sentry `SENTRY_DSN` + `SENTRY_ENVIRONMENT` configured; source maps upload
      verified in CI.

## Deploy

- [ ] Deploy DB migrations first (`prisma migrate deploy`) — the API image
      already does this on boot after waiting for Postgres, but run it
      explicitly against the prod `DIRECT_URL` for visibility.
- [ ] Roll out API (web behind it). Use a rolling/canary deploy where possible.
- [ ] Verify `migrate deploy` succeeded and the API started (health 200).

## Post-deploy

- [ ] `GET /api/v1/health` returns 200 across instances.
- [ ] Web root loads; sign-in flow works (real Google, not mock).
- [ ] Sentry received a smoke-test event (if enabled).
- [ ] Key business metrics resuming (impressions, earnings, payouts).
- [ ] No error-rate spike in Sentry / APM.
- [ ] Rollback plan (`docs/ops/rollback.md`) is ready in case of regression.

## Communication

- [ ] Change announced to internal channel if user-facing.
- [ ] On-call aware of the deploy window.

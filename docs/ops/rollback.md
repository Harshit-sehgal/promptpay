# Rollback Procedure

When a deploy misbehaves, roll back safely. The safe order is: **stop the
bad code first, then reconcile data**. Full runbook also at
`docs/ops/rollback-and-deployment.md`.

## 1. Stop / isolate the bad release

- **API/Web (containers):** redeploy the previous image tag, or scale the
  bad revision to 0 and the previous to desired. For compose, **always pass
  `-f` explicitly**:

  ```bash
  docker compose --env-file .env.production \
    -f docs/ops/docker-compose.images.example.yml up -d --force-recreate
  ```

  > ⚠️ **Never run bare `docker compose up` on a deployment host.** Compose
  > auto-loads `docker-compose.override.yml`, which is committed to this repo
  > and is **development-only**: it switches both images to the `build` stage
  > (full source tree + dev dependencies), forces `NODE_ENV=development`,
  > replaces the compiled entrypoint with `pnpm dev`, and turns
  > `ALLOW_MOCK_GOOGLE`/`MOCK_GOOGLE_ENABLED` **on**. Doing this during a
  > rollback would "recover" the incident into a dev server with mock
  > authentication enabled in production. Verified 2026-08-07: bare
  > `docker compose build api` produces the dev image, not the API runtime
  > image (A-093).

- **Feature toggles:** prefer disabling via env (`LAUNCH_SPLIT_ENABLED`,
  `WEBHOOK_ASYNC_PROCESSING`, `PAYOUT_REQUIRE_2FA`) and redeploy — no code
  rollback needed for toggle-bound changes.

## 2. Database migrations — the careful part

Migrations are generally **not** auto-rolled-back in prod. Decide per change:

- **Additive migration only** (new table/column, no constraint break): safe to
  leave applied; rolling back the app code is enough. Old code ignores new
  columns.
- **Destructive / breaking migration** (drop column, type change, rename,
  constraint that old code violates): you must either
  - restore the DB from the pre-deploy backup/snapshot, or
  - ship a corrective migration that re-adds what old code needs.

Never run `prisma migrate reset` or `db push` against production.

## 3. Verify

- `GET /api/v1/health` 200.
- Error rate in Sentry returns to baseline.
- Business metrics (impressions, earnings, payouts) resume normally.
- No orphaned ledger/payout rows from the bad deploy (check
  `docs/ops/ledger-reconciliation-runbook.md`).

## 4. Communicate

- Post in the incident channel (see `docs/ops/incident-response.md`).
- Open a follow-up ticket: root cause + a migration/guard so it can't recur.

## Golden rules

- App code can roll back freely; **schema changes rarely can** — treat
  migrations as one-way unless you shipped a paired down-migration.
- When unsure, restore from backup before forcing a code rollback that now
  mismatches the schema.

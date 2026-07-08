# Database Migration Rollback

How to handle a Prisma migration that needs to be undone in a non-dev
environment. Companion to `docs/ops/rollback.md`.

## Mental model

- `prisma migrate deploy` **applies** migrations; it does not auto-rollback.
- `prisma migrate down` exists but is destructive and **not safe for prod
  data** — use only on throwaway/CI DBs.
- Treat migrations as **one-way** unless you deliberately ship a paired
  down-migration. The safest "rollback" is often a **compensating migration**.

## Option A — Compensating (forward) migration (preferred in prod)

Write a new migration that undoes the effect without destroying data:

- Added a column you don't want? New migration drops it (only if no code reads
  it anymore).
- Wrong default/constraint? New migration `ALTER`s to the intended shape.
- Bad data transform? New migration reverses it (idempotent, re-runnable).

This keeps history linear and is exactly what `migrate deploy` expects.

## Option B — Restore from backup (for destructive/breaking changes)

If the migration dropped data or broke the schema such that old code can't run:

1. Stop the app (or scale to 0) to freeze writes.
2. Restore the pre-deploy snapshot/backup to a new DB (or in place after
   confirming RPO).
3. Repoint `DATABASE_URL`/`DIRECT_URL` at the restored DB.
4. Redeploy the previous app revision (see `docs/ops/rollback.md`).
5. Reconcile any transactions lost in the gap via
   `docs/ops/ledger-reconciliation-runbook.md`.

## Option C — `migrate down` (dev/CI only)

```sh
pnpm --filter @waitlayer/db exec prisma migrate reset --force   # dev only
# or, within a shadow/test DB:
pnpm --filter @waitlayer/db exec prisma migrate down 1 --schema prisma/schema.prisma
```

Never on production data.

## Preventing drift

- CI runs a **schema drift** check (`migrate diff --from-migrations … --exit-code`)
  so a `schema.prisma` change without a matching migration fails the build.
- Always generate migrations with `pnpm db:migrate` (or
  `prisma migrate dev`) and commit them. Do not edit migrations after they've
  been applied to a shared environment — ship a new one instead.
- For pooled DBs (Supabase/Neon), set `DIRECT_URL` to the direct connection so
  `migrate deploy` works.

## Pre-deploy safety checklist

- [ ] Migration is additive when possible.
- [ ] Any destructive step has a documented compensation/restore path.
- [ ] Backup/snapshot taken immediately before applying to prod.
- [ ] Previous app image retained for fast rollback.

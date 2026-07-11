# Troubleshooting

Common issues and how to resolve them.

## Port already in use

**Symptom:** `EADDRINUSE: address already in use :::4002` (or `3000`, `5432`,
`6379`).

- Find the culprit: `lsof -i :4002` (macOS/Linux) or `ss -ltnp | grep 4002`.
- Stop it, or override the port (see `docs/ONBOARDING.md` port table):
  `API_PORT=4102 pnpm --filter waitlayer-api dev`.
- Postgres conflict: use the `test` profile DB on `5433`, or remap the compose
  port: `docker compose run -e ... ` / edit `docker-compose.yml` ports mapping.
- A leftover Docker container may hold the port: `docker ps` + `docker rm -f <id>`.

## Postgres connection refused at API boot

- The API now **waits for Postgres** before migrating (`scripts/wait-for-postgres.mjs`,
  `Dockerfile`). If it times out, check `DATABASE_URL` host/port and that the
  `postgres` service is `service_healthy`.
- Local (non-Docker): is Postgres running? `pg_isready` or
  `psql "$DATABASE_URL" -c 'select 1'`.
- `DIRECT_URL` vs `DATABASE_URL`: pooled URLs (e.g. Supabase/Neon) break
  `prisma migrate`; set `DIRECT_URL` to the direct connection.

## `JWT_SECRET` validation error at startup

`JWT_SECRET must not be a known placeholder` / `must be at least 32 characters`.
Generate a real one: `openssl rand -base64 48`. Never ship the `dev-jwt-secret…`
or `change-me` placeholders to production (config rejects them there).

## `REDIS_URL is required in production`

Production boots reject a missing `REDIS_URL` (required for distributed rate
limiting + brute-force tracking). Set it, or run `NODE_ENV != production` for
local dev (in-memory counters are used when Redis is absent in non-prod).

## Prisma client not found / "did not initialize yet"

Run `pnpm db:generate`. In CI this runs before typecheck/test. If you changed
the schema, regenerate.

## Prisma schema drift (CI failure)

`Assert no migration drift` step fails when `schema.prisma` changes without a
matching migration. Fix: `pnpm db:migrate` to create the migration, commit it,
re-run CI.

## Migrations fail to apply

- Shadow DB issues in CI: ensure the CI Postgres service is healthy before
  `migrate deploy` (it is, via `--health-cmd`).
- Destructive migration blocked by data: create a safe migration (backfill/
  copy) or a documented breaking change (see `docs/ops/migration-rollback.md`).

## Rate limiting / 429s

- Hit auth limits during dev? The `auth-short` bucket is 10 req/min. Use the
  dev override (mock auth) or wait. See `docs/rate-limiting.md`.
- Behind a proxy, set `TRUST_PROXY_HOPS` so limits track the real client IP.

## Web can't reach API

- `NEXT_PUBLIC_API_URL` must point at the API the browser can reach
  (http://localhost:4002/api/v1 locally). CORS allows `WEB_BASE_URL`.
- Mock auth: both `ALLOW_MOCK_GOOGLE` (api) and `NEXT_PUBLIC_ALLOW_MOCK_AUTH`
  (web) must be set in dev.

## Pre-commit hook not running

- `pnpm install` sets up Husky via `prepare`. If hooks didn't install, run
  `pnpm exec husky init` (or `pnpm install` again). Verify `.husky/pre-commit`
  exists and `git config core.hooksPath` points at `.husky/_`.
- Force a run: `pnpm exec lint-staged`.

## Build fails on typecheck

- Ensure `pnpm db:generate` ran (Prisma types). Run `pnpm run typecheck` and
  read the first error — usually a missing generated type or a strict-mode miss.

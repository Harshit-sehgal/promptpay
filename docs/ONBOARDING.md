# Onboarding Guide (New Developers)

Welcome to WaitLayer — a privacy-first reward marketplace for AI wait time and
developer attention. This gets you from clone to a running local stack.

## Prerequisites

- **Node 22+** (the repo pins `engines.node >= 22`). Use `nvm use 22` or your
  version manager.
- **pnpm 11** (repo uses pnpm workspaces). `corepack enable` then
  `corepack prepare pnpm@11 --activate`, or `npm i -g pnpm@11`.
- **Docker + Docker Compose** (for Postgres/Redis, or run them locally).
- **openssl** (for generating secrets).

## 1. Clone & install

```sh
git clone <repo> && cd promptpay
pnpm install            # also sets up Husky pre-commit via the `prepare` script
cp .env.example .env    # then fill JWT_SECRET etc. (see below)
```

Generate required secrets:

```sh
openssl rand -base64 48   # use for JWT_SECRET (>= 32 chars)
```

## 2. Start infrastructure

```sh
docker compose up -d      # postgres (:5432) + redis (:6379) + api (:4002) + web (:3000)
```

This builds the production images. For **hot reload** (mounts source, runs dev
scripts, enables mock Google sign-in), the repo ships `docker-compose.override.yml`
which Compose loads automatically:

```sh
docker compose up         # override is auto-applied -> source-mounted dev servers
```

See `docs/ENV_REFERENCE.md` for every variable and `.env.example` for defaults.

## 3. Database

```sh
pnpm db:generate          # generate Prisma client
pnpm db:migrate           # apply migrations (dev)
# optional: pnpm db:studio
```

The docker-compose `api` service also runs `prisma migrate deploy` on boot and
**waits for Postgres to be ready** before migrating (see `Dockerfile` +
`scripts/wait-for-postgres.mjs`).

## 4. Run locally (without Docker)

```sh
pnpm run dev              # turbo runs api + web dev servers
pnpm run typecheck
pnpm run lint
pnpm run test             # needs DATABASE_URL, REDIS_URL, JWT_SECRET
```

## 5. Try it

- Web: http://localhost:3000
- API health: http://localhost:4002/api/v1/health
- API docs (Swagger): http://localhost:4002/api/v1/docs
- In dev/mock mode you can sign in without a real Google account.

## Port reference & conflicts

| Service | Port | Env override        |
| ------- | ---- | ------------------- |
| Postgres| 5432 | `DATABASE_URL` host/port |
| Redis   | 6379 | `REDIS_URL`         |
| API     | 4002 | `API_PORT`          |
| Web     | 3000 | `WEB_PORT`          |
| Test DB | 5433 | `docker compose --profile test` (isolated) |

**Port conflict?** If a port is taken (e.g. a leftover Postgres on 5432),

- Stop the conflicting process, or
- Override the host port: `POSTGRES_PORT=5433 docker compose up -d postgres`
  (and update `DATABASE_URL` accordingly), or
- Use the `test` profile DB on 5433 for the suite without disturbing dev.

See `docs/TROUBLESHOOTING.md` for more.

## Where things live

- `apps/api` — NestJS API. `apps/web` — Next.js web. `apps/cli`, `apps/vscode-extension`.
- `packages/db` — Prisma schema + migrations. `packages/config` — env validation.
- `packages/shared`, `packages/ui`, `packages/eslint-config`.
- `docs/` — strategy, schema, API spec, runbooks, ADRs (`docs/adr`).

## Next reads

- `docs/CONTRIBUTING.md` — commit + PR conventions.
- `docs/CODE_REVIEW_CHECKLIST.md` — what reviewers check.
- `docs/ENV_REFERENCE.md` — every env var.
- `docs/STYLE_GUIDE.md` — code style.
- `docs/ops/incident-response.md`, `docs/ops/rollback.md` — ops readiness.

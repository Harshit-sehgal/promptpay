# Deployment

Minimal deployment guidance for WaitLayer. The app is containerised; the
`Dockerfile` produces `api` and `web` images (multi-stage). A full runbook
lives at `docs/ops/rollback-and-deployment.md` — this is the quick-start.

## Images

```sh
docker build -t waitlayer-api -t waitlayer-web .   # multi-stage; pick --target api|web
```

Or rely on CI/registry builds. The API image:

1. Installs deps (`pnpm install --frozen-lockfile`).
2. Generates the Prisma client + builds all packages (`turbo run build`).
3. Runtime stage copies built artifacts + node_modules (pruned).
4. On start: **waits for Postgres** (`scripts/wait-for-postgres.mjs`) →
   `prisma migrate deploy` → boots NestJS on `API_PORT`.

## Runtime requirements

- Postgres 16 + Redis 7 (Redis **required in production**).
- All secrets from `docs/ENV_REFERENCE.md` injected via env / secret manager.
  Never ship the docker-compose dev secrets to prod (`JWT_SECRET`,
  `ALLOW_MOCK_GOOGLE`, etc. must be overridden; `NODE_ENV=production`).
- `DATABASE_URL` and (for migrations) `DIRECT_URL` set.
- Sentry optional via `SENTRY_DSN`.

## Docker Compose (single host)

`docker-compose.yml` is a dev/demo reference. For prod, externalise the DB/Redis
or use managed services, and override every secret. A `docker-compose.override.yml`
exists for local hot-reload dev only — do not use it in prod.

## Cloud (AWS / GCP) — sketch

No first-class IaC is committed. A typical target:

- **AWS:** ECS Fargate (api) + Fargate/ALB, RDS Postgres, ElastiCache Redis,
  Secrets Manager for env, CloudWatch for logs/metrics, S3 for static web (or
  CloudFront in front of the Next.js container).
- **GCP:** Cloud Run (api + web) behind Cloud Load Balancing, Cloud SQL
  Postgres, Memorystore Redis, Secret Manager, Cloud Monitoring.

Wire `SENTRY_*` and `DATABASE_URL`/`REDIS_URL` from the secret manager. Set
`TRUST_PROXY_HOPS` to match your LB/ingress (usually `1` for a single ALB/CLB).

## Post-deploy

1. Run `docs/ops/deployment-checklist.md`.
2. Hit `/api/v1/health` (HTTP 200) and the web root.
3. Confirm Sentry receives a test event if `SENTRY_DSN` is set.

# Deployment

Minimal deployment guidance for WaitLayer. The app is containerised; the
`Dockerfile` produces `api` and `web` images (multi-stage). A full runbook
lives at `docs/ops/rollback-and-deployment.md` — this is the quick-start.

## Images

```sh
export WAITLAYER_API_IMAGE=registry.example.com/waitlayer-api:v1.0.0
export WAITLAYER_WEB_IMAGE=registry.example.com/waitlayer-web:v1.0.0
export JWT_PUBLIC_KEY="$(cat jwt-public.pem)"
export JWT_ISSUER="${JWT_ISSUER:-waitlayer}"
export JWT_AUDIENCE="${JWT_AUDIENCE:-waitlayer-client}"
# During rotation only: export JWT_PUBLIC_KEYS="$(cat previous-jwt-public.pem)"
export NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
export NEXT_PUBLIC_WEB_URL=https://app.example.com
export NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

docker build --target api \
  --build-arg JWT_PUBLIC_KEY --build-arg JWT_PUBLIC_KEYS \
  --build-arg JWT_ISSUER --build-arg JWT_AUDIENCE \
  --build-arg NEXT_PUBLIC_API_URL --build-arg NEXT_PUBLIC_WEB_URL \
  --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID \
  -t "$WAITLAYER_API_IMAGE" .
docker build --target web \
  --build-arg JWT_PUBLIC_KEY --build-arg JWT_PUBLIC_KEYS \
  --build-arg JWT_ISSUER --build-arg JWT_AUDIENCE \
  --build-arg NEXT_PUBLIC_API_URL --build-arg NEXT_PUBLIC_WEB_URL \
  --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID \
  -t "$WAITLAYER_WEB_IMAGE" .

docker push "$WAITLAYER_API_IMAGE"
docker push "$WAITLAYER_WEB_IMAGE"
```

Use immutable, registry-protected version tags or image digests. Do not retag a
local `latest` image over the version built above.

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
- `DATABASE_URL` points to a migration-capable production connection.
- The API runtime receives `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, optional
  `JWT_PUBLIC_KEYS`, and `JWT_SECRET`. The web build receives the same public-key
  set plus matching `JWT_ISSUER` / `JWT_AUDIENCE` because Edge middleware is
  compiled at build time. The web runtime receives `JWT_SECRET` for server-side
  BFF identity signing; never bake that symmetric secret into an image.
- Sentry optional via `SENTRY_DSN`.

## Docker Compose (single host)

`docker-compose.yml` and `docker-compose.override.yml` are development-only.
Production uses the standalone image-only example and managed Postgres/Redis:

```sh
docker compose --env-file .env.production \
  -f docs/ops/docker-compose.images.example.yml config --quiet
```

Never layer the production example over the repository root Compose files.

## Cloud (AWS / GCP) — sketch

No first-class IaC is committed. A typical target:

- **AWS:** ECS Fargate (api) + Fargate/ALB, RDS Postgres, ElastiCache Redis,
  Secrets Manager for env, CloudWatch for logs/metrics, S3 for static web (or
  CloudFront in front of the Next.js container).
- **GCP:** Cloud Run (api + web) behind Cloud Load Balancing, Cloud SQL
  Postgres, Memorystore Redis, Secret Manager, Cloud Monitoring.

Wire `SENTRY_*` and `DATABASE_URL`/`REDIS_URL` from the secret manager. Set
`TRUST_PROXY_HOPS` to match your LB/ingress (usually `1` for a single ALB/CLB).

## Vercel web deployment

Vercel deploys the Next.js web/BFF tier only. The NestJS API is a stateful
service with migration startup, Postgres, Redis, background workers, and payout
reconciliation; deploy it to a container platform first and give it a stable
HTTPS origin. Configure these Vercel build/runtime variables:

- `NEXT_PUBLIC_API_URL` and preferably `API_INTERNAL_URL` pointing to that API
- `JWT_PUBLIC_KEY` and optional `JWT_PUBLIC_KEYS` matching the API key set
- `JWT_ISSUER` and `JWT_AUDIENCE` when either differs from its default
- `JWT_SECRET` matching the API BFF-identity secret
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`

The Vercel build preflight rejects missing auth/API configuration. A successful
web build is not a completed deployment until `/api/auth/config` and
`/api/auth/login` reach the API rather than returning 5xx.

## Post-deploy

1. Run `docs/ops/deployment-checklist.md`.
2. Hit API `/api/v1/health/ready`, the web root, and web
   `/api/auth/config` (all HTTP 200).
3. Confirm Sentry receives a test event if `SENTRY_DSN` is set.

# Rollback Plan & Deployment Guide

**Owner:** DevOps / Engineering Lead  
**Scope:** Private beta (Phase 6) through public launch (Phase 7)

---

## 1. Deployment Architecture

```
                      ┌─────────────┐
                      │   DNS/CNAME  │
                      └──────┬──────┘
                             │
              ┌──────────────┴──────────────┐
              │         Load Balancer       │
              │     (Cloudflare / ALB)      │
              └──────────────┬──────────────┘
                             │
              ┌──────────────┴──────────────┐
              │         Docker Host          │
              │  ┌─────────┐ ┌──────────┐   │
              │  │ API     │ │ Web      │   │
              │  │ :4002   │ │ :3000    │   │
              │  └────┬────┘ └──────────┘   │
              │       │                     │
              │  ┌────┴────┐ ┌──────────┐   │
              │  │ Postgres│ │ Redis    │   │
              │  │ :5432   │ │ :6379    │   │
              │  └─────────┘ └──────────┘   │
              └─────────────────────────────┘
```

---

## 2. Prerequisites

### Environment Variables Required

The standalone production Compose example fails interpolation before starting
when a core value is absent. Keep these in `.env.production` or inject them from
the host secret manager; never commit that file.

| Variable                       | Source         | Required In                  |
| ------------------------------ | -------------- | ---------------------------- |
| `DATABASE_URL`                 | Secret manager | API                          |
| `REDIS_URL`                    | Secret manager | API                          |
| `API_BASE_URL`                 | Deploy config  | API, public HTTPS origin     |
| `WEB_BASE_URL`                 | Deploy config  | API, public HTTPS origin     |
| `JWT_PRIVATE_KEY`              | Secret manager | API runtime                  |
| `JWT_PUBLIC_KEY`               | Deploy config  | API + Web build/runtime      |
| `JWT_SECRET`                   | Secret manager | API + Web runtime, 32+ chars |
| `TOTP_SECRET_ENCRYPTION_KEY`   | Secret manager | API, 32+ chars               |
| `PRIVACY_HASH_KEY`             | Secret manager | API, 32+ chars               |
| `EMAIL_QUEUE_SECRET`           | Secret manager | API, 32+ chars               |
| `OPS_ALERT_EMAIL`              | Deploy config  | API                          |
| `EMAIL_FROM`                   | Deploy config  | API, verified sender         |
| `RESEND_API_KEY`               | Secret manager | API                          |
| `GOOGLE_CLIENT_ID`             | Google console | API                          |
| `NEXT_PUBLIC_API_URL`          | Deploy config  | Web build, public HTTPS URL  |
| `NEXT_PUBLIC_WEB_URL`          | Deploy config  | Web build                    |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google console | Web build                    |

`JWT_PUBLIC_KEYS` is optional during rotation, but when present the same set
must reach the API and web build. `JWT_ISSUER` / `JWT_AUDIENCE` default to
`waitlayer` / `waitlayer-client`; custom values must also match on both tiers.
The example fixes `PAYOUT_REQUIRE_2FA=true`, `WEBHOOK_RECLAIM_CRON=true`, and
production email mode. Stripe, PayPal, Wise, and Sentry variables are required
only when the corresponding integration is enabled.

### Docker Images

Build and push to container registry:

```bash
export WAITLAYER_API_IMAGE=registry.example.com/waitlayer-api:v1.0.0
export WAITLAYER_WEB_IMAGE=registry.example.com/waitlayer-web:v1.0.0
export JWT_PUBLIC_KEY="$(cat jwt-public.pem)"
export JWT_ISSUER="${JWT_ISSUER:-waitlayer}"
export JWT_AUDIENCE="${JWT_AUDIENCE:-waitlayer-client}"
# During rotation only: export JWT_PUBLIC_KEYS="$(cat previous-jwt-public.pem)"
export NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
export NEXT_PUBLIC_WEB_URL=https://app.example.com
export NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com

# The API target shares the monorepo build stage with web, so pass the same
# non-secret web verification/build inputs to both targets.
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

Protect version tags from mutation in the registry, or deploy by digest.

---

## 3. Deployment Steps

### 3.1 Single-host in-place deployment

This example recreates one container at a time and can cause a brief
interruption. It is not blue-green. Use an orchestrator or two independently
named stacks behind a load balancer when zero-downtime traffic switching is
required.

```bash
export WAITLAYER_API_IMAGE=registry.example.com/waitlayer-api:v1.0.0
export WAITLAYER_WEB_IMAGE=registry.example.com/waitlayer-web:v1.0.0
export WAITLAYER_COMPOSE=docs/ops/docker-compose.images.example.yml

# 1. Validate the standalone production config, then pull immutable images.
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" config --quiet
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" pull api web

# 2. Run database migrations
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" run --rm api \
  sh /app/docker-entrypoint.sh true

# 3. Recreate API from the pulled image
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" \
  up -d --no-deps api

# 4. Health check
curl -f http://localhost:4002/api/v1/health/ready

# 5. Recreate web from the pulled image
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" \
  up -d --no-deps web

# 6. Verify
curl -f http://localhost:3000
```

### 3.2 Canary Deployment

The standalone Compose example does not implement canaries. With an external
load balancer or orchestrator:

1. Deploy a single API instance with the new version
2. Route 5% of traffic to it via load balancer
3. Monitor Sentry for errors and performance regressions
4. After 15 minutes with no issues, roll out to all instances

### 3.3 RS256 key rotation

Do not switch the API signing key before the running web tier accepts it:

1. Add the new public key to `JWT_PUBLIC_KEYS` while the old pair remains
   primary, build the web image with that set, and deploy web first.
2. Set the API's `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` to the new pair, keep the
   old public key in `JWT_PUBLIC_KEYS`, and deploy API.
3. Build/deploy web with the new key primary and the old key still accepted.
4. Keep the old public key on both tiers for at least `JWT_REFRESH_TTL` (30 days
   by default), then remove it and rebuild web. Waiting only the 15-minute access
   TTL would invalidate dormant refresh sessions.

---

## 4. Rollback Procedures

### 4.1 Application Rollback (Code)

**Trigger:** 500 errors, performance degradation, data integrity issue, security vulnerability

```bash
export WAITLAYER_API_IMAGE=registry.example.com/waitlayer-api:v0.9.9
export WAITLAYER_WEB_IMAGE=registry.example.com/waitlayer-web:v0.9.9
export WAITLAYER_COMPOSE=docs/ops/docker-compose.images.example.yml

# Step 1: pull exactly the last known-good immutable tags.
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" pull api web

# Step 2: recreate both services from the pinned rollback images.
docker compose --env-file .env.production -f "$WAITLAYER_COMPOSE" \
  up -d --no-deps --force-recreate api web

# Step 3: Verify rollback
curl -f http://localhost:4002/api/v1/health/ready
curl -f http://localhost:3000
```

**Rollback target:** under 5 minutes after images are present on the host.

### 4.2 Database Migration Rollback

**Trigger:** Migration error, data loss, schema mismatch

Prisma Migrate has no `migrate down` command. Do not edit an applied migration
or mark a failed migration rolled back unless the database state has been
manually verified. Choose one of these recovery paths:

1. For a compatible defect, ship a new forward-only corrective migration and
   run `pnpm --filter @waitlayer/db migrate:deploy`.
2. For destructive corruption, stop writes and restore the verified backup to
   a new database, run all migrations there, verify financial invariants, then
   switch `DATABASE_URL` atomically.
3. Use `prisma migrate resolve` only to reconcile migration metadata after the
   corresponding SQL state has been inspected and repaired by an operator.

**Note:** Rollback to backup is a last resort. All migrations should be:

- Forward-only (no data-loss operations in reversible migrations)
- Tested against a staging database first
- Reviewed for backward compatibility

### 4.3 Data Recovery

**Trigger:** Accidental data deletion, corruption, or fraud

```bash
# Point-in-time recovery (requires WAL archiving)
pg_restore --clean --if-exists \
  -d "$DATABASE_URL" \
  --jobs=4 \
  backups/pre-incident.dump

# Verify data integrity after restore
pnpm run typecheck  # Ensure schema alignment
pnpm run test       # Run ledger reconciliation tests
```

---

## 5. Monitoring & Alerting

### 5.1 Sentry Alerts

Configure in Sentry dashboard:

| Alert                | Threshold              | Action                     |
| -------------------- | ---------------------- | -------------------------- |
| 5xx errors           | > 1% of requests       | Page on-call engineer      |
| 4xx errors on auth   | > 10% of auth requests | Investigate brute-force    |
| Payout failures      | Any                    | Check PayPal/Stripe status |
| Ledger discrepancy   | Zero earnings          | Check LedgerCronService    |
| DB connection errors | Any                    | Check Postgres health      |

### 5.2 Health Check Endpoints

| Endpoint             | Expected Response                        |
| -------------------- | ---------------------------------------- |
| `GET /api/v1/health` | `{ "status": "ok", "timestamp": "..." }` |
| Docker healthcheck   | Container status `healthy`               |
| DB connection        | Prisma can query                         |

### 5.3 Runbook Access

- Keep this runbook accessible (stored in repository)
- Print abbreviated version for on-call reference
- Update after any infrastructure change

---

## 6. Disaster Recovery

### 6.1 Database Failure

1. Promote read replica to primary (if available)
2. Update `DATABASE_URL` in env
3. Restart API containers
4. Verify data integrity

### 6.2 Redis Failure (Production)

Production startup requires Redis, and readiness reports the dependency as
unavailable during an outage. Some guards may retain per-process fallback
state, but that is not a production availability guarantee and must not be
treated as an acceptable hour-long operating mode.

1. Check Redis connection config
2. Restart Redis container
3. Verify connection from API logs

### 6.3 Complete Outage

1. Restore latest database backup
2. Deploy last known-good Docker images
3. Verify all services are healthy
4. Communicate outage to users
5. Post-mortem within 48 hours

---

## 7. Pre-Launch Checklist

- [ ] All env vars configured and validated
- [ ] Database migrations run on production database
- [ ] Docker images built and pushed
- [ ] SSL certificates valid
- [ ] Sentry DSN configured and test error captured
- [ ] Stripe webhook endpoint configured in Stripe dashboard
- [ ] Health checks passing
- [ ] Rollback procedure tested
- [ ] Database backup verified
- [ ] At least one admin account exists
- [ ] Rate limit thresholds tuned for expected traffic
- [ ] Production dependency audit clean (`pnpm audit --prod`)
- [ ] CI pipeline passing on main branch

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

| Variable                 | Source           | Required In          |
| ------------------------ | ---------------- | -------------------- |
| `DATABASE_URL`           | Infisical / env  | API                  |
| `JWT_SECRET`             | Random 32+ char  | API                  |
| `REDIS_URL`              | Infisical / env  | API (production)     |
| `STRIPE_SECRET_KEY`      | Stripe Dashboard | API                  |
| `STRIPE_WEBHOOK_SECRET`  | Stripe Dashboard | API                  |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard | Web                  |
| `PAYPAL_CLIENT_ID`       | PayPal Developer | API (for PayPayouts) |
| `PAYPAL_CLIENT_SECRET`   | PayPal Developer | API (for PayPayouts) |
| `SENTRY_DSN`             | Sentry           | API + Web            |
| `SENTRY_AUTH_TOKEN`      | Sentry           | CI (source maps)     |
| `NEXT_PUBLIC_API_URL`    | Infisical / env  | Web                  |

### Docker Images

Build and push to container registry:

```bash
# Build images
docker compose build

# Tag with version
docker tag promptpay-api:latest registry.example.com/promptpay-api:v1.0.0
docker tag promptpay-web:latest registry.example.com/promptpay-web:v1.0.0

# Push
docker push registry.example.com/promptpay-api:v1.0.0
docker push registry.example.com/promptpay-web:v1.0.0
```

---

## 3. Deployment Steps

### 3.1 Normal Deployment

```bash
# 1. Pull latest images
docker compose pull

# 2. Run database migrations
 docker compose run --rm api pnpm --filter @waitlayer/db migrate:deploy

# 3. Deploy API (blue-green)
docker compose up -d --no-deps --scale api=2 api

# 4. Health check
 curl -f http://localhost:4002/api/v1/health/ready

# 5. Deploy web
docker compose up -d --no-deps web

# 6. Verify
curl -f http://localhost:3000
```

### 3.2 Canary Deployment

For risky changes:

1. Deploy a single API instance with the new version
2. Route 5% of traffic to it via load balancer
3. Monitor Sentry for errors and performance regressions
4. After 15 minutes with no issues, roll out to all instances

---

## 4. Rollback Procedures

### 4.1 Application Rollback (Code)

**Trigger:** 500 errors, performance degradation, data integrity issue, security vulnerability

```bash
# Step 1: Revert API to previous version
docker compose up -d --no-deps api=registry.example.com/promptpay-api:v1.0.0

# Step 2: Revert Web
docker compose up -d --no-deps web=registry.example.com/promptpay-web:v1.0.0

# Step 3: Verify rollback
 curl -f http://localhost:4002/api/v1/health/ready
curl -f http://localhost:3000
```

**Rollback window:** < 5 minutes (Docker image swap)

### 4.2 Database Migration Rollback

**Trigger:** Migration error, data loss, schema mismatch

```bash
# List recent migrations
pnpm --filter @waitlayer/db migrate status

# Rollback the last migration
pnpm --filter @waitlayer/db migrate down

# If migration was destructive (dropped columns/tables):
# 1. Restore from backup
pg_restore -d "$DATABASE_URL" backups/pre-migration.dump

# 2. Re-apply all subsequent non-destructive migrations
pnpm --filter @waitlayer/db migrate deploy
```

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

**Without Redis:** Rate limiting falls back to in-memory counter.
This is acceptable for short outages (< 1 hour) but rate limits reset
on each API restart.

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

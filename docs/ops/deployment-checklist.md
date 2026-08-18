# Deployment Checklist

Run through this before and after every production deploy.

## First deploy: cold-start order (verified end-to-end 2026-08-07)

These steps are **order-dependent** and the order is not obvious. Verified by
running the whole sequence against an empty database using the shipped image:

| #   | Step                                          | Why the order matters                                                                                                              |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `deploy:preflight` (env only, no `--with-db`) | Catches config/override problems before anything touches the database.                                                             |
| 2   | `prisma migrate deploy`                       | **Creates the schema.** Everything below writes to tables that do not exist yet.                                                   |
| 3   | `bootstrap:env-marker --confirm-stamp`        | Needs `environment_markers`, which step 2 creates. The API will not boot without this row.                                         |
| 4   | `bootstrap:admin`                             | Needs `users`/`admin_users`, which step 2 creates.                                                                                 |
| 5   | Start the API                                 | Its entrypoint re-runs `migrate deploy` (idempotent, advisory-locked).                                                             |
| 6   | Enrol TOTP at **`/admin/security`**           | Until this, every admin write returns 403 (A-099). You will be asked for your password — the API requires a re-auth proof (A-100). |
| 7   | `deploy:preflight --with-db`                  | Now it can verify admin + MFA + switch state.                                                                                      |

> Running step 3 or 4 before step 2 fails with
> `The table public.environment_markers does not exist in the current database`.
> That is the schema being absent, not a broken script.

Steps 5–7 are unnecessary on a redeploy; steps 3 and 4 are one-shot and safely
no-op or refuse on re-run.

The manual `Staging Release Gate` workflow has an
`initial_production_deploy` input for this one cold start. Select it only after
the production environment approval and steps 1–4 above are complete. The
workflow refuses that mode when predecessor containers already exist and
records that automated rollback is unavailable for the first deployment.

## Step −1 — Run the deploy preflight

One command, on the deploy host, with the production environment loaded. It
fails closed on everything below that can be checked mechanically.

```bash
pnpm deploy:doctor                   # secret-safe config diagnosis
pnpm deploy:doctor --with-network    # also probe API health + Redis socket
pnpm deploy:doctor --with-db         # also check migrations + money switches (read-only)
pnpm deploy:preflight                # env/config only — safe before migrations
pnpm deploy:preflight --with-db      # after migrations: probes Postgres/Redis + operator readiness
```

`deploy:doctor` is diagnostic and read-only: it never prints secret values,
creates a checkout, changes a database row, or enables a money switch. It
checks URL contracts, PostgreSQL/Redis URL shape, escaped RS256 key parsing and
pair matching, API/web OAuth ID alignment, Dodo rail consistency, mock-auth and
throttle flags, and production HTTPS requirements. The optional probes are
explicit so a config-only run is safe before networking or migrations are
available.

It checks: the dev-compose override trap (see the warning below), the full
`@waitlayer/config` production schema, `COOKIE_SECURE`, every mock-auth flag,
test-only `THROTTLE_*` overrides, the reference attestation bridge, Postgres
and Redis reachability, unfinished migrations, whether an administrator exists
**and has TOTP enrolled**, and which money switches are live. Exit 0 means
every blocking check passed.

> ⚠️ **Never run bare `docker compose build` / `docker compose up` on a
> deployment host.** Compose auto-loads the committed
> `docker-compose.override.yml`, which is development-only: it switches both
> services to the `build` stage, forces `NODE_ENV=development`, replaces the
> compiled entrypoint with `pnpm dev`, and turns mock Google auth **on**.
> Verified 2026-08-07 (A-093): `docker compose build api` produces an image
> with the full repo source and **no** Prisma CLI — not the API runtime image.
> Always deploy with an explicit `-f docs/ops/docker-compose.images.example.yml`.
> The release workflow additionally requires `.env.staging` on the staging host
> and `.env.production` on the production host, and passes each via
> `--env-file`; neither deployment can auto-load the development override.

## Step 0a — Stamp the database environment marker (A-096)

> **Run `prisma migrate deploy` first.** This writes to `environment_markers`,
> which the migrations create. See the cold-start order table above.

**The API will not start in production without this.**
`EnvironmentMarkerService.verify()` refuses to boot unless `environment_markers`
row 1 exists and matches your `WAITLAYER_ENVIRONMENT_KIND`/`_ID`. Non-production
auto-creates it; production deliberately does not, because auto-stamping would
destroy the interlock — an API accidentally pointed at the wrong database would
simply claim it.

Run once, after `migrate deploy`, against the database you intend to serve:

```bash
DATABASE_URL=<production-url> \
WAITLAYER_ENVIRONMENT_KIND=production \
WAITLAYER_ENVIRONMENT_ID=<your-env-id> \
  pnpm bootstrap:env-marker --confirm-stamp
```

- [ ] Marker stamped and matches the API's configured kind/id.

> If it refuses with "REFUSING TO OVERWRITE", **stop**. Your `DATABASE_URL`
> points at a database already claimed by another environment. That is the
> accident this interlock exists to catch.

## Step 0b — Create the first administrator (A-088)

**Do this once, immediately after the first `migrate deploy`, before anything
else.** Until it is done the deployment is inert: signup refuses privileged
roles by design, so nobody can approve a campaign, flip any of the five
fail-closed money switches, verify a payout account, or process a payout.

```bash
ADMIN_BOOTSTRAP_TOKEN=<secret-from-secret-manager> \
DATABASE_URL=<production-url> \
  pnpm bootstrap:admin --token <same-secret> --email ops@yourdomain.com
# password is prompted (not echoed, stays out of shell history and `ps`)
```

- [ ] Administrator created (`super_admin`, audited as `admin.bootstrap`).
- [ ] **TOTP enrolled for that account.** In production `AdminMfaStepUpGuard`
      rejects every admin `POST/PUT/PATCH/DELETE` unless 2FA is enabled _and_
      recent (`ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS`, default 600s). Skip this and
      every admin action returns 403.
- [ ] `ADMIN_BOOTSTRAP_TOKEN` rotated out of the environment afterwards. The
      script is one-shot and refuses to run again, but do not leave it lying
      around.

> `scripts/enforce-health-metrics.mjs` also creates an admin — a **passwordless**
> one, for CI health probes. It now hard-refuses when `NODE_ENV=production`.
> Never point it at a production database.

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
- [ ] `.env.production` contains every fail-closed value required by
      `docs/ops/docker-compose.images.example.yml`, including the stable
      environment ID, payout encryption/HMAC keys, email secrets, and public
      web configuration.
- [ ] GitHub's production environment contains `PRODUCTION_JWT_PUBLIC_KEY`,
      optional rotation keyset/issuer/audience, `PRODUCTION_API_URL`,
      `PRODUCTION_WEB_URL`, and `PRODUCTION_GOOGLE_CLIENT_ID`. Next.js embeds
      these public values at build time.
- [ ] Release URL secrets use their exact contracts: `STAGING_API_URL` and
      `STAGING_WEB_URL` are HTTPS origins with no trailing slash, while
      `PRODUCTION_API_URL` ends exactly in `/api/v1` and
      `PRODUCTION_WEB_URL` is an HTTPS origin. The release validator rejects
      paths, credentials, loopback hosts, and malformed RSA public keys before
      building an image.
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
- [ ] Roll out the staging-tested, environment-neutral API digest and the
      separately built production web digest. Never retag the staging web image
      for production; its JWT verification key and `NEXT_PUBLIC_*` values are
      staging build inputs.
- [ ] On a Compose host, use
      `docker compose --env-file .env.production -f docs/ops/docker-compose.images.example.yml ...`.
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

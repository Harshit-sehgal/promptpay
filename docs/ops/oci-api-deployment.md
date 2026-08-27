# OCI API deployment (Tailscale Funnel)

How the Ateva API is served from the Oracle Cloud host, and the traps that
cost time the first time round. This replaces the abandoned `waitlayer-api`
setup, which failed for a reason no log made obvious.

## What serves the API

|              |                                                     |
| ------------ | --------------------------------------------------- |
| Host         | `vnic1` — OCI, Ubuntu 22.04, **956 MB RAM**, 2 vCPU |
| Tailscale IP | `100.111.181.4`                                     |
| SSH          | `ssh -i ~/.ssh/server_key ubuntu@100.111.181.4`     |
| Public URL   | `https://vnic1.tail76eb88.ts.net`                   |
| Service      | `ateva-api.service` (systemd, Docker)               |
| Image        | `ateva-api:main`                                    |
| Env          | `/home/ubuntu/promptpay/.env.production`, mode 600  |

## Current operating decision (2026-08-27)

Keep this Funnel endpoint for staging and the private beta. The service is
healthy and the web BFF can reach it, so there is no reason to add ingress
spend while the product remains in this posture. This is **not** a production
front door: before general availability, move the API behind an owned-domain,
stable HTTPS ingress and then update the web build inputs and client-release
contract together. Do not label the current `staging-oci` environment as
production merely because its Funnel URL is publicly reachable.

There is **no public DNS record and no certificate to renew**. Tailscale
Funnel terminates TLS and proxies to `127.0.0.1:4002`:

```bash
sudo tailscale funnel --bg 4002
sudo tailscale funnel status
```

Funnel needs HTTPS certificates enabled for the tailnet. Confirm with
`sudo tailscale cert --cert-file /tmp/t.crt --key-file /tmp/t.key vnic1.tail76eb88.ts.net`
before assuming a Funnel problem is a Funnel problem.

The nginx vhost on port 80 is a leftover from the previous attempt and is not
in the request path. Funnel talks to 4002 directly.

## Building the image

Run from `~/promptpay` on the host, on `main`:

```bash
JWT_PUB=$(grep '^JWT_PUBLIC_KEY=' .env.production | cut -d= -f2-)

sudo docker build \
  --build-arg BUILD_SCOPE=api \
  --build-arg NODE_OPTIONS=--max-old-space-size=1536 \
  --build-arg JWT_PUBLIC_KEY="$JWT_PUB" \
  --target api \
  -t ateva-api:main -f Dockerfile .
```

Expect roughly 15 minutes. The result is about 1.9 GB.

Three arguments are load-bearing, and each one fails differently:

- **`BUILD_SCOPE=api`** builds only `ateva-api` and its dependencies. The
  default builds every workspace, which a 956 MB box cannot finish — the web
  build exhausts it and the kernel kills the process, so the failure arrives
  as an OOM kill rather than a build error.
- **`--target api`** is the stage name. `api-runtime` does not exist and fails
  instantly with `target stage could not be found`.
- **`JWT_PUBLIC_KEY`** is required: the Dockerfile runs
  `RUN test -n "$JWT_PUBLIC_KEY"` and stops there without it. It is a public
  verification key, not a secret, so passing it as a build arg is fine.

## This host cannot sustainably build its own image

It manages it, but only just, and the margin shrinks as the image grows.

Measured mid-build on 2026-08-22, with 4 GB of swap already in place:

```console
%Cpu(s):  3.7 us,  3.7 sy,  1.9 id, 57.4 wa,  33.3 st
Swap:  4095 total  1571 used
```

**57% iowait and 33% steal.** The iowait is swap thrashing — 956 MB of RAM
against a build that wants more. The steal is the hypervisor: an OCI
always-free instance is burstable, and sustained load exhausts its credits, so
a third of the CPU is simply taken away. Together they turn a ~10 minute build
into an hour, and the final export of a 1.9 GB image can sit silent for ten
minutes at a stretch without being stuck.

Swap is what makes it survivable — before it was added the box wedged hard
enough to stop answering SSH and needed a console reboot. Do not remove it.

The durable fix is to stop building here: build in CI or on a normal machine
and ship the image to a registry (`CONTAINER_REGISTRY`, issue #40). Until then,
expect a build to take up to an hour, never run two at once (they thrash each
other and neither finishes), and prefer `BUILD_SCOPE=api` so the web build
never enters the picture.

## Starting it

```bash
sudo systemctl start ateva-api
sudo systemctl status ateva-api
sudo docker logs -f ateva-api
curl -s https://vnic1.tail76eb88.ts.net/api/v1/health
```

The unit refuses to start when `.env.production` is missing **or still
contains `FILL_ME`**. That is deliberate: the previous unit failed its
`ExecStartPre` file test and sat `inactive (dead)` with no explanation, and a
half-filled env is worse than no env — it boots an API pointed at nothing.

The unit references the image by **tag**, not by digest. The previous unit
pinned a `sha256:` that no rebuild could reproduce, so a freshly built image
was invisible to it.

## Environment

`.env.production` is derived from `.env.production.local`. Everything except
these five is already generated:

| Variable         | Source                                            |
| ---------------- | ------------------------------------------------- |
| `DATABASE_URL`   | Supabase, **pooled** (`:6543`, `?pgbouncer=true`) |
| `DIRECT_URL`     | Supabase, **direct** (`:5432`)                    |
| `REDIS_URL`      | Upstash                                           |
| `RESEND_API_KEY` | Resend                                            |
| `EMAIL_FROM`     | A verified sender address                         |

`DIRECT_URL` is not optional. Prisma migrations cannot run through the
transaction pooler; the runtime uses the pooled URL and migrations use the
direct one.

**Use the session pooler for `DIRECT_URL`, not the direct connection.** Supabase
serves direct connections over **IPv6 only** unless the paid IPv4 add-on is
enabled, and this host has no IPv6 route:

```console
$ ip -6 route show default      # empty
$ curl -6 https://ifconfig.co   # no egress
```

It does hold one global IPv6 address, so the failure is not obvious from
`ip addr` alone.

Measured from the host on 2026-08-22:

```console
$ getent ahostsv4 aws-0-ap-northeast-1.pooler.supabase.com
35.79.125.133   52.68.3.1   54.64.190.72          # pooler has real IPv4
$ # tcp/6543 OPEN, tcp/5432 OPEN
$ getent ahostsv4 db.fhczxytpjafqhmvvznqq.supabase.co
                                                  # direct host: no A record
```

Ignore the dashboard's "Transaction pooler uses IPv6 by default" banner — that
is advertising the _dedicated_ IPv4 add-on. The shared pooler resolves to IPv4
and both its ports are reachable from here. The direct host genuinely has no A
record, which is why it is the one endpoint that cannot be used.

The three Supabase endpoints, and which one each variable wants:

| Endpoint           | Port   | Stack | Use for                             |
| ------------------ | ------ | ----- | ----------------------------------- |
| Direct connection  | `5432` | IPv6  | nothing here — unreachable          |
| Transaction pooler | `6543` | IPv4  | `DATABASE_URL` (+ `pgbouncer=true`) |
| Session pooler     | `5432` | IPv4  | `DIRECT_URL` — migrations           |

The session pooler is a full session-mode connection, so migrations run through
it; the transaction pooler is not, which is why it cannot be used for them.
Both pooler URLs use the `postgres.<project-ref>` username, not `postgres`.

## Placing the secrets

`scripts/set-host-secret.sh <VAR>` takes one value from the clipboard, checks it
against the shape that variable must have, and streams it here over stdin —
never in argv, so it stays out of this host's process list, and never printed.
It refuses a pooled URL in `DIRECT_URL` and flags a non-TLS Upstash URL.

Copy the value in the provider's dashboard, then:

```bash
scripts/set-host-secret.sh REDIS_URL
```

The Supabase database password cannot be read back from the dashboard — it
offers only **Reset database password**. Either supply the stored password or
reset it and copy the new one from the connection string shown at that moment.

For Supabase, copy **only the password** and run:

```bash
scripts/set-supabase-urls.sh
```

It composes both URLs — host, ports, the `postgres.<project-ref>` username and
percent-encoding — because those are the parts that get typed wrong once and
then fail hours later. It refuses a whole connection string pasted in place of
a password.

## Set `ATEVA_ENVIRONMENT_ID` before the first successful boot

`EnvironmentMarkerService.verify()` writes a single row — `environment_markers`
id 1 — holding `ATEVA_ENVIRONMENT_KIND` and `ATEVA_ENVIRONMENT_ID`, and on every
later boot it compares the running config against that row and **refuses to
start on a mismatch**. That is the point: it stops a second environment being
pointed at a database that already belongs to another one.

The consequence is that the values are effectively **write-once**. The row is
created by the first boot that gets far enough to reach it, and after that the
only ways to change it are editing the row by hand or wiping the database.

`ATEVA_ENVIRONMENT_ID` is optional and defaults to `local`
(`packages/config/src/index.ts`). Do not rely on that default: a boot that says
nothing stamps its database as `<kind>/local` permanently. Set it deliberately
before the first boot:

```bash
scripts/set-host-secret.sh ATEVA_ENVIRONMENT_ID   # e.g. staging-oci
```

For the current `vnic1` staging host, this step is complete:
`ATEVA_ENVIRONMENT_KIND=staging` and `ATEVA_ENVIRONMENT_ID=staging-oci` are
configured, and the running `ateva-api.service` is healthy. The earlier
Prisma CLI resolution failure that prevented this check has been fixed. For a
new host or database, retain the explicit-ID step above and do not copy the
current marker blindly.

## Verifying before you start

```bash
scripts/verify-host-db.sh
```

This runs the two steps `docker-entrypoint.sh` performs before the API starts,
in the same image against the same env file: `wait-for-postgres.mjs` for
`DATABASE_URL`, then `prisma migrate status` for `DIRECT_URL`. Nothing is
applied.

The second step is the one worth having. A transaction-pooler URL pasted into
`DIRECT_URL` connects and answers a trivial query happily, and fails only when a
migration runs — the pooler is not session-mode, so it cannot hold the advisory
lock `migrate deploy` takes out. `migrate status` exercises the same path
without changing anything.

`packages/db/prisma.config.ts` resolves `DIRECT_URL || DATABASE_URL`, so
migration commands already prefer the direct URL; the runtime client keeps using
`DATABASE_URL`.

Run migrations before the first start:

```bash
DATABASE_URL="$DIRECT_URL" pnpm --filter @ateva/db exec prisma migrate deploy
```

`ATEVA_ENVIRONMENT_KIND=staging` is intentional for now. It keeps the
fail-closed money switches on. Do not promote it to `production` until the
stack is proven end to end.

Pre-rename `WAITLAYER_*` names are still accepted — `applyLegacyEnvAliases` in
`@ateva/config` maps them, and the direct `process.env` read sites fall back
individually. New environments should use `ATEVA_*`.

## The web middleware verifies JWTs itself — with its own copy of the key

The single most dangerous divergence in this deployment, because it fails in a
way that looks like everything working.

`apps/web/src/middleware.ts` does not ask the API whether a session is valid.
It verifies the access token at the edge with `jose`, using `JWT_PUBLIC_KEY`
(plus `JWT_PUBLIC_KEYS` during rotation) **inlined at build time** — Edge
runtime bakes env vars into the bundle, so changing the variable does nothing
until a NEW BUILD runs. Redeploying existing artifacts is not enough.

If that key does not match the key the API signs with, the symptoms are:

- login succeeds, `200`, and all three `__Host-` cookies are set
- `/api/auth/me` through the BFF returns `200` — the API is perfectly happy
- **every protected page 307s straight back to `/auth/login?returnTo=...`**

So the API is healthy, the database is connected, `platform-health` is `ok`,
and the product is unusable for every signed-in user. Observed 2026-08-22:
Vercel's copy was 37 days old and marked _Sensitive_, while the host signed
with a different key.

Diagnosing it takes two requests. Confirm the API accepts the token, then
confirm the edge does not:

```bash
curl -s -c jar -X POST https://ateva.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://ateva.vercel.app' \
  -d '{"email":"...","password":"..."}'

curl -s -b jar -o /dev/null -w '%{http_code}\n' https://ateva.vercel.app/api/auth/me  # 200 = API fine
curl -s -b jar -o /dev/null -w '%{http_code}\n' https://ateva.vercel.app/developer     # 307 = edge rejects
```

`200` then `307` is this bug and nothing else.

The fix is to set `JWT_PUBLIC_KEY` on Vercel to the value in the host's
`.env.production` and **trigger a fresh build**. It is a PUBLIC key, so it does
not need to be marked Sensitive — and marking it so is a trap, because it hides
the one value you most need to compare when this happens.

Keep them in step: whenever the API's signing key changes, the web's
`JWT_PUBLIC_KEY` must change with it and both sides need a new build. Use
`JWT_PUBLIC_KEYS` to carry the old key through a rotation so existing sessions
survive the overlap.

## The web app's side

The web app never calls the API from the browser. It uses `baseURL: '/api'`
and proxies server-side through `apps/web/src/app/api/[...proxy]`, which is
why the CSP's `connect-src 'self'` is correct and does not need the API
origin.

`NEXT_PUBLIC_API_URL` on Vercel must point at the Funnel URL. It is inlined at
**build** time, so changing it requires a new deployment, not a redeploy of
existing artifacts.

Verify the whole path with the app's own health endpoint rather than trusting
that pages render — every static page returns 200 whether or not the API is
reachable:

```bash
curl -s https://ateva.vercel.app/api/platform-health
```

`{"status":"unavailable"}` means the API is not reachable from Vercel.

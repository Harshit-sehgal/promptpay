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
`ip addr` alone — `DATABASE_URL` works (the transaction pooler is IPv4) while
`prisma migrate deploy` hangs against an address the host can never reach.

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

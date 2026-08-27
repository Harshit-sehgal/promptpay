# syntax=docker/dockerfile:1.7

# ── Base Stage: pnpm + dependencies ──
FROM node:22-alpine AS base
# A-075 resilience: install pnpm via npm instead of `corepack prepare` so the
# build respects an optional NPM_REGISTRY build arg and works in networks
# where corepack's hard-coded fetch (registry.npmjs.org) times out. The
# packageManager field in package.json still pins the version; npm installs the
# same pnpm release.
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_VERSION=11.9.0
RUN npm config set registry "$NPM_REGISTRY" \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm --version

WORKDIR /app
ENV CI=true

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY apps/vscode-extension/package.json apps/vscode-extension/

# pnpm 11 blocks packages not in onlyBuiltDependencies from running install
# scripts. The .npmrc config approves esbuild and Prisma packages and carries
# the optional registry override so pnpm install can fall back when the
# default registry is unreachable.
# HUSKY=0 prevents the husky prepare script from failing (no .git in Docker).
#
# The fetch settings exist because this step is the build's only hard external
# dependency and pnpm's defaults are tuned for a fast link. On a slow or
# congested one, individual registry requests were observed taking 36-49s and
# the install died with a bare `fetch failed` after ~7 minutes — no failing
# package named, nothing to retry by hand. Lower concurrency so a narrow link
# is not asked for 16 parallel downloads, and give each request room to finish
# before the retry ladder gives up.
RUN printf 'registry=%s\nonly-built-dependencies=esbuild,@prisma/client,prisma,@prisma/adapter-pg\nconfirm-modules-purge=false\nfetch-timeout=600000\nfetch-retries=5\nfetch-retry-mintimeout=20000\nfetch-retry-maxtimeout=180000\nnetwork-concurrency=8\n' "${NPM_REGISTRY%/}" > .npmrc \
  && HUSKY=0 pnpm install --frozen-lockfile

# ── Build Stage: turbo build all packages ──
FROM base AS build
COPY . .
RUN pnpm --filter @ateva/db run generate
# ── Build-time env for the web (Next.js) image ──────────────────────────
# Next.js inlines the Edge auth environment at *build* time. Supplying these
# only as runtime container env does NOT reach the middleware bundle: protected
# routes then reject valid cookies or validate them against stale defaults.
#
# SECURITY: JWT_PRIVATE_KEY and JWT_SECRET are runtime-only secrets and MUST
# NOT be passed as build arguments. They are injected at container runtime via
# the deployment platform (Docker secrets, env files, or a secrets manager).
# JWT_PUBLIC_KEY/JWT_PUBLIC_KEYS are public verification keys, not secrets,
# and are required at build time so the Edge middleware can verify cookies.
ARG JWT_PUBLIC_KEY
RUN test -n "$JWT_PUBLIC_KEY"
ENV JWT_PUBLIC_KEY=$JWT_PUBLIC_KEY
ARG JWT_PUBLIC_KEYS=
ENV JWT_PUBLIC_KEYS=$JWT_PUBLIC_KEYS
ARG JWT_ISSUER=ateva
ENV JWT_ISSUER=$JWT_ISSUER
ARG JWT_AUDIENCE=ateva-client
ENV JWT_AUDIENCE=$JWT_AUDIENCE
ARG NEXT_PUBLIC_API_URL=http://localhost:4002/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
ARG NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND=production
ENV NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND=$NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND
ARG NEXT_PUBLIC_ALLOW_MOCK_AUTH=
ENV NEXT_PUBLIC_ALLOW_MOCK_AUTH=$NEXT_PUBLIC_ALLOW_MOCK_AUTH
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
# Sentry organization/project identify the build's source-map destination.
# The auth token is deliberately NOT an ARG or ENV: the web build receives it
# through the BuildKit secret mount below, so it cannot persist in an image
# layer or the runtime environment.
ARG SENTRY_ORG=
ENV SENTRY_ORG=$SENTRY_ORG
ARG SENTRY_PROJECT=
ENV SENTRY_PROJECT=$SENTRY_PROJECT
# Build as production so Next.js inlines NODE_ENV='production' into the Edge
# middleware (its production fail-fast paths depend on it) and the web
# prerender does not crash in dev mode (A-001).
ENV NODE_ENV=production
# Optional narrowed build for memory-constrained hosts.
#
# The default builds every workspace, which is what CI and the web image need.
# A 1 GB API host cannot finish that: the web build alone exhausts the box, and
# the failure surfaces as an opaque OOM kill rather than a build error. Passing
# `--build-arg BUILD_SCOPE=api` builds only `ateva-api` and the packages it
# depends on, and `NODE_OPTIONS` lets that host cap the heap
# (`--max-old-space-size=...`) to stay inside its limit.
#
# This started as an untracked edit on the deployment host, which meant the
# only machine that could build the API carried a patch no one else had and no
# rebuild would reproduce. It belongs here.
ARG BUILD_SCOPE=all
ARG NODE_OPTIONS=
ENV NODE_OPTIONS=$NODE_OPTIONS
RUN --mount=type=secret,id=sentry_auth_token \
    if [ -s /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)"; \
    fi; \
    if [ "$BUILD_SCOPE" = "api" ]; then \
      pnpm --filter ateva-api... run build; \
    else \
      pnpm run build; \
    fi

# ── API Runtime ──
# Assembly stage: every step that CREATES files runs here, as root, with the
# pnpm store inherited from `base` (so the --prod install stays offline). The
# runtime stage below then takes the finished tree in ONE ownership-correct
# copy. See A-112.
FROM base AS assemble_api
WORKDIR /app

# Copy node_modules from build (full install; dev deps are stripped below)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Copy API build output
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Postgres-readiness wait script (runs before migrate deploy / start)
COPY --from=build /app/scripts/wait-for-postgres.mjs ./scripts/wait-for-postgres.mjs

# Workspace metadata
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/package.json ./
# The Prisma CLI is a PRODUCTION dependency of packages/db, so it survives the
# `pnpm install --prod` prune below and no global npm install is needed.
#
# It used to be installed with `npm install -g prisma@7.9.0`, which put it
# outside pnpm's control: the workspace `find-my-way: 9.7.0` security override
# could not reach it, so `@prisma/dev` resolved its exact pin of 9.6.0 and the
# image shipped a HIGH CVE that the pnpm tree did not have. Managing the CLI
# through the workspace fixes that at the source.

# Drop devDependencies from the runtime image. `pnpm prune` does NOT prune a
# workspace, so we reinstall production-only from the pnpm store inherited from
# the base stage (offline — the store is already populated). `--ignore-scripts`
# avoids running the inherited @prisma/client postinstall before the CLI is
# wired up; we regenerate the client explicitly below.
RUN HUSKY=0 pnpm install --prod --frozen-lockfile --ignore-scripts

# `--ignore-scripts` also skipped @prisma/engines' postinstall, and that
# postinstall is what DOWNLOADS the ~22 MB schema-engine binary — the npm
# tarball does not contain it. Prisma then fetches it lazily on first use,
# which in a container is `prisma migrate deploy` in the entrypoint: every
# container start pulled 22 MB from Prisma's CDN before the app could boot.
# Cold start went from ~8s to 46s, one run never passed its healthcheck at all
# (272s of failing probes, then "dependency failed to start"), and an image
# like that cannot start on a host without egress to that CDN.
# Fetch it here, once, and fail the build if it is still missing.
COPY --from=build /app/scripts/ensure-prisma-engines.mjs ./scripts/ensure-prisma-engines.mjs
RUN node scripts/ensure-prisma-engines.mjs

# Regenerate the Prisma client for the production dependency set (offline).
# Required because `--ignore-scripts` skipped it above. Run from packages/db and
# via its own bin: Prisma 7 discovers `prisma.config.ts` relative to the working
# directory (A-095), and the local bin needs no PATH or NODE_PATH wiring.
RUN cd packages/db && ./node_modules/.bin/prisma generate

# Entrypoint: wait for Postgres, apply migrations once, then exec the app.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Remove npm from the RUNTIME image. npm ships inside the node:22-alpine base
# and bundles its own dependency tree — `tar`, `sigstore`, `ip-address`,
# `brace-expansion`, `picomatch` — which accounted for 10 of the 11
# CRITICAL/HIGH findings the image scan reported (2 CRITICAL). Verified by
# listing them in a PLAIN node:22-alpine with nothing installed: they live in
# /usr/local/lib/node_modules/npm/node_modules and belong to npm, not to this
# application or to the Prisma CLI.
#
# Nothing at runtime uses npm: the entrypoint runs `node` and `prisma`, and the
# app CMD runs `node`. npm is a BUILD-time tool only (it installs pnpm in the
# base stage and the Prisma CLI above), so it is deleted here — after every
# install has completed — rather than shipped as unreachable attack surface.
#
# pnpm goes with it, for exactly the same reason and by the same argument. The
# first image scan that ever ran reported 0 OS-package findings but 2 node-pkg
# findings (1 CRITICAL, 1 HIGH) in `tar` 7.5.16 — a version that appears
# NOWHERE in pnpm-lock.yaml. It is pnpm's own bundled copy, at
# /usr/local/lib/node_modules/pnpm/dist/node_modules/tar; confirmed by
# installing pnpm 11.9.0 into a plain node:22-alpine and reading its version.
# So an override cannot reach it — the package is not in our dependency graph.
# pnpm is build-time only (it performs the --prod install above; the CMDs run
# `node` directly), so removing it fixes both findings at the source rather
# than suppressing them.

# ── Runtime stage ────────────────────────────────────────────────────────────
# A-112: `RUN chown -R node:node /app` was a measured 1.18 GB layer on a 4.75 GB
# image and the slowest build step — a recursive chown re-touches the inode of
# every file already copied, so overlayfs copies all of them up again.
#
# The obvious fix (put `--chown` on each COPY and delete the recursive chown)
# was tried and BROKE THE CONTAINER: the app booted silent and never served,
# because the steps that run AFTER the copies — the --prod install, the engine
# fetch, `prisma generate` — leave root-owned files that `COPY --chown` cannot
# reach and the recursive chown used to sweep up.
#
# So the tree is assembled first and copied once, afterwards. Every file
# lands node-owned in a single layer, nothing is created after the copy, and
# the assembly stage keeps running as root with the offline pnpm store.
# NOT `FROM base`. `base` carries a full `pnpm install --frozen-lockfile` — a
# 1.73 GB layer of dev dependencies — and layers are additive, so inheriting it
# and then overwriting /app leaves that 1.73 GB in the shipped image forever.
# The runtime stage needs none of it: everything it runs arrives in the single
# COPY below. Measured by the image-size report added alongside A-112, which is
# how this was found at all.
FROM node:22-alpine AS api
# Patch OS packages before installing anything else. The pinned base tag
# lags Alpine's security stream, so a newly published CVE fails the trivy
# gate on a build whose own code has not changed — CVE-2026-14456 (OpenSSL
# denial of service, HIGH) landed exactly that way, with libcrypto3/libssl3
# at 3.5.7-r0 against a 3.5.8-r0 fix. Upgrading here keeps the runtime
# images current without chasing base-image tags.
RUN apk upgrade --no-cache && apk add --no-cache wget
# `base` set this and every previously-shipped image inherited it, so dropping
# it when the runtime stages were rebased was an uncontrolled behaviour change,
# not a cleanup. Libraries commonly branch on CI — some prompt or block when it
# is unset, which is exactly the shape of the failure that followed: migrations
# applied, the entrypoint printed "starting application", and then the Node
# process sat silent with nothing listening. Keep it, so A-113 is purely a size
# change and nothing about the running app differs.
ENV CI=true
WORKDIR /app
COPY --from=assemble_api --chown=node:node /app /app

# npm and pnpm ship in the base image with their own bundled dependency trees
# (npm's was 10 of 11 image findings; pnpm's bundled `tar` 7.5.16 the remaining
# CRITICAL + HIGH). Nothing at runtime uses either — the entrypoint runs `node`
# and the local prisma bin, and the CMD runs `node`. Removed here, in the
# runtime stage, because that is where they would otherwise ship.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /usr/local/lib/node_modules/pnpm /usr/local/bin/pnpm /usr/local/bin/pnpx

USER node

ENV NODE_ENV=production
# A-095 is resolved structurally rather than by NODE_PATH.
# `packages/db/prisma.config.ts` does `import { defineConfig } from
# 'prisma/config'`. When the CLI was installed globally it sat outside Node's
# module-resolution chain, config loading failed, and the CLI fell back to a
# datasource-less config — every containerized boot died on "The datasource.url
# property is required in your Prisma config file". That was patched with
# `ENV NODE_PATH=/usr/local/lib/node_modules`.
# Now that prisma is an ordinary workspace dependency of packages/db, it
# resolves on the normal chain and the NODE_PATH override is gone. Verified:
# `require.resolve('prisma/config')` from packages/db succeeds with no NODE_PATH.
EXPOSE 4002
# 180s start period: the entrypoint applies all migrations before Nest boots,
# and a cold database makes that the slowest part of the first start. Failures
# inside start-period do not count toward --retries.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4002/api/v1/health/ready || exit 1
CMD ["sh", "/app/docker-entrypoint.sh", "node", "apps/api/dist/apps/api/src/main.js"]

# ── Web Runtime ──
# See the api stage for why this is split (A-112).
FROM base AS assemble_web
WORKDIR /app/apps/web

# Copy node_modules from build (full install; dev deps are stripped below)
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages

# Copy web build output
COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/node_modules ./node_modules
COPY --from=build /app/apps/web/public ./public
COPY --from=build /app/apps/web/next.config.* ./
# `next.config.js` does `require('./src/lib/csp.js')` at STARTUP, so the runtime
# image needs that one source file. Without it the container starts, prints
# "Ready", then fails every request with
#   ⨯ Failed to load next.config.js ... Cannot find module './src/lib/csp.js'
# — i.e. the shipped web image could not serve at all. Copy just this file, not
# `src/`, so the runtime image keeps only what it needs. `csp.js` is
# self-contained (no local requires of its own); if next.config ever grows
# another local require, this must grow with it.
COPY --from=build /app/apps/web/src/lib/csp.js ./src/lib/csp.js
COPY --from=build /app/apps/web/package.json ./package.json

# Workspace metadata
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build /app/package.json /app/package.json
# Drop devDependencies (see api stage note). pnpm operates on the workspace root
# at /app and strips dev deps from the hoisted store.
RUN HUSKY=0 pnpm install --prod --frozen-lockfile --ignore-scripts

# ── Runtime stage ────────────────────────────────────────────────────────────
# Same split as the api stage (A-112): assemble as root, then one
# ownership-correct copy so no recursive chown layer is needed.
# See the api stage: NOT `FROM base`, which would bake in a 1.73 GB dev install
# the runtime never uses.
FROM node:22-alpine AS web
# Patch OS packages before installing anything else. The pinned base tag
# lags Alpine's security stream, so a newly published CVE fails the trivy
# gate on a build whose own code has not changed — CVE-2026-14456 (OpenSSL
# denial of service, HIGH) landed exactly that way, with libcrypto3/libssl3
# at 3.5.7-r0 against a 3.5.8-r0 fix. Upgrading here keeps the runtime
# images current without chasing base-image tags.
RUN apk upgrade --no-cache && apk add --no-cache wget
# `base` set this and every previously-shipped image inherited it, so dropping
# it when the runtime stages were rebased was an uncontrolled behaviour change,
# not a cleanup. Libraries commonly branch on CI — some prompt or block when it
# is unset, which is exactly the shape of the failure that followed: migrations
# applied, the entrypoint printed "starting application", and then the Node
# process sat silent with nothing listening. Keep it, so A-113 is purely a size
# change and nothing about the running app differs.
ENV CI=true
WORKDIR /app/apps/web
COPY --from=assemble_web --chown=node:node /app /app

# See the api stage: npm and pnpm ship bundled dependency trees and nothing at
# runtime uses either — the CMD below runs `node` directly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /usr/local/lib/node_modules/pnpm /usr/local/bin/pnpm /usr/local/bin/pnpx

USER node

ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["node", "node_modules/next/dist/bin/next", "start"]

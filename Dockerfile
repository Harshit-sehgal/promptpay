# ── Base Stage: pnpm + dependencies ──
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

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
# scripts. The .npmrc config approves esbuild and Prisma packages.
# HUSKY=0 prevents the husky prepare script from failing (no .git in Docker).
RUN echo 'only-built-dependencies=esbuild,@prisma/client,prisma,@prisma/adapter-pg' > .npmrc \
  && HUSKY=0 pnpm install --frozen-lockfile

# ── Build Stage: turbo build all packages ──
FROM base AS build
COPY . .
RUN pnpm --filter @waitlayer/db run generate
# ── Build-time env for the web (Next.js) image ──────────────────────────
# Next.js inlines `process.env` at *build* time — both JWT_SECRET (used by
# the Edge auth middleware) and every NEXT_PUBLIC_* var (baked into the
# client bundle). Supplying them only as runtime container env (as
# docker-compose.yml used to) does NOT reach the built assets: the middleware
# bakes `undefined` and every protected route redirects to /login (A-083),
# and the client has no API URL. They MUST be build args in production.
# Defaults keep `docker build` from failing locally but MUST be overridden.
ARG JWT_SECRET=dev-only-docker-compose-jwt-secret-at-least-32-char
ENV JWT_SECRET=$JWT_SECRET
ARG NEXT_PUBLIC_API_URL=http://localhost:4002/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=53592884041-8ctl5qb8dm99p9a5e7hf4gthgmgenabl.apps.googleusercontent.com
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
ARG NEXT_PUBLIC_ALLOW_MOCK_AUTH=
ENV NEXT_PUBLIC_ALLOW_MOCK_AUTH=$NEXT_PUBLIC_ALLOW_MOCK_AUTH
ARG NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS=
ENV NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS=$NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
# Build as production so Next.js inlines NODE_ENV='production' into the Edge
# middleware (its production fail-fast paths depend on it) and the web
# prerender does not crash in dev mode (A-001).
ENV NODE_ENV=production
RUN pnpm run build

# ── API Runtime ──
FROM base AS api
RUN apk add --no-cache wget
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
# Install the Prisma CLI globally. It is needed both to (re)generate the
# production Prisma client and to run migrations in the entrypoint. Installing
# it globally keeps it out of node_modules (which is pruned of all dev deps).
RUN npm install -g prisma@7

# Drop devDependencies from the runtime image. `pnpm prune` does NOT prune a
# workspace, so we reinstall production-only from the pnpm store inherited from
# the base stage (offline — the store is already populated). `--ignore-scripts`
# avoids running the inherited @prisma/client postinstall before the CLI is
# wired up; we regenerate the client explicitly below.
RUN HUSKY=0 pnpm install --prod --frozen-lockfile --ignore-scripts

# Regenerate the Prisma client for the production dependency set (offline, using
# the global CLI). Required because `--ignore-scripts` skipped it above and the
# dev `prisma` CLI it would otherwise need was just pruned.
RUN prisma generate --schema packages/db/prisma/schema.prisma

# Entrypoint: wait for Postgres, apply migrations once, then exec the app.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4002/api/v1/health/ready || exit 1
CMD ["sh", "/app/docker-entrypoint.sh", "node", "apps/api/dist/apps/api/src/main.js"]

# ── Web Runtime ──
FROM base AS web
RUN apk add --no-cache wget
WORKDIR /app/apps/web

# Copy node_modules from build (full install; dev deps are stripped below)
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages

# Copy web build output
COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/node_modules ./node_modules
COPY --from=build /app/apps/web/public ./public
COPY --from=build /app/apps/web/next.config.* ./
COPY --from=build /app/apps/web/package.json ./package.json

# Workspace metadata
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build /app/package.json /app/package.json
# Drop devDependencies (see api stage note). pnpm operates on the workspace root
# at /app and strips dev deps from the hoisted store.
RUN HUSKY=0 pnpm install --prod --frozen-lockfile

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["node", "node_modules/next/dist/bin/next", "start"]

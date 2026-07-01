# ── Base Stage: pnpm + dependencies ──
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# ── Build Stage: turbo build all packages ──
FROM base AS build
COPY . .
RUN pnpm run build

# ── API Runtime ──
FROM node:22-alpine AS api
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

# Copy workspace dependency packages (they resolve from node_modules symlinks)
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/db/package.json ./packages/db/package.json
COPY --from=base /app/packages/shared/package.json ./packages/shared/package.json
# Copy built packages (prisma client in node_modules/.prisma)
COPY --from=build /app/packages/db/node_modules/.prisma ./packages/db/node_modules/.prisma
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/db/generated ./packages/db/generated

# Copy API app and its build output
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main"]

# ── Web Runtime ──
FROM node:22-alpine AS web
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/next.config.* ./apps/web/
COPY --from=build /app/apps/web/package.json ./apps/web/package.json

# Workspace packages web depends on
COPY --from=base /app/packages/ui/package.json ./packages/ui/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/package.json

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/web/node_modules/.bin/next", "start"]
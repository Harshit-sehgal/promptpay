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
RUN pnpm --filter @waitlayer/db run generate
RUN pnpm run build

# ── API Runtime ──
FROM node:22-alpine AS api
WORKDIR /app

# Copy pruned production node_modules
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Copy API build output
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Workspace metadata
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

# ── Web Runtime ──
FROM node:22-alpine AS web
WORKDIR /app

# Copy pruned production node_modules
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Copy web build output
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/next.config.* ./apps/web/
COPY --from=build /app/apps/web/package.json ./apps/web/package.json

# Workspace metadata
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "next", "start"]

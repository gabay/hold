# Stage 1: Base image with libc6-compat and pnpm enabled
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Stage 2: Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 3: Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client for alpine binary target
RUN pnpm prisma generate
RUN DATABASE_URL=file:data/hold.db pnpm prisma migrate deploy
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# Stage 4: Production runner
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built standalone folder (bundles only necessary node_modules)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy prisma schema and migrated hold.db for runtime access
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Keep a backup copy of the migrated database to initialize volumes if needed
COPY --from=builder --chown=nextjs:nodejs /app/prisma/data/hold.db ./prisma_template/hold.db

# Copy and set entrypoint script
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
# Note: sqlite file hold.db needs write permissions.
# Mount a persistent volume over /app/prisma/data to persist portfolio transaction records across restarts.
CMD ["node", "server.js"]


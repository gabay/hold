# Stage 1: Build base (contains Node, pnpm, and build tools)
FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Generate Prisma client
RUN pnpm prisma generate
RUN DATABASE_URL=file:hold.db pnpm prisma migrate deploy
RUN NEXT_TELEMETRY_DISABLED=1 pnpm run build

# Stage 2: Production runner
FROM alpine:latest AS runner
RUN apk add --no-cache nodejs libc6-compat openssl upx && \
    upx --best --lzma /usr/bin/node && \
    apk del upx
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1000 node
RUN adduser --system --uid 1000 node

# Copy built standalone folder (bundles only necessary node_modules)
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Copy prisma schema and migrated hold.db for runtime access
COPY --from=builder --chown=node:node /app/prisma ./prisma
# Copy and set entrypoint script
COPY --chown=node:node scripts/docker-entrypoint.sh ./docker-entrypoint.sh

USER node

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

# Stage 1: Build base (contains Node, pnpm, and build tools)
FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Generate Prisma client
COPY prisma prisma
RUN pnpm prisma generate
RUN DATABASE_URL=file:hold_template.db pnpm prisma migrate deploy

# Build project
COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY src src
RUN pnpm build && \
    cp -r .next/static .next/standalone/.next/static

# Stage 2: Production runner
FROM alpine:latest AS runner
RUN apk add --no-cache nodejs libc6-compat openssl upx && \
    upx --best --lzma /usr/bin/node && \
    apk del upx
WORKDIR /app

RUN addgroup --system --gid 1000 node && \
    adduser --system --uid 1000 node && \
    chown node:node /app
USER node:node

# Copy standalone folder (builder populated it with static folder)
COPY --from=builder --chown=node:node /app/.next/standalone .
# Copy prisma schema and migrated hold_template.db for runtime access
COPY --from=builder --chown=node:node /app/prisma prisma
# Copy and set entrypoint script
COPY --chown=node:node public public
COPY --chown=node:node scripts/docker-entrypoint.sh .

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

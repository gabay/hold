# Stage 1: Build Vite + React SPA
FROM node:24-alpine AS web-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY web/ ./
RUN pnpm build

# Stage 2: Build static Go binary with embedded SPA
FROM golang:1.26-alpine AS go-builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/embed.go ./web/embed.go
COPY --from=web-builder /app/dist ./web/dist

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/hold ./cmd/hold

# Stage 3: Minimal Alpine runtime
FROM alpine:latest AS runner
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup --system --gid 1000 hold && \
    adduser --system --uid 1000 --ingroup hold hold && \
    mkdir -p /app/data && \
    chown -R 1000:1000 /app

WORKDIR /app
COPY --from=go-builder --chown=1000:1000 /out/hold /app/hold

USER 1000:1000

EXPOSE 3000
ENV PORT=3000
ENV DATABASE_URL=/app/data/hold.db

ENTRYPOINT ["/app/hold"]

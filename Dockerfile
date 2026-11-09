# Stage 1: Install dependencies and build
# node:22 обязателен для undici@8 (прокси-транспорт Telegram): на node:20
# ProxyAgent/fetch падали с «webidl.util.markAsUncloneable is not a function»
# (подтверждено диагностикой в проде 2026-07-23). Выравнивает прод с dev/CI.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Public env vars are baked into the client bundle at build time
ARG NEXT_PUBLIC_TELEGRAM_BOT_NAME="DelovoyPark_bot"
ENV NEXT_PUBLIC_TELEGRAM_BOT_NAME=$NEXT_PUBLIC_TELEGRAM_BOT_NAME
ARG NEXT_PUBLIC_APP_URL="https://delovoy-park.ru"
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_YANDEX_MAPS_URL="https://yandex.ru/maps/-/CPrFnN9z"
ENV NEXT_PUBLIC_YANDEX_MAPS_URL=$NEXT_PUBLIC_YANDEX_MAPS_URL

# Build provenance — surfaced at runtime via /api/version
ARG GIT_SHA="unknown"
ENV BUILD_GIT_SHA=$GIT_SHA
ARG BUILD_TIME="unknown"
ENV BUILD_TIME=$BUILD_TIME

RUN npm run build

# Clean up build artifacts and caches; drop devDependencies (vitest, eslint,
# playwright, typescript…) — runtime needs only prod deps: prisma CLI for
# migrations, tsx for the bot and seed scripts. The standalone bundle above
# already carries its own traced node_modules.
RUN rm -rf .next/cache .next/turbo && \
    npm prune --omit=dev --no-audit --no-fund && \
    rm -rf /root/.npm

# Stage 2: Minimal production runner
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache su-exec wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production

# Re-declare build provenance ARGs in the runner stage and persist as ENV
ARG GIT_SHA="unknown"
ENV BUILD_GIT_SHA=$GIT_SHA
ARG BUILD_TIME="unknown"
ENV BUILD_TIME=$BUILD_TIME

# --chown на каждом COPY вместо финального `chown -R`: отдельный chown-слой
# дублировал все файлы образа и примерно удваивал его размер.
# Copy standalone Next.js output (includes all runtime deps)
COPY --chown=nextjs:nodejs --from=builder /app/.next/standalone ./
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/prisma ./prisma

# Production node_modules (pruned) for prisma CLI, tsx, bot and seed scripts
COPY --chown=nextjs:nodejs --from=builder /app/node_modules ./node_modules

# Seed and deploy-time scripts
COPY --chown=nextjs:nodejs --from=builder /app/scripts ./scripts
COPY --chown=nextjs:nodejs --from=builder /app/content/legal ./content/legal

# Copy bot sources + shared TS so the same image can run the Telegram bot
# via `npx tsx bot/index.ts` (see docker-compose `bot` service). bot/* imports
# from ../src/lib/* through the @/ TS path alias, so we need src + tsconfig.
COPY --chown=nextjs:nodejs --from=builder /app/bot ./bot
COPY --chown=nextjs:nodejs --from=builder /app/src ./src
COPY --chown=nextjs:nodejs --from=builder /app/tsconfig.json ./tsconfig.json

COPY --chown=nextjs:nodejs --chmod=755 docker-entrypoint.sh ./

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]

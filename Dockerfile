# Stage 1: Install dependencies and build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --only=production && npm ci --only=development

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

RUN npm run build

# Clean up build artifacts and caches to reduce final image size
RUN rm -rf .next/cache .next/turbo /root/.npm

# Stage 2: Minimal production runner
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache su-exec wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production

# Copy standalone Next.js output (includes all runtime deps)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Copy all node_modules for prisma CLI, tsx, and seed script
COPY --from=builder /app/node_modules ./node_modules

# Copy seed script
COPY --from=builder /app/scripts ./scripts

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && \
    chown -R nextjs:nodejs /app

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]

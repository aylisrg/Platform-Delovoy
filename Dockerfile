# Stage 1: Install ALL dependencies (needed for build)
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# Placeholder DATABASE_URL for build (not used at runtime)
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

# Install wget (for healthcheck) and su-exec (for user switching)
RUN apk add --no-cache su-exec wget curl

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Install prisma CLI + tsx + bcryptjs for migrations and seed
COPY package.json ./
RUN npm install --no-save prisma@6 tsx bcryptjs @prisma/client@6

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Copy generated Prisma client from builder (overrides the one from npm install)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy seed script for entrypoint
COPY --from=builder /app/scripts ./scripts

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN chown -R nextjs:nodejs /app

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]

#!/bin/sh
set -e

echo "Applying database schema..."
npx prisma db push --accept-data-loss 2>&1 || echo "Warning: db push failed"

echo "Seeding database (admin user)..."
npx tsx scripts/seed.ts 2>&1 || echo "Warning: seed failed (tsx may not be available)"

echo "Starting Next.js server..."
exec su-exec nextjs node server.js

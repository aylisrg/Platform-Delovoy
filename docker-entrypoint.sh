#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy 2>&1 || echo "Warning: migrations failed (DB may not be ready yet)"

echo "Starting Next.js server..."
exec node server.js

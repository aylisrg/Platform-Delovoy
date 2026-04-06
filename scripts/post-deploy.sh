#!/bin/bash
# Post-deploy: apply migrations and seed admin password
# NOTE: This is now handled by docker-entrypoint.sh automatically.
# This script is kept for manual use only.

echo "Running post-deploy tasks..."

# Apply database schema changes (without --accept-data-loss for safety)
npx prisma db push 2>&1 || echo "prisma db push failed (destructive changes need manual migration)"

# Seed admin user with password
npm run db:seed 2>&1 || echo "seed failed"

echo "Post-deploy complete."

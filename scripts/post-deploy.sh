#!/bin/bash
# Post-deploy: apply migrations and seed admin password
# This runs inside the app container after deployment

echo "Running post-deploy tasks..."

# Apply database schema changes
npx prisma db push --accept-data-loss 2>&1 || echo "prisma db push failed"

# Seed admin user with password
npm run db:seed 2>&1 || echo "seed failed"

echo "Post-deploy complete."

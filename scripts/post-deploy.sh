#!/bin/bash
# Post-deploy: clean Docker, apply migrations, seed admin password
# NOTE: Migrations are now handled by docker-entrypoint.sh automatically.
# This script is kept for manual use and Docker cleanup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 Cleaning Docker system before deploy..."
bash "$SCRIPT_DIR/docker-cleanup.sh" || true

echo ""
echo "Running post-deploy tasks..."

# Apply database schema changes (without --accept-data-loss for safety)
npx prisma db push 2>&1 || echo "prisma db push failed (destructive changes need manual migration)"

# Seed admin user with password
npm run db:seed 2>&1 || echo "seed failed"

echo "Post-deploy complete."

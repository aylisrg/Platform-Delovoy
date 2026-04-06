#!/bin/sh
set -e

echo "=== Delovoy Park — Container Startup ==="

# --- Crash loop protection ---
# If this file exists and was created less than 30s ago, we're in a crash loop
CRASH_MARKER="/tmp/.entrypoint-started"
if [ -f "$CRASH_MARKER" ]; then
    LAST=$(stat -c %Y "$CRASH_MARKER" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    DIFF=$((NOW - LAST))
    if [ "$DIFF" -lt 30 ]; then
        echo "WARNING: Crash loop detected (last start ${DIFF}s ago). Waiting 30s..."
        sleep 30
    fi
fi
touch "$CRASH_MARKER"

# --- 1. Database schema ---
echo "[1/3] Applying database schema..."
if npx prisma db push 2>&1; then
    echo "  Schema applied successfully."
else
    echo "  WARNING: prisma db push failed."
    echo "  If schema changes are destructive, handle migration manually."
    echo "  Starting with existing schema..."
fi

# --- 2. Conditional seed ---
echo "[2/3] Checking if database needs seeding..."
NEEDS_SEED=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.count()
    .then(c => { console.log(c === 0 ? 'yes' : 'no'); return p.\$disconnect(); })
    .catch(() => { console.log('yes'); return p.\$disconnect(); });
" 2>/dev/null || echo "yes")

if [ "$NEEDS_SEED" = "yes" ]; then
    echo "  No users found. Running seed..."
    npx tsx scripts/seed.ts 2>&1 || echo "  Warning: seed failed"
else
    echo "  Database already has data, skipping seed."
fi

# --- 3. Start server ---
echo "[3/3] Starting Next.js server..."
exec su-exec nextjs node server.js

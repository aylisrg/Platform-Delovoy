#!/bin/sh
set -e

echo "=== Delovoy Park — Container Startup ==="

# --- Crash loop protection ---
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

# --- 1. Generate Prisma Client (ensure it matches current schema) ---
echo "[1/4] Generating Prisma Client..."
npx prisma generate 2>&1 || echo "  WARNING: prisma generate failed, using pre-built client."

# --- 2. Database schema sync ---
echo "[2/4] Syncing database schema..."
if npx prisma db push --accept-data-loss 2>&1; then
    echo "  Schema synced successfully."
else
    echo "  WARNING: prisma db push failed."
    echo "  Starting with existing schema..."
fi

# --- 3. Conditional seed ---
echo "[3/4] Checking if database needs seeding..."
NEEDS_SEED=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.count()
    .then(c => { console.log(c === 0 ? 'yes' : 'no'); return p.\$disconnect(); })
    .catch(() => { console.log('yes'); return p.\$disconnect(); });
" 2>/dev/null || echo "skip")

if [ "$NEEDS_SEED" = "yes" ]; then
    echo "  No users found. Running seed..."
    npx tsx scripts/seed.ts 2>&1 || echo "  Warning: seed failed (non-fatal)"
elif [ "$NEEDS_SEED" = "skip" ]; then
    echo "  Could not check seed status, skipping seed."
else
    echo "  Database already has data, skipping seed."
fi

# --- 4. Start server ---
echo "[4/4] Starting Next.js server..."
exec su-exec nextjs node server.js

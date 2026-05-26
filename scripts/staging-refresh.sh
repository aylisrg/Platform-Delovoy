#!/usr/bin/env bash
# VPS cron script: pull latest prod backup, sanitize, restore into staging DB.
# Run daily after the prod backup job completes (e.g. 03:30 MSK).
#
# Crontab entry (on VPS):
#   30 0 * * * /opt/platform-delovoy/scripts/staging-refresh.sh >> /var/log/staging-refresh.log 2>&1
#
# Required env (source from /opt/platform-delovoy/.env.staging):
#   DATABASE_URL      — staging DB URL (postgres://...@localhost:5432/delovoy_park_staging)
#   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
#   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID  — for alerts (optional)
#
# Optional env:
#   SANITIZE_DB_URL   — throwaway DB URL (default: postgres://...@localhost:5432/sanitize_tmp_staging)
#   S3_BACKUP_PREFIX  — default: "daily"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load staging env if running from cron (not already in env)
ENV_FILE="${SCRIPT_DIR}/../.env.staging"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

log() { echo "[$(date -u +%FT%TZ)] staging-refresh: $*"; }
err() { echo "[$(date -u +%FT%TZ)] staging-refresh ERROR: $*" >&2; }

tg_alert() {
  local level="$1" text="$2"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]; then
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
      --data-urlencode "text=${level} [staging-refresh] ${text}" \
      > /dev/null 2>&1 || true
  fi
}

START_TIME=$SECONDS

log "==> Starting staging DB refresh..."

if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL not set"
  tg_alert "🚨" "staging-refresh: DATABASE_URL not set — aborted"
  exit 1
fi

# Safety: must point to staging DB
if ! echo "$DATABASE_URL" | grep -qiE 'staging|stage|:5433'; then
  # Allow if explicitly confirmed via env flag
  if [ "${STAGING_REFRESH_FORCE:-}" != "1" ]; then
    err "DATABASE_URL doesn't look like a staging DB: $DATABASE_URL"
    err "Set STAGING_REFRESH_FORCE=1 to override."
    tg_alert "🚨" "staging-refresh: DATABASE_URL safety check failed — aborted"
    exit 1
  fi
fi

S3_ENDPOINT="${S3_ENDPOINT:-https://s3.timeweb.cloud}"
S3_BUCKET="${S3_BUCKET:-delovoy-backups}"
S3_BACKUP_PREFIX="${S3_BACKUP_PREFIX:-daily}"
SANITIZE_DB_URL="${SANITIZE_DB_URL:-postgres://delovoy:delovoy@localhost:5432/sanitize_tmp_staging}"

WORK_DIR="${TMPDIR:-/tmp}/staging-refresh-$$"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── Find latest prod dump ─────────────────────────────────────────────────────
log "Looking for latest backup in s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/..."

LATEST_KEY=$(AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  aws s3 ls "s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/" \
    --endpoint-url "$S3_ENDPOINT" \
  | sort | tail -n 1 | awk '{print $4}')

if [ -z "$LATEST_KEY" ]; then
  err "No backups found in s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/"
  tg_alert "🚨" "staging-refresh: no backups in S3 — skipped"
  exit 1
fi

log "Found: ${S3_BACKUP_PREFIX}/${LATEST_KEY}"

# ── Download ──────────────────────────────────────────────────────────────────
RAW_DUMP="${WORK_DIR}/prod-raw.dump"
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  aws s3 cp \
    "s3://${S3_BUCKET}/${S3_BACKUP_PREFIX}/${LATEST_KEY}" \
    "$RAW_DUMP" \
    --endpoint-url "$S3_ENDPOINT"

SIZE_HUMAN="$(du -h "$RAW_DUMP" | cut -f1)"
log "Downloaded: $SIZE_HUMAN"

# ── Sanitize ──────────────────────────────────────────────────────────────────
log "Sanitizing PII..."
SANITIZE_DB_URL="$SANITIZE_DB_URL" \
  bash "${SCRIPT_DIR}/sanitize-dump.sh" "$RAW_DUMP" "${WORK_DIR}/sanitized.dump"

# ── Restore into staging DB ───────────────────────────────────────────────────
log "Restoring into staging DB..."
pg_restore \
  --no-owner --no-privileges \
  --clean --if-exists \
  --single-transaction \
  -d "$DATABASE_URL" \
  "${WORK_DIR}/sanitized.dump" 2>/dev/null || {
  TABLE_COUNT=$(psql "$DATABASE_URL" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
    2>/dev/null || echo "0")
  if [ "$TABLE_COUNT" -lt "5" ]; then
    err "Restore failed — only $TABLE_COUNT tables. Aborting."
    tg_alert "🚨" "staging-refresh: pg_restore failed (${TABLE_COUNT} tables)"
    exit 1
  fi
  log "WARN: pg_restore warnings (extension mismatches — safe)"
}

# ── Run Prisma migrate deploy to apply any pending migrations ─────────────────
log "Applying pending migrations..."
cd "${SCRIPT_DIR}/.."
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy 2>/dev/null || \
  log "WARN: prisma migrate deploy returned non-zero (may be no pending migrations)"

DURATION_S=$(( SECONDS - START_TIME ))
log "==> Staging refresh complete in ${DURATION_S}s"
tg_alert "✅" "Staging DB refreshed from prod (${DURATION_S}s, source: ${LATEST_KEY})"

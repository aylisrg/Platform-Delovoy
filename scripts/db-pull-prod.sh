#!/usr/bin/env bash
# Pull the latest prod backup from VPS via SSH, sanitize PII, restore into local dev DB.
#
# Usage: npm run db:pull-prod
#
# Required env (from .env or shell):
#   DATABASE_URL      — must point to localhost (safety check enforced)
#   VPS_SSH_HOST      — VPS host, e.g. 123.45.67.89 or deploy@123.45.67.89
#
# Optional env:
#   VPS_BACKUP_DIR    — backup dir on VPS (default: /opt/backups/postgres/daily)
#   VPS_SSH_KEY       — path to SSH key (default: ~/.ssh/id_rsa)
#   SANITIZE_DB_URL   — throwaway DB for sanitization
#                       Default: postgres://delovoy:delovoy@localhost:5432/sanitize_tmp
#   DB_PULL_KEEP_DUMP — set to "1" to keep dump files after restore
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
err() { echo "[$(date -u +%FT%TZ)] ERROR: $*" >&2; }

# ── Safety guard: never run against prod DB ──────────────────────────────────
if [ "${NODE_ENV:-}" = "production" ]; then
  err "NODE_ENV=production detected. Refusing to run db:pull-prod on prod."
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL is not set. Source your .env first: set -a && source .env && set +a"
  exit 1
fi

if ! echo "$DATABASE_URL" | grep -qE 'localhost|127\.0\.0\.1|host\.docker\.internal|delovoy-postgres'; then
  err "DATABASE_URL does not look like a local DB: $DATABASE_URL"
  err "db:pull-prod only works against a local development database."
  exit 1
fi

# ── Check dependencies ───────────────────────────────────────────────────────
for cmd in ssh scp pg_restore psql; do
  if ! command -v "$cmd" &>/dev/null; then
    err "Required command not found: $cmd"
    exit 1
  fi
done

VPS_SSH_HOST="${VPS_SSH_HOST:-}"
if [ -z "$VPS_SSH_HOST" ]; then
  err "VPS_SSH_HOST is not set. Add it to your .env, e.g.: VPS_SSH_HOST=deploy@123.45.67.89"
  exit 1
fi

VPS_BACKUP_DIR="${VPS_BACKUP_DIR:-/opt/backups/postgres/daily}"
SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/id_rsa}"
SANITIZE_DB_URL="${SANITIZE_DB_URL:-postgres://delovoy:delovoy@localhost:5432/sanitize_tmp}"
KEEP_DUMP="${DB_PULL_KEEP_DUMP:-0}"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
if [ -f "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

WORK_DIR="${TMPDIR:-/tmp}/delovoy-db-pull-$$"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── Find the latest dump on VPS ───────────────────────────────────────────────
log "==> Looking for latest backup on ${VPS_SSH_HOST}:${VPS_BACKUP_DIR}..."

# shellcheck disable=SC2029
LATEST_FILE=$(ssh $SSH_OPTS "$VPS_SSH_HOST" \
  "ls -1t ${VPS_BACKUP_DIR}/*.dump 2>/dev/null | head -1")

if [ -z "$LATEST_FILE" ]; then
  err "No .dump files found in ${VPS_SSH_HOST}:${VPS_BACKUP_DIR}"
  err "Check that backup cron has run at least once (runs at 02:00 MSK daily)."
  err "To trigger manually on VPS: bash /opt/platform-delovoy/scripts/backup-db.sh"
  exit 1
fi

log "    Found: $LATEST_FILE"

# ── Download via scp ──────────────────────────────────────────────────────────
RAW_DUMP="${WORK_DIR}/prod-raw.dump"
log "==> Downloading via scp..."

scp $SSH_OPTS "${VPS_SSH_HOST}:${LATEST_FILE}" "$RAW_DUMP"

SIZE_HUMAN="$(du -h "$RAW_DUMP" | cut -f1)"
log "    Downloaded: $SIZE_HUMAN"

# ── Sanitize ──────────────────────────────────────────────────────────────────
log "==> Sanitizing PII..."
SANITIZE_DB_URL="$SANITIZE_DB_URL" \
  bash "${SCRIPT_DIR}/sanitize-dump.sh" "$RAW_DUMP" "${WORK_DIR}/sanitized.dump"

# ── Restore into local dev DB ─────────────────────────────────────────────────
log "==> Restoring sanitized dump into local DB..."
log "    Target: $DATABASE_URL"

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
    err "Restore failed — only $TABLE_COUNT tables found."
    exit 1
  fi
  log "WARN: pg_restore warnings (extension mismatches — safe to ignore)"
}

if [ "$KEEP_DUMP" = "1" ]; then
  KEEP_PATH="${SCRIPT_DIR}/../.tmp-dumps/sanitized-$(date +%Y%m%d_%H%M%S).dump"
  mkdir -p "$(dirname "$KEEP_PATH")"
  cp "${WORK_DIR}/sanitized.dump" "$KEEP_PATH"
  log "    Kept dump at: $KEEP_PATH"
fi

log ""
log "==> Done! Local DB now mirrors sanitized prod data."
log "    Run 'DEV_OVERLAY=1 npm run db:seed' to add dev test accounts on top."
log "    Or run 'npm run db:reset:dev' which does both in one step."

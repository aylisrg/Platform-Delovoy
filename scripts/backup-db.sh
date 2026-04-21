#!/usr/bin/env bash
# Ежедневный бекап PostgreSQL: локально + S3, с GFS-ротацией и записью в BackupLog.
# Вызывается из scripts/cron-backup.sh раз в сутки в 02:00 MSK.
#
# Обязательные env:
#   DATABASE_URL        — postgres URL для pg_dump
#   S3_ENDPOINT         — https://s3.timeweb.cloud (по умолчанию)
#   S3_BUCKET           — delovoy-backups
#   S3_ACCESS_KEY       — aws-like access key
#   S3_SECRET_KEY       — aws-like secret key
# Опциональные env:
#   BACKUP_DIR          — локальный кэш (по умолчанию /opt/backups/postgres)
#   BACKUP_TYPE         — DAILY (default) | WEEKLY | MONTHLY | MANUAL
#   BACKUP_KIND_DIR     — префикс в S3 (default соответствует BACKUP_TYPE)
#   DB_NAME             — имя БД (default delovoy_park)
#   BACKUP_NOTIFY_ON_SUCCESS — "true"|"false" (default false — TG только на fail)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID — для алертов
#   BACKUPLOG_API_URL   — опционально, POST для записи BackupLog через приложение
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
DB_NAME="${DB_NAME:-delovoy_park}"
BACKUP_TYPE="${BACKUP_TYPE:-DAILY}"
S3_ENDPOINT="${S3_ENDPOINT:-https://s3.timeweb.cloud}"
S3_BUCKET="${S3_BUCKET:-delovoy-backups}"
NOTIFY_ON_SUCCESS="${BACKUP_NOTIFY_ON_SUCCESS:-false}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# Map type → subdir
case "$BACKUP_TYPE" in
  DAILY)         SUBDIR="daily";;
  WEEKLY)        SUBDIR="weekly";;
  MONTHLY)       SUBDIR="monthly";;
  PRE_MIGRATION) SUBDIR="pre-migration";;
  MANUAL)        SUBDIR="manual";;
  *)             SUBDIR="daily";;
esac
SUBDIR="${BACKUP_KIND_DIR:-$SUBDIR}"

LOCAL_SUBDIR="${BACKUP_DIR}/${SUBDIR}"
BACKUP_FILE="${LOCAL_SUBDIR}/${DB_NAME}_${BACKUP_TYPE}_${TIMESTAMP}.dump"
S3_KEY="${SUBDIR}/${DB_NAME}_${BACKUP_TYPE}_${TIMESTAMP}.dump"
S3_URI="s3://${S3_BUCKET}/${S3_KEY}"

mkdir -p "$LOCAL_SUBDIR"

log() {
  echo "[$(date -u +%FT%TZ)] $*"
}

tg_alert() {
  local level="$1"
  local text="$2"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]; then
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
      --data-urlencode "text=${level} [$(hostname)] ${text}" \
      --data-urlencode "parse_mode=HTML" \
      > /dev/null 2>&1 || true
  fi
}

insert_backup_log() {
  local status="$1"
  local size_bytes="$2"
  local storage_path="$3"
  local error="${4:-}"
  local duration_ms="${5:-NULL}"

  # Primary path: record via Postgres directly (cheap, no HTTP)
  local error_sql="NULL"
  if [ -n "$error" ]; then
    # Escape single quotes for SQL
    error_sql="'$(printf '%s' "$error" | sed "s/'/''/g")'"
  fi

  local storage_sql="NULL"
  if [ -n "$storage_path" ]; then
    storage_sql="'$(printf '%s' "$storage_path" | sed "s/'/''/g")'"
  fi

  local size_sql="NULL"
  if [ -n "$size_bytes" ] && [ "$size_bytes" != "0" ]; then
    size_sql="$size_bytes"
  fi

  local uuid
  uuid="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)"

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    INSERT INTO \"BackupLog\" (
      \"id\", \"type\", \"status\", \"sizeBytes\", \"storagePath\",
      \"durationMs\", \"error\", \"createdAt\", \"completedAt\"
    ) VALUES (
      '${uuid}', '${BACKUP_TYPE}', '${status}', ${size_sql}, ${storage_sql},
      ${duration_ms}, ${error_sql}, NOW(), NOW()
    );
  " > /dev/null 2>&1 || log "WARN: failed to INSERT BackupLog (DB unreachable?)"
}

log "Starting ${BACKUP_TYPE} backup of ${DB_NAME}…"
START_TIME=$SECONDS

# --- Dump ---
if ! pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=custom -Z 9 -f "$BACKUP_FILE"; then
  ERR_MSG="pg_dump failed for ${DB_NAME}"
  log "ERROR: $ERR_MSG"
  tg_alert "🚨 CRITICAL:" "Бекап ${BACKUP_TYPE} БД ${DB_NAME} упал на pg_dump"
  insert_backup_log "FAILED" "0" "" "$ERR_MSG"
  exit 1
fi

SIZE_BYTES="$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")"
SIZE_HUMAN="$(du -h "$BACKUP_FILE" | cut -f1)"
log "Dump created: $BACKUP_FILE ($SIZE_HUMAN)"

# --- S3 upload ---
# Outcome:
#   S3_UPLOADED=true  → status=SUCCESS, storage_path=s3://…
#   S3_UPLOADED=false, S3 configured + upload attempted + failed → status=PARTIAL,
#                      storage_path=local dump, TG warning (данные только на VPS)
#   S3_UPLOADED=false, S3 creds missing → status=SUCCESS (S3 feature disabled
#                      by config — не deployment failure), storage_path=local
S3_UPLOADED=false
S3_ATTEMPTED=false
S3_ERROR=""
if command -v aws >/dev/null 2>&1 && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ]; then
  S3_ATTEMPTED=true
  if AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
     AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
     aws s3 cp "$BACKUP_FILE" "$S3_URI" \
       --endpoint-url "$S3_ENDPOINT" \
       --quiet; then
    log "Uploaded to $S3_URI"
    S3_UPLOADED=true
  else
    S3_ERROR="aws s3 cp exited non-zero (endpoint=${S3_ENDPOINT}, bucket=${S3_BUCKET})"
    log "WARN: S3 upload failed — keeping local copy; marking backup PARTIAL"
    tg_alert "⚠️ WARNING:" "Backup created locally but S3 upload failed; status=PARTIAL (данные на VPS, в S3 отсутствуют)"
  fi
else
  log "WARN: aws CLI or S3 creds missing — skipping S3 upload"
fi

STORAGE_PATH="$BACKUP_FILE"
if [ "$S3_UPLOADED" = "true" ]; then
  STORAGE_PATH="$S3_URI"
fi

# Determine final status: PARTIAL only if we actually tried S3 and failed.
if [ "$S3_ATTEMPTED" = "true" ] && [ "$S3_UPLOADED" = "false" ]; then
  FINAL_STATUS="PARTIAL"
  FINAL_ERROR="$S3_ERROR"
else
  FINAL_STATUS="SUCCESS"
  FINAL_ERROR=""
fi

# --- GFS rotation (only for DAILY runs) ---
if [ "$BACKUP_TYPE" = "DAILY" ]; then
  DOW="$(date +%u)"   # 1=Mon … 7=Sun
  DOM="$(date +%d)"

  # Weekly copy on Sundays
  if [ "$DOW" = "7" ]; then
    WEEKLY_DIR="${BACKUP_DIR}/weekly"
    mkdir -p "$WEEKLY_DIR"
    cp "$BACKUP_FILE" "${WEEKLY_DIR}/$(basename "$BACKUP_FILE")" || true
    log "Weekly copy created"
  fi

  # Monthly copy on day 01
  if [ "$DOM" = "01" ]; then
    MONTHLY_DIR="${BACKUP_DIR}/monthly"
    mkdir -p "$MONTHLY_DIR"
    cp "$BACKUP_FILE" "${MONTHLY_DIR}/$(basename "$BACKUP_FILE")" || true
    log "Monthly copy created"
  fi

  # Retention: 7d daily, 28d weekly, 90d monthly (locally). S3 lifecycle handles remote.
  find "${BACKUP_DIR}/daily"   -name "*.dump" -mtime +7  -delete 2>/dev/null || true
  find "${BACKUP_DIR}/weekly"  -name "*.dump" -mtime +28 -delete 2>/dev/null || true
  find "${BACKUP_DIR}/monthly" -name "*.dump" -mtime +90 -delete 2>/dev/null || true
fi

DURATION_MS=$(( (SECONDS - START_TIME) * 1000 ))
insert_backup_log "$FINAL_STATUS" "$SIZE_BYTES" "$STORAGE_PATH" "$FINAL_ERROR" "$DURATION_MS"

if [ "$FINAL_STATUS" = "PARTIAL" ]; then
  log "Backup completed with status=PARTIAL (${DURATION_MS}ms, ${SIZE_HUMAN}) — local only, S3 missing"
else
  log "Backup completed successfully (${DURATION_MS}ms, ${SIZE_HUMAN})"
  if [ "$NOTIFY_ON_SUCCESS" = "true" ]; then
    tg_alert "✅" "Бекап ${BACKUP_TYPE} ok — ${SIZE_HUMAN} → ${STORAGE_PATH}"
  fi
fi

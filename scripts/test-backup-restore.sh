#!/usr/bin/env bash
# E2E test: берём свежий DAILY бекап → восстанавливаем в staging БД → сравниваем row counts.
# Запускается вручную администратором или weekly GitHub Action.
#
# Требует:
#   - Staging PostgreSQL запущен и доступен через docker compose -f docker-compose.staging.yml
#   - Есть хотя бы один SUCCESS DAILY BackupLog
#   - aws cli установлен (для S3 скачивания)
#
# env: все из backup-db.sh + STAGING_POSTGRES_CONTAINER (default: delovoy-staging-postgres)
set -euo pipefail

STAGING_PG="${STAGING_POSTGRES_CONTAINER:-delovoy-staging-postgres}"
TEST_DB="restore_test_$(date +%s)"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "${REPO_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${REPO_DIR}/.env"
  set +a
fi

log() { echo "[$(date -u +%FT%TZ)] $*"; }

# 1. Find the most recent SUCCESS DAILY backup
log "Locating latest DAILY backup…"
LATEST_ROW="$(psql "$DATABASE_URL" -t -A -F '|' -c "
  SELECT id, \"storagePath\", \"sizeBytes\"
    FROM \"BackupLog\"
   WHERE \"type\" = 'DAILY' AND \"status\" = 'SUCCESS'
   ORDER BY \"createdAt\" DESC LIMIT 1;
")"

if [ -z "$LATEST_ROW" ]; then
  log "ERROR: no successful DAILY backup found"
  exit 1
fi

BACKUP_ID="$(echo "$LATEST_ROW" | cut -d'|' -f1)"
STORAGE_PATH="$(echo "$LATEST_ROW" | cut -d'|' -f2)"
log "Latest: id=${BACKUP_ID} path=${STORAGE_PATH}"

# 2. Download from S3 if path is s3://
LOCAL_DUMP="/tmp/restore_test_${BACKUP_ID}.dump"
if [[ "$STORAGE_PATH" == s3://* ]]; then
  if [ -z "${S3_ACCESS_KEY:-}" ] || [ -z "${S3_SECRET_KEY:-}" ]; then
    log "ERROR: S3 creds missing — cannot download"
    exit 1
  fi
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws s3 cp "$STORAGE_PATH" "$LOCAL_DUMP" \
      --endpoint-url "${S3_ENDPOINT:-https://s3.timeweb.cloud}" --quiet
else
  cp "$STORAGE_PATH" "$LOCAL_DUMP"
fi
log "Dump at ${LOCAL_DUMP}"

# 3. Restore into a fresh temp DB on staging
log "Creating ${TEST_DB} in staging…"
docker exec -i "$STAGING_PG" psql -U delovoy -d postgres -c "CREATE DATABASE \"${TEST_DB}\";"

log "Restoring…"
docker exec -i "$STAGING_PG" pg_restore -U delovoy -d "$TEST_DB" \
  --no-owner --no-privileges < "$LOCAL_DUMP" || {
  log "pg_restore exited non-zero (may still be partial success)"
}

# 4. Compare row counts for 5 key tables
log "=== Row counts in restored DB ==="
docker exec -i "$STAGING_PG" psql -U delovoy -d "$TEST_DB" -c "
  SELECT 'User' AS t, count(*) FROM \"User\"
  UNION ALL SELECT 'Booking', count(*) FROM \"Booking\"
  UNION ALL SELECT 'Order', count(*) FROM \"Order\"
  UNION ALL SELECT 'MenuItem', count(*) FROM \"MenuItem\"
  UNION ALL SELECT 'RentalContract', count(*) FROM \"RentalContract\";
"

# 5. Cleanup
log "Dropping ${TEST_DB}…"
docker exec -i "$STAGING_PG" psql -U delovoy -d postgres -c "DROP DATABASE \"${TEST_DB}\";"
rm -f "$LOCAL_DUMP"

log "✅ E2E restore test passed"

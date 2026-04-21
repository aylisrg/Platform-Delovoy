#!/usr/bin/env bash
# Pre-migration hook — ОБЯЗАТЕЛЬНО запускается перед prisma migrate deploy.
# Exit code 0 только при успешном дампе + загрузке в S3 + записи в BackupLog.
# Любой fail → миграция должна быть заблокирована.
#
# Использование:
#   npm run db:migrate:prod                 — локально (dev→prod)
#   .github/workflows/_run-migration.yml    — в CI как отдельный job
#
# env:
#   DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY — см. backup-db.sh
#   MIGRATION_TAG — tag для привязки (из $npm_package_version или git ref)
set -euo pipefail

MIGRATION_TAG="${MIGRATION_TAG:-${1:-manual-$(date +%Y%m%d%H%M%S)}}"
export BACKUP_TYPE="PRE_MIGRATION"
export BACKUP_KIND_DIR="pre-migration"
# Force notify on success so Telegram записывает "pre-migration dump ok"
export BACKUP_NOTIFY_ON_SUCCESS="true"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[pre-migration] Starting mandatory pre-migration backup — tag=${MIGRATION_TAG}"

if ! "${SCRIPT_DIR}/backup-db.sh"; then
  echo "[pre-migration] ❌ BACKUP FAILED — миграция заблокирована" >&2
  exit 2
fi

# Patch the most-recent PRE_MIGRATION BackupLog row with migrationTag
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -c "
    UPDATE \"BackupLog\"
       SET \"migrationTag\" = '$(printf '%s' "$MIGRATION_TAG" | sed "s/'/''/g")'
     WHERE id = (
       SELECT id FROM \"BackupLog\"
        WHERE \"type\" = 'PRE_MIGRATION' AND \"status\" = 'SUCCESS'
        ORDER BY \"createdAt\" DESC LIMIT 1
     );
  " > /dev/null 2>&1 || true
fi

echo "[pre-migration] ✅ Pre-migration backup succeeded — миграция разрешена"

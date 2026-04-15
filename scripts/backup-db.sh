#!/bin/bash
# Ежедневный бэкап PostgreSQL с ротацией
# Cron: 0 3 * * * /path/to/scripts/backup-db.sh
#
# Переменные окружения:
#   DATABASE_URL — URL подключения к PostgreSQL
#   BACKUP_DIR  — директория для бэкапов (по умолчанию /backups/postgres)
#   RETENTION_DAYS — сколько дней хранить (по умолчанию 30)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID — для алертов при ошибке
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
DB_NAME="${DB_NAME:-delovoy_park}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/daily/${DB_NAME}_${TIMESTAMP}.sql.gz"
MONTHLY_DIR="${BACKUP_DIR}/monthly"

# Создаём директории
mkdir -p "${BACKUP_DIR}/daily" "$MONTHLY_DIR"

echo "[$(date)] Starting backup of ${DB_NAME}..."

# Выполняем бэкап
if pg_dump "${DATABASE_URL:-}" --no-owner --no-privileges | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date)] Backup created: $BACKUP_FILE ($SIZE)"
else
  echo "[$(date)] ERROR: Backup failed!"
  # Telegram alert
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_ADMIN_CHAT_ID}" \
      -d text="🔴 CRITICAL: Бэкап PostgreSQL не удался! Сервер: $(hostname), время: $(date)" \
      > /dev/null 2>&1 || true
  fi
  exit 1
fi

# Копируем первый бэкап месяца в monthly
DAY_OF_MONTH=$(date +%d)
if [ "$DAY_OF_MONTH" = "01" ]; then
  cp "$BACKUP_FILE" "${MONTHLY_DIR}/${DB_NAME}_monthly_${TIMESTAMP}.sql.gz"
  echo "[$(date)] Monthly backup created"
  # Удаляем monthly старше 12 месяцев
  find "$MONTHLY_DIR" -name "*.sql.gz" -mtime +365 -delete 2>/dev/null || true
fi

# Ротация: удаляем дневные бэкапы старше RETENTION_DAYS
DELETED=$(find "${BACKUP_DIR}/daily" -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print 2>/dev/null | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] Rotated $DELETED old backup(s)"
fi

echo "[$(date)] Backup completed successfully"

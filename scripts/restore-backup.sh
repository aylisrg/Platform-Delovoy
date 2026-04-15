#!/bin/bash
# Восстановление PostgreSQL из бэкапа
# Использование: ./scripts/restore-backup.sh /backups/postgres/daily/delovoy_park_20260414_030000.sql.gz
set -euo pipefail

BACKUP_FILE="${1:-}"
DB_NAME="${DB_NAME:-delovoy_park}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Использование: $0 <path-to-backup.sql.gz>"
  echo ""
  echo "Доступные бэкапы:"
  ls -lh /backups/postgres/daily/*.sql.gz 2>/dev/null | tail -10 || echo "  (нет бэкапов)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Файл не найден: $BACKUP_FILE"
  exit 1
fi

echo "⚠️  ВНИМАНИЕ: Это восстановит базу ${DB_NAME} из бэкапа:"
echo "  $BACKUP_FILE"
echo "  Все текущие данные будут перезаписаны!"
echo ""
read -p "Продолжить? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Отменено."
  exit 0
fi

echo "[$(date)] Восстанавливаем из $BACKUP_FILE..."

# Восстановление
gunzip -c "$BACKUP_FILE" | psql "${DATABASE_URL:-}" --single-transaction

echo "[$(date)] Восстановление завершено успешно!"
echo "Проверьте данные: psql ${DATABASE_URL:-} -c 'SELECT count(*) FROM \"Booking\"'"

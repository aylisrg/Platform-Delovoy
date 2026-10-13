#!/bin/bash
# Восстановление PostgreSQL из бэкапа (issue #590).
#
# backup-db.sh пишет дампы в custom-формате (pg_dump --format=custom, *.dump),
# их восстанавливает только pg_restore. Старый вариант скрипта делал
# `gunzip | psql` и искал *.sql.gz, поэтому на реальных бэкапах не работал.
# Legacy *.sql.gz / *.sql по-прежнему поддерживаются через psql.
#
# Использование:
#   ./scripts/restore-backup.sh /opt/backups/postgres/daily/delovoy_park_DAILY_20260421_020000.dump
#
# env:
#   DB_NAME       — целевая БД (default: delovoy_park)
#   DATABASE_URL  — если задан и есть pg_restore/psql на хосте, работаем напрямую
#   PG_CONTAINER  — контейнер Postgres для docker-режима (default: delovoy-postgres)
#   DB_USER       — пользователь в docker-режиме (default: delovoy)
#   FORCE_DOCKER_PG=1 — принудительно docker exec
#   ASSUME_YES=1  — без интерактивного подтверждения (для тестов/автоматизации)
set -euo pipefail

BACKUP_FILE="${1:-}"
DB_NAME="${DB_NAME:-delovoy_park}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
PG_CONTAINER="${PG_CONTAINER:-delovoy-postgres}"
DB_USER="${DB_USER:-delovoy}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Использование: $0 <path-to-backup.dump|.sql.gz>"
  echo ""
  echo "Доступные бэкапы:"
  ls -lh "${BACKUP_DIR}"/daily/*.dump 2>/dev/null | tail -10 || echo "  (нет бэкапов)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Файл не найден: $BACKUP_FILE"
  exit 1
fi

# Формат определяем по содержимому, а не по имени: custom-дамп начинается с "PGDMP".
if [ "$(head -c 5 "$BACKUP_FILE")" = "PGDMP" ]; then
  FORMAT="custom"
elif gzip -t "$BACKUP_FILE" 2>/dev/null; then
  FORMAT="sql.gz"
else
  FORMAT="sql"
fi

# Тот же выбор режима, что в backup-db.sh: на VPS-хосте клиента Postgres нет.
if [ -n "${DATABASE_URL:-}" ] && command -v pg_restore > /dev/null 2>&1 && [ -z "${FORCE_DOCKER_PG:-}" ]; then
  PG_MODE="direct"
else
  PG_MODE="docker"
fi

echo "⚠️  ВНИМАНИЕ: Это восстановит базу ${DB_NAME} из бэкапа:"
echo "  $BACKUP_FILE (формат: ${FORMAT}, режим: ${PG_MODE})"
echo "  Все текущие данные будут перезаписаны!"
echo "  Сначала сделайте страховочный бэкап: ./scripts/backup-db.sh"
echo ""
if [ "${ASSUME_YES:-}" != "1" ]; then
  read -r -p "Продолжить? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Отменено."
    exit 0
  fi
fi

echo "[$(date)] Восстанавливаем из $BACKUP_FILE..."

run_restore() {
  case "$FORMAT" in
    custom)
      if [ "$PG_MODE" = "direct" ]; then
        pg_restore -d "$DATABASE_URL" --no-owner --no-privileges --clean --if-exists \
          --single-transaction --exit-on-error "$BACKUP_FILE"
      else
        docker exec -i "$PG_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" \
          --no-owner --no-privileges --clean --if-exists \
          --single-transaction --exit-on-error < "$BACKUP_FILE"
      fi
      ;;
    sql.gz|sql)
      local reader="cat"; [ "$FORMAT" = "sql.gz" ] && reader="gunzip -c"
      if [ "$PG_MODE" = "direct" ]; then
        $reader "$BACKUP_FILE" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction
      else
        $reader "$BACKUP_FILE" | docker exec -i "$PG_CONTAINER" \
          psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --single-transaction
      fi
      ;;
  esac
}

run_restore

echo "[$(date)] Восстановление завершено успешно!"
echo "Проверьте данные и применённые миграции:"
echo "  SELECT count(*) FROM \"Booking\";"
echo "  npx prisma migrate status"

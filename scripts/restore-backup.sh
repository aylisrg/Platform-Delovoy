#!/bin/bash
# Восстановление PostgreSQL из бэкапа (issue #590).
#
# backup-db.sh пишет дампы в custom-формате (pg_dump --format=custom, *.dump),
# их восстанавливает только pg_restore. Старый вариант скрипта делал
# `gunzip | psql` и искал *.sql.gz, поэтому на реальных бэкапах не работал.
# Legacy *.sql.gz / *.sql по-прежнему поддерживаются через psql.
#
# Использование:
#   DB_NAME=delovoy_park ./scripts/restore-backup.sh /opt/backups/postgres/daily/delovoy_park_DAILY_20260421_020000.dump
#
# Цель восстановления задаётся ЯВНО: DATABASE_URL (direct) или DB_NAME (docker).
# Значения по умолчанию для цели нет, чтобы случайно не перезаписать прод.
# Перед восстановлением всегда делается страховочный бэкап цели
# (SAFETY_BACKUP_DIR, default: $BACKUP_DIR/pre-restore). Если он не удался,
# восстановление не начинается.
#
# env:
#   DB_NAME       — целевая БД в docker-режиме (обязательна, если нет DATABASE_URL)
#   DATABASE_URL  — если задан и есть pg_restore/psql на хосте, работаем напрямую
#   PG_CONTAINER  — контейнер Postgres для docker-режима (default: delovoy-postgres)
#   DB_USER       — пользователь в docker-режиме (default: delovoy)
#   FORCE_DOCKER_PG=1 — принудительно docker exec
#   ASSUME_YES=1  — без интерактивного подтверждения (для тестов/автоматизации).
#                   Для цели, похожей на прод (имя delovoy_park или *prod*), не
#                   действует: нужно дополнительно CONFIRM_PROD_RESTORE=<имя БД>.
#   SAFETY_BACKUP_DIR — куда писать страховочный бэкап цели
set -euo pipefail

BACKUP_FILE="${1:-}"
DB_NAME="${DB_NAME:-}"
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

if [ -z "${DATABASE_URL:-}" ] && [ -z "$DB_NAME" ]; then
  echo "Не задана цель восстановления. Укажите явно DATABASE_URL или DB_NAME."
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

# Имя целевой БД для сообщений и проверки на прод.
if [ "$PG_MODE" = "direct" ]; then
  TARGET_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^/]*//[^/]*/##; s#\?.*$##')"
  TARGET_DESC="$(printf '%s' "$DATABASE_URL" | sed -E 's#//[^@/]*@#//***@#')"
else
  if [ -z "$DB_NAME" ]; then
    echo "Docker-режим: укажите явно DB_NAME."
    exit 1
  fi
  TARGET_NAME="$DB_NAME"
  TARGET_DESC="docker:${PG_CONTAINER}/${DB_NAME}"
fi

LOOKS_PROD=0
case "$TARGET_NAME" in
  delovoy_park|*prod*|*PROD*) LOOKS_PROD=1 ;;
esac

echo "⚠️  ВНИМАНИЕ: Это восстановит базу ${TARGET_DESC} из бэкапа:"
echo "  $BACKUP_FILE (формат: ${FORMAT}, режим: ${PG_MODE})"
echo "  Все текущие данные будут перезаписаны!"
[ "$LOOKS_PROD" = "1" ] && echo "  🚨 Цель похожа на ПРОД (${TARGET_NAME})."
echo ""
if [ "$LOOKS_PROD" = "1" ] && [ "${ASSUME_YES:-}" = "1" ]; then
  if [ "${CONFIRM_PROD_RESTORE:-}" != "$TARGET_NAME" ]; then
    echo "ASSUME_YES не действует для прод-цели. Задайте CONFIRM_PROD_RESTORE=${TARGET_NAME} или подтвердите вручную."
    exit 1
  fi
elif [ "${ASSUME_YES:-}" != "1" ]; then
  if [ "$LOOKS_PROD" = "1" ]; then
    read -r -p "Введите имя базы (${TARGET_NAME}) для подтверждения: " CONFIRM
    if [ "$CONFIRM" != "$TARGET_NAME" ]; then
      echo "Отменено."
      exit 0
    fi
  else
    read -r -p "Продолжить? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
      echo "Отменено."
      exit 0
    fi
  fi
fi

# Страховочный бэкап цели. Без него не восстанавливаем.
SAFETY_BACKUP_DIR="${SAFETY_BACKUP_DIR:-${BACKUP_DIR}/pre-restore}"
mkdir -p "$SAFETY_BACKUP_DIR"
SAFETY_FILE="${SAFETY_BACKUP_DIR}/${TARGET_NAME:-target}_PRE_RESTORE_$(date +%Y%m%d_%H%M%S)_$$.dump"
echo "[$(date)] Страховочный бэкап цели -> ${SAFETY_FILE}"
if [ "$PG_MODE" = "direct" ]; then
  SAFETY_OK=0; pg_dump --format=custom -d "$DATABASE_URL" -f "$SAFETY_FILE" && SAFETY_OK=1
else
  SAFETY_OK=0; docker exec "$PG_CONTAINER" pg_dump --format=custom -U "$DB_USER" -d "$DB_NAME" > "$SAFETY_FILE" && SAFETY_OK=1
fi
if [ "$SAFETY_OK" != "1" ] || [ "$(head -c 5 "$SAFETY_FILE" 2>/dev/null)" != "PGDMP" ]; then
  echo "Страховочный бэкап не удался. Восстановление отменено, база не тронута."
  rm -f "$SAFETY_FILE"
  exit 1
fi
echo "  Готово. Откат: DATABASE_URL/DB_NAME=... $0 ${SAFETY_FILE}"

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

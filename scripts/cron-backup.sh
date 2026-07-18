#!/usr/bin/env bash
# Wrapper для crontab — запускается ежедневно в 02:00 MSK.
#
# Установка в crontab (от root или deploy):
#   0 2 * * * /opt/delovoy-park/scripts/cron-backup.sh >> /var/log/delovoy-backup.log 2>&1
#
# Скрипт подхватывает переменные окружения из /opt/delovoy-park/.env
# (чтобы не дублировать S3/DB creds).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_DIR}/.env}"

if [ -f "$ENV_FILE" ]; then
  # Export variables from .env (ignore comments / blank lines)
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

export BACKUP_TYPE="${BACKUP_TYPE:-DAILY}"
# nice/ionice: pg_dump не должен конкурировать за CPU/IO с приложением —
# бэкап на нагруженном сервере уже приводил к деградации (см. инцидент 2026-07-06).
if command -v ionice > /dev/null 2>&1; then
  exec nice -n 19 ionice -c3 "${REPO_DIR}/scripts/backup-db.sh"
else
  exec nice -n 19 "${REPO_DIR}/scripts/backup-db.sh"
fi

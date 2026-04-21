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
exec "${REPO_DIR}/scripts/backup-db.sh"

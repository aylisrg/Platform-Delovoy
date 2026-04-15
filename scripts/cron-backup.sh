#!/bin/bash
# Запуск бекапа PostgreSQL через docker compose
# Установить в crontab:
#   0 3 * * * /opt/delovoy/scripts/cron-backup.sh >> /var/log/delovoy-backup.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

docker compose run --rm backup

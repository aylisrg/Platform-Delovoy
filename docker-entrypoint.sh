#!/bin/sh
set -e

# One-off команды (docker compose run --rm app <cmd>) — выполняем и выходим,
# не трогая сервер. Так deploy.yml применяет миграции НОВЫМ образом до подмены
# контейнера, пока старый app продолжает обслуживать трафик.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo "=== Delovoy Park — Container Startup ==="

# --- Crash loop protection ---
CRASH_MARKER="/tmp/.entrypoint-started"
if [ -f "$CRASH_MARKER" ]; then
    LAST=$(stat -c %Y "$CRASH_MARKER" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    DIFF=$((NOW - LAST))
    if [ "$DIFF" -lt 30 ]; then
        echo "WARNING: Crash loop detected (last start ${DIFF}s ago). Waiting 30s..."
        sleep 30
    fi
fi
touch "$CRASH_MARKER"

# Здесь сознательно НЕТ prisma generate / migrate / seed.
# Инцидент 2026-07-20 (docs/incidents/2026-07-06-availability-diagnosis.md):
# они держали порт 3000 мёртвым 1–3 минуты при КАЖДОМ старте контейнера
# (деплой, рестарт вотчдога, краш) — «сайт отвечает, но грузится вечно».
# Prisma-клиент генерируется на build-стадии образа (postinstall при
# npm install); миграции применяет deploy.yml ДО подмены контейнера
# (docker compose run --rm app npx prisma migrate deploy); сид — deploy.yml
# после health-check и workflow run-seed.yml.

echo "Starting Next.js server..."
exec su-exec nextjs node server.js

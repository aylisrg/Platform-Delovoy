#!/bin/sh
# Переключает nginx на отдачу /_next/static/ из накопительного архива билдов
# (/opt/delovoy-park/static-archive) с фолбэком в приложение. Зачем: после
# деплоя старый контейнер умирает вместе со своими чанками, и открытые вкладки
# ловят 404 на /_next/static/* — архив последних билдов держит их живыми
# (инцидент 2026-07-20, docs/incidents/2026-07-06-availability-diagnosis.md).
#
# Идемпотентен: повторный запуск — no-op. Валидирует конфиг (nginx -t) и
# откатывается на бэкап при провале. Вызывается из deploy.yml; провал шага
# НЕ фатален для деплоя (без него статика просто проксируется в app, как
# раньше).
set -e

CONF="${NGINX_CONF:-/etc/nginx/sites-available/delovoy-park}"
ARCHIVE_ROOT="/opt/delovoy-park/static-archive"
MARKER="static-archive"

SUDO=""
if [ "$(id -u)" != "0" ]; then
    SUDO="sudo"
fi

if [ ! -f "$CONF" ]; then
    echo "apply-nginx-static-archive: config not found: $CONF"
    exit 1
fi

if grep -q "$MARKER" "$CONF"; then
    echo "apply-nginx-static-archive: already applied — nothing to do"
    exit 0
fi

if ! grep -q "location /_next/static/" "$CONF"; then
    echo "apply-nginx-static-archive: no 'location /_next/static/' block found — refusing to edit"
    exit 1
fi

mkdir -p "$ARCHIVE_ROOT/_next/static"

BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
$SUDO cp "$CONF" "$BACKUP"

TMP=$(mktemp)
# Заменяем каждый блок `location /_next/static/ { ... }` (включая копии в
# server-блоках, добавленных certbot) на try_files-версию с фолбэком в app.
awk '
  /location \/_next\/static\/ \{/ {
    print "    # static-archive: диск (текущий + прошлые билды), фолбэк — app";
    print "    location /_next/static/ {";
    print "        root /opt/delovoy-park/static-archive;";
    print "        try_files $uri @next_static_app;";
    print "        expires 365d;";
    print "        add_header Cache-Control \"public, immutable\";";
    print "    }";
    print "    location @next_static_app {";
    print "        proxy_pass http://127.0.0.1:3000;";
    print "        expires 365d;";
    print "        add_header Cache-Control \"public, immutable\";";
    print "    }";
    skip = 1;
    next;
  }
  skip && /\}/ { skip = 0; next; }
  skip { next; }
  { print }
' "$CONF" > "$TMP"

$SUDO cp "$TMP" "$CONF"
rm -f "$TMP"

if $SUDO nginx -t; then
    $SUDO systemctl reload nginx
    echo "apply-nginx-static-archive: applied and reloaded"
else
    echo "apply-nginx-static-archive: nginx -t FAILED — rolling back to $BACKUP"
    $SUDO cp "$BACKUP" "$CONF"
    $SUDO nginx -t && $SUDO systemctl reload nginx || true
    exit 1
fi

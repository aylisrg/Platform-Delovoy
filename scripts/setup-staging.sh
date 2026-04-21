#!/usr/bin/env bash
# Bootstrap staging environment on VPS — запустить один раз.
#
# Использование (локально):
#   ssh deploy@VPS 'bash -s' < scripts/setup-staging.sh
#
# После успеха см. docs/staging-setup.md для DNS / SSL / htpasswd шагов.
set -euo pipefail

STAGING_DIR="/opt/delovoy-park-staging"
REPO_DIR="${REPO_DIR:-/opt/delovoy-park}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "=== Platform Delovoy — staging bootstrap ==="

# 1. Dir + ownership
if [ ! -d "$STAGING_DIR" ]; then
  sudo mkdir -p "$STAGING_DIR"
  sudo chown "$USER:$USER" "$STAGING_DIR"
fi

# 2. Copy compose files from repo
if [ -f "${REPO_DIR}/docker-compose.staging.yml" ]; then
  cp "${REPO_DIR}/docker-compose.staging.yml" "${STAGING_DIR}/"
else
  log "WARN: ${REPO_DIR}/docker-compose.staging.yml not found — предполагаем, что ты зальёшь вручную"
fi

# 3. .env.staging — шаблон, без секретов
if [ ! -f "${STAGING_DIR}/.env.staging" ]; then
  if [ -f "${REPO_DIR}/.env.staging.example" ]; then
    cp "${REPO_DIR}/.env.staging.example" "${STAGING_DIR}/.env.staging"
    chmod 600 "${STAGING_DIR}/.env.staging"
    log "Создан ${STAGING_DIR}/.env.staging — ОБЯЗАТЕЛЬНО заполни секреты перед запуском"
  else
    log "WARN: .env.staging.example не найден — создай .env.staging вручную"
  fi
else
  log ".env.staging уже существует"
fi

# 4. htpasswd для Nginx Basic Auth (первый слой защиты)
HTPASSWD_FILE="/etc/nginx/.htpasswd-staging"
if [ ! -f "$HTPASSWD_FILE" ]; then
  log "Создаём htpasswd для staging Basic Auth…"
  if command -v htpasswd >/dev/null 2>&1; then
    log "Запусти вручную: sudo htpasswd -c $HTPASSWD_FILE staging"
  else
    log "htpasswd не установлен. Установи: sudo apt install apache2-utils"
  fi
fi

# 5. Nginx site
NGINX_SITE="/etc/nginx/sites-available/staging.delovoy-park.ru"
if [ ! -f "$NGINX_SITE" ]; then
  sudo tee "$NGINX_SITE" > /dev/null <<'NGINX'
server {
    listen 80;
    server_name staging.delovoy-park.ru;

    # Basic Auth (первый слой — защита от индексации/ботов)
    auth_basic           "Delovoy Staging";
    auth_basic_user_file /etc/nginx/.htpasswd-staging;

    # /api/health доступен без Basic Auth (для uptime-мониторов)
    location = /api/health {
        auth_basic off;
        proxy_pass http://127.0.0.1:3001;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;

        # Защита от индексации — ещё один слой поверх auth_basic
        add_header X-Robots-Tag "noindex, nofollow, nosnippet, noarchive" always;
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3001;
        expires 365d;
        add_header Cache-Control "public, immutable";
        add_header X-Robots-Tag "noindex, nofollow" always;
    }
}
NGINX
  sudo ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  log "Nginx configured для staging.delovoy-park.ru"
else
  log "Nginx config уже существует — не трогаю"
fi

# 6. Start stack (если .env.staging заполнен)
if [ -f "${STAGING_DIR}/.env.staging" ]; then
  cd "$STAGING_DIR"
  if grep -q "change-me" .env.staging; then
    log "⚠️  В .env.staging остались плейсхолдеры 'change-me' — СНАЧАЛА заполни, потом запускай стек"
  else
    log "Поднимаем staging-стек…"
    docker compose -f docker-compose.staging.yml up -d postgres redis
    sleep 10
    docker compose -f docker-compose.staging.yml up -d app
    log "Применяем миграции в staging БД…"
    docker compose -f docker-compose.staging.yml exec -T app npx prisma migrate deploy || log "WARN: prisma migrate deploy упал — проверь логи"
  fi
fi

echo ""
log "=== Следующие шаги ==="
log "1. DNS A-record: staging.delovoy-park.ru → $(curl -s ifconfig.me || echo '<VPS_IP>')"
log "2. Заполни секреты в ${STAGING_DIR}/.env.staging (все 'change-me')"
log "3. sudo htpasswd -c /etc/nginx/.htpasswd-staging staging"
log "4. sudo certbot --nginx -d staging.delovoy-park.ru"
log "5. Запусти GitHub Action 'Deploy to Staging' вручную для проверки деплоя"

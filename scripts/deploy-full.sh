#!/bin/bash
# ============================================================
# ПЕРВИЧНАЯ НАСТРОЙКА VPS — запускается ОДИН РАЗ
# При повторных деплоях используется GitHub Actions (deploy.yml)
# ============================================================
set -e

APP_DIR="/opt/delovoy"
REPO="https://github.com/aylisrg/Platform-Delovoy.git"
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================="
echo "  Деловой Парк — установка / обновление"
echo "========================================="
echo ""

# --- Git safe directory ---
git config --global --add safe.directory "$APP_DIR/app" 2>/dev/null || true

# --- 1. Клонирование или обновление ---
echo "[1/4] Код..."
if [ -d "$APP_DIR/app/.git" ]; then
    cd "$APP_DIR/app"
    git fetch origin
    git checkout main -f
    git reset --hard origin/main
else
    mkdir -p "$APP_DIR"
    git clone "$REPO" "$APP_DIR/app"
    cd "$APP_DIR/app"
    git checkout main
fi

# --- 2. .env (ТОЛЬКО при первой установке!) ---
echo "[2/4] Конфигурация..."
if [ -f "$APP_DIR/.env" ]; then
    echo "  .env уже существует — сохраняем секреты."
    echo "  Для изменения: nano $APP_DIR/.env"
else
    echo "  Первая установка — генерируем .env..."
    PG_PASS=$(openssl rand -hex 16)
    SECRET=$(openssl rand -hex 32)

    cat > "$APP_DIR/.env" << ENVEOF
# === Delovoy Park — Production Environment ===
# Сгенерировано $(date -u +%Y-%m-%d)
# ВНИМАНИЕ: этот файл НЕ перезаписывается при последующих деплоях!
# Для изменения: nano $APP_DIR/.env

POSTGRES_PASSWORD=${PG_PASS}
NEXTAUTH_SECRET=${SECRET}
AUTH_SECRET=${SECRET}
NEXTAUTH_URL=http://${SERVER_IP}
NEXT_PUBLIC_APP_URL=http://${SERVER_IP}
NODE_ENV=production

# === Telegram Bot (заполните вручную!) ===
TELEGRAM_BOT_TOKEN=REPLACE_ME
TELEGRAM_ADMIN_CHAT_ID=REPLACE_ME

# === Timeweb API (заполните вручную!) ===
# Получить токен: https://timeweb.cloud/my/api-keys
TIMEWEB_API_TOKEN=REPLACE_ME
TIMEWEB_SERVER_ID=7215757
ENVEOF

    chmod 600 "$APP_DIR/.env"
    echo "  .env создан. ОБЯЗАТЕЛЬНО заполните TELEGRAM и TIMEWEB токены!"
fi

# --- 3. Symlink .env в директорию репозитория ---
ln -sf "$APP_DIR/.env" "$APP_DIR/app/.env"

# --- 4. Запуск контейнеров ---
echo "[3/4] Запуск контейнеров..."
cd "$APP_DIR/app"
docker compose up -d --remove-orphans 2>&1

echo ""
echo "[4/4] Ожидание запуска..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' delovoy-app 2>/dev/null || echo "starting")
    if [ "$STATUS" = "healthy" ]; then
        echo "  Приложение запущено! (${ELAPSED}s)"
        break
    fi
    echo "  Статус: $STATUS (${ELAPSED}s / ${TIMEOUT}s)"
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done

echo ""
echo "========================================="
if [ "$STATUS" = "healthy" ]; then
    echo "  ГОТОВО! Сайт работает!"
    echo "  http://${SERVER_IP}"
else
    echo "  Контейнеры запущены, но health check не прошёл."
    echo "  Логи: docker compose -f $APP_DIR/app/docker-compose.yml logs -f app"
fi
echo ""
echo "  Не забудьте заполнить токены в $APP_DIR/.env"
echo "  и перезапустить: docker compose -f $APP_DIR/app/docker-compose.yml restart app"
echo "========================================="

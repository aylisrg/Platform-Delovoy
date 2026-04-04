#!/bin/bash
# ============================================================
# ПОЛНАЯ НАСТРОЙКА VPS — ОДНА КОМАНДА
# Всё: git, env, docker compose, миграции, запуск
# ============================================================
set -e

APP_DIR="/opt/delovoy"
REPO="https://github.com/aylisrg/Platform-Delovoy.git"
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================="
echo "  Деловой Парк — полная установка"
echo "========================================="
echo ""

# --- Git safe directory ---
git config --global --add safe.directory "$APP_DIR/app" 2>/dev/null || true

# --- Клонирование или обновление ---
echo "[1/5] Код..."
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

# --- .env ---
echo "[2/5] Конфигурация..."
PG_PASS=$(openssl rand -hex 16)
SECRET=$(openssl rand -hex 32)

cat > "$APP_DIR/.env" << ENVEOF
POSTGRES_PASSWORD=${PG_PASS}
NEXTAUTH_SECRET=${SECRET}
AUTH_SECRET=${SECRET}
NEXTAUTH_URL=http://${SERVER_IP}
NEXT_PUBLIC_APP_URL=http://${SERVER_IP}
NODE_ENV=production
TELEGRAM_BOT_TOKEN=placeholder
TELEGRAM_ADMIN_CHAT_ID=placeholder
TIMEWEB_API_TOKEN=placeholder
TIMEWEB_SERVER_ID=7215757
ENVEOF

chmod 600 "$APP_DIR/.env"

# --- docker-compose.yml ---
echo "[3/5] Docker Compose..."
cat > "$APP_DIR/docker-compose.yml" << 'DCEOF'
services:
  postgres:
    image: postgres:16-alpine
    container_name: delovoy-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: delovoy_park
      POSTGRES_USER: delovoy
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U delovoy -d delovoy_park"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: delovoy-redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build:
      context: ./app
      dockerfile: Dockerfile
    container_name: delovoy-app
    restart: unless-stopped
    ports:
      - "80:3000"
    env_file:
      - .env
    environment:
      DATABASE_URL: "postgresql://delovoy:${POSTGRES_PASSWORD}@postgres:5432/delovoy_park"
      REDIS_URL: "redis://redis:6379"
      NODE_ENV: "production"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
DCEOF

# --- Остановить старое ---
echo "[4/5] Пересборка контейнеров (2-3 минуты)..."
cd "$APP_DIR"
docker compose down 2>/dev/null || true

# --- Запуск ---
docker compose up --build -d 2>&1

echo ""
echo "[5/5] Ожидание запуска..."
sleep 10

# --- Проверка ---
STATUS=$(docker compose ps --format json 2>/dev/null | grep -c '"running"' || echo "0")

echo ""
echo "========================================="
if curl -s -o /dev/null -w "%{http_code}" "http://localhost" 2>/dev/null | grep -q "200\|308"; then
    echo "  ГОТОВО! Сайт работает!"
    echo "  http://${SERVER_IP}"
else
    echo "  Контейнеры запущены. Сайт стартует..."
    echo "  Проверьте через минуту: http://${SERVER_IP}"
fi
echo ""
echo "  Логи:  docker compose -f $APP_DIR/docker-compose.yml logs -f app"
echo "========================================="

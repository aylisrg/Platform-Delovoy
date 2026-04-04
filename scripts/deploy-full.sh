#!/bin/bash
# ============================================================
# ПОЛНАЯ НАСТРОЙКА VPS — ОДНА КОМАНДА
# Гибридный подход: PostgreSQL + Redis в Docker, Next.js нативно через pm2
# Для VPS с 1GB RAM (Docker build Next.js убивается OOM)
# ============================================================
set -euo pipefail

APP_DIR="/opt/delovoy"
APP_CODE="$APP_DIR/app"
SERVER_IP=$(hostname -I | awk '{print $1}')

log() { echo -e "\n\033[1;34m[$1]\033[0m $2"; }
ok()  { echo -e "\033[1;32m  OK\033[0m $1"; }
err() { echo -e "\033[1;31m  ОШИБКА\033[0m $1" >&2; }

echo ""
echo "========================================="
echo "  Деловой Парк — полная установка"
echo "  (гибрид: Docker DB + нативный Node.js)"
echo "========================================="

# =============================================================
# 1. Fix SSH — вернуть порт 22
# =============================================================
log "1/9" "SSH конфигурация..."
if grep -q "^Port 80" /etc/ssh/sshd_config 2>/dev/null; then
    sed -i 's/^Port 80$/Port 22/' /etc/ssh/sshd_config
    systemctl restart sshd
    ok "SSH порт исправлен: 80 → 22"
else
    ok "SSH порт уже 22"
fi

# =============================================================
# 2. Swap (2GB) — критично для next build на 1GB RAM
# =============================================================
log "2/9" "Swap..."
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Swap 2GB создан"
else
    ok "Swap уже есть"
fi

# =============================================================
# 3. Node.js 20 + pm2
# =============================================================
log "3/9" "Node.js и pm2..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    ok "Node.js $(node -v) установлен"
else
    ok "Node.js $(node -v) уже установлен"
fi

if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
    ok "pm2 установлен"
else
    ok "pm2 уже установлен"
fi

# =============================================================
# 4. Git safe directory + код
# =============================================================
log "4/9" "Код..."
git config --global --add safe.directory "$APP_CODE" 2>/dev/null || true

if [ -d "$APP_CODE/.git" ]; then
    cd "$APP_CODE"
    git fetch origin
    git checkout main -f
    git reset --hard origin/main
    ok "Код обновлён"
else
    mkdir -p "$APP_DIR"
    git clone https://github.com/aylisrg/Platform-Delovoy.git "$APP_CODE"
    cd "$APP_CODE"
    git checkout main
    ok "Код склонирован"
fi

# =============================================================
# 5. .env (идемпотентно — не перезаписываем если есть)
# =============================================================
log "5/9" "Конфигурация..."
if [ ! -f "$APP_DIR/.env" ]; then
    PG_PASS=$(openssl rand -hex 16)
    SECRET=$(openssl rand -hex 32)

    cat > "$APP_DIR/.env" << ENVEOF
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=postgresql://delovoy:${PG_PASS}@127.0.0.1:5432/delovoy_park
REDIS_URL=redis://127.0.0.1:6379
NEXTAUTH_SECRET=${SECRET}
AUTH_SECRET=${SECRET}
NEXTAUTH_URL=http://${SERVER_IP}
NEXT_PUBLIC_APP_URL=http://${SERVER_IP}
NODE_ENV=production
TELEGRAM_BOT_TOKEN=placeholder
TELEGRAM_ADMIN_CHAT_ID=placeholder
ENVEOF
    chmod 600 "$APP_DIR/.env"
    ok ".env создан"
else
    # Убедимся что DATABASE_URL указывает на localhost (не docker hostname)
    if grep -q "@postgres:" "$APP_DIR/.env" 2>/dev/null; then
        sed -i 's/@postgres:/@127.0.0.1:/g' "$APP_DIR/.env"
        ok ".env: DATABASE_URL исправлен на localhost"
    fi
    # Добавим DATABASE_URL если его нет
    if ! grep -q "^DATABASE_URL=" "$APP_DIR/.env"; then
        PG_PASS=$(grep "^POSTGRES_PASSWORD=" "$APP_DIR/.env" | cut -d= -f2)
        echo "DATABASE_URL=postgresql://delovoy:${PG_PASS}@127.0.0.1:5432/delovoy_park" >> "$APP_DIR/.env"
        ok ".env: добавлен DATABASE_URL"
    fi
    # Добавим REDIS_URL если его нет
    if ! grep -q "^REDIS_URL=" "$APP_DIR/.env"; then
        echo "REDIS_URL=redis://127.0.0.1:6379" >> "$APP_DIR/.env"
        ok ".env: добавлен REDIS_URL"
    fi
    ok ".env уже существует"
fi

# Symlink .env в app для prisma и next build
ln -sf "$APP_DIR/.env" "$APP_CODE/.env"

# =============================================================
# 6. Docker Compose — только PostgreSQL + Redis
# =============================================================
log "6/9" "Docker (PostgreSQL + Redis)..."

# Остановить старый app-контейнер если есть
docker stop delovoy-app 2>/dev/null && docker rm delovoy-app 2>/dev/null && ok "Старый app-контейнер удалён" || true

cat > "$APP_DIR/docker-compose.yml" << 'DCEOF'
services:
  postgres:
    image: postgres:16-alpine
    container_name: delovoy-postgres
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
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
    ports:
      - "127.0.0.1:6379:6379"
    command: redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
DCEOF

cd "$APP_DIR"
docker compose up -d
ok "PostgreSQL и Redis запущены"

# Ждём healthy
echo "  Ожидание готовности БД..."
for i in {1..30}; do
    if docker exec delovoy-postgres pg_isready -U delovoy -d delovoy_park &>/dev/null; then
        ok "PostgreSQL ready"
        break
    fi
    sleep 1
done

# =============================================================
# 7. Build Next.js (нативно — без Docker)
# =============================================================
log "7/9" "Сборка приложения..."
cd "$APP_CODE"

# Source .env for build
set -a
source "$APP_DIR/.env"
set +a

npm ci --omit=dev 2>&1 | tail -1
ok "npm ci"

npx prisma generate
ok "prisma generate"

npx prisma migrate deploy
ok "prisma migrate deploy"

NODE_OPTIONS="--max-old-space-size=512" npx next build
ok "next build (standalone)"

# Копируем static assets в standalone
cp -r public .next/standalone/public 2>/dev/null || true
cp -r .next/static .next/standalone/.next/static
ok "Static assets скопированы"

# =============================================================
# 8. pm2 — запуск и автостарт
# =============================================================
log "8/9" "pm2..."

# start.sh — wrapper для pm2
cat > "$APP_CODE/start.sh" << 'STARTEOF'
#!/bin/bash
set -a
source /opt/delovoy/.env
set +a
export PORT=3000
export HOSTNAME="0.0.0.0"
exec node /opt/delovoy/app/.next/standalone/server.js
STARTEOF
chmod +x "$APP_CODE/start.sh"

# ecosystem.config.js
cat > "$APP_CODE/ecosystem.config.js" << 'PMEOF'
module.exports = {
  apps: [{
    name: 'delovoy',
    script: '/opt/delovoy/app/start.sh',
    interpreter: '/bin/bash',
    cwd: '/opt/delovoy/app/.next/standalone',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    max_memory_restart: '400M',
    restart_delay: 3000,
    max_restarts: 10,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/opt/delovoy/logs/error.log',
    out_file: '/opt/delovoy/logs/out.log',
    merge_logs: true
  }]
};
PMEOF

mkdir -p "$APP_DIR/logs"

pm2 delete delovoy 2>/dev/null || true
pm2 start "$APP_CODE/ecosystem.config.js"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true
ok "pm2 запущен и настроен на автостарт"

# =============================================================
# 9. Firewall + iptables redirect 80 → 3000
# =============================================================
log "9/9" "Сеть и firewall..."

# iptables redirect: порт 80 → 3000 (без nginx)
if ! iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000 2>/dev/null; then
    iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000
    ok "iptables: 80 → 3000"
fi

# Сохранение iptables
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save 2>/dev/null || true
else
    apt-get install -y iptables-persistent 2>/dev/null || true
    netfilter-persistent save 2>/dev/null || true
fi

# UFW
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp   2>/dev/null || true
    ufw allow 80/tcp   2>/dev/null || true
    ufw allow 443/tcp  2>/dev/null || true
    echo "y" | ufw enable 2>/dev/null || true
    ok "UFW настроен (22, 80, 443)"
fi

# =============================================================
# Deploy user для GitHub Actions (если нет)
# =============================================================
if ! id -u deploy &>/dev/null 2>&1; then
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy 2>/dev/null || true
    mkdir -p /home/deploy/.ssh
    chmod 700 /home/deploy/.ssh
    ok "Пользователь deploy создан"
fi

# SSH ключ для GitHub Actions
if [ ! -f /home/deploy/.ssh/id_ed25519 ]; then
    ssh-keygen -t ed25519 -f /home/deploy/.ssh/id_ed25519 -N "" -C "deploy@delovoy-vps"
    cat /home/deploy/.ssh/id_ed25519.pub >> /home/deploy/.ssh/authorized_keys
    chmod 600 /home/deploy/.ssh/authorized_keys
    chown -R deploy:deploy /home/deploy/.ssh
    echo ""
    echo "============================================="
    echo "  SSH КЛЮЧ ДЛЯ GITHUB ACTIONS (VPS_SSH_KEY):"
    echo "============================================="
    cat /home/deploy/.ssh/id_ed25519
    echo ""
    echo "  Добавьте этот ключ в GitHub Secrets как VPS_SSH_KEY"
    echo "============================================="
fi

# Даём deploy права на /opt/delovoy
chown -R deploy:deploy "$APP_DIR"

# =============================================================
# Проверка
# =============================================================
echo ""
sleep 3

echo "========================================="
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000" 2>/dev/null | grep -qE "200|308"; then
    echo "  ГОТОВО! Сайт работает!"
    echo "  http://${SERVER_IP}"
else
    echo "  pm2 запущен. Сайт стартует..."
    echo "  Проверьте через 10 сек: http://${SERVER_IP}"
fi
echo ""
echo "  Логи:     pm2 logs delovoy"
echo "  Статус:   pm2 status"
echo "  Рестарт:  pm2 restart delovoy"
echo "  DB логи:  docker compose -f $APP_DIR/docker-compose.yml logs -f"
echo "========================================="

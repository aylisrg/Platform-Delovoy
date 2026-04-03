#!/bin/bash
# ============================================================
# Настройка VPS для Platform Delovoy — ОДНА КОМАНДА
# Запуск: curl -fsSL <url> | bash
# Или:    bash setup-vps.sh
# ============================================================
set -euo pipefail

REPO="https://github.com/aylisrg/Platform-Delovoy.git"
APP_DIR="/opt/delovoy"

echo ""
echo "========================================="
echo "  Настройка VPS для Деловой Парк"
echo "========================================="
echo ""

# --- 1. Обновление + базовые пакеты ---
echo "[1/7] Обновление системы..."
apt update -qq && apt upgrade -y -qq
apt install -y -qq curl git ufw fail2ban

# --- 2. Docker ---
echo "[2/7] Установка Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
fi

# --- 3. Пользователь deploy ---
echo "[3/7] Создание пользователя deploy..."
if ! id "deploy" &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG docker deploy
fi

# --- 4. SSH-ключ для GitHub Actions ---
echo "[4/7] Генерация SSH-ключа..."
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

ssh-keygen -t ed25519 -f /home/deploy/.ssh/deploy_key -N "" -C "github-actions" -q
cat /home/deploy/.ssh/deploy_key.pub >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# --- 5. Firewall ---
echo "[5/7] Настройка файрвола..."
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow 22/tcp > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw --force enable > /dev/null

# --- 6. Fail2Ban ---
echo "[6/7] Настройка Fail2Ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 3600
EOF
systemctl enable fail2ban -q
systemctl restart fail2ban

# --- 7. Клонирование проекта + настройка ---
echo "[7/7] Клонирование проекта..."
mkdir -p "$APP_DIR"

git clone "$REPO" "$APP_DIR/app" 2>/dev/null || (cd "$APP_DIR/app" && git pull)

# Генерация .env с безопасными паролями
PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
SECRET=$(openssl rand -base64 32)

cat > "$APP_DIR/.env" << ENVEOF
POSTGRES_PASSWORD=${PG_PASS}
NEXTAUTH_SECRET=${SECRET}
AUTH_SECRET=${SECRET}
NEXTAUTH_URL=http://$(curl -s -6 ifconfig.co || echo "localhost"):3000
NEXT_PUBLIC_APP_URL=http://$(curl -s -6 ifconfig.co || echo "localhost")
NODE_ENV=production
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ADMIN_CHAT_ID=your-chat-id
ENVEOF

chmod 600 "$APP_DIR/.env"

# docker-compose.yml в /opt/delovoy (ссылается на ./app как build context)
cp "$APP_DIR/app/docker-compose.yml" "$APP_DIR/docker-compose.yml"

chown -R deploy:deploy "$APP_DIR"

# --- Запуск! ---
echo ""
echo "[OK] Запускаю контейнеры..."
cd "$APP_DIR"
docker compose up --build -d

echo ""
echo "========================================="
echo "  ГОТОВО!"
echo "========================================="
echo ""
echo "Сайт доступен: http://$(curl -s -6 ifconfig.co 2>/dev/null || echo 'ваш-ip'):80"
echo ""
echo "--- Осталось настроить GitHub Actions ---"
echo ""
echo "Добавьте 2 секрета в GitHub:"
echo "  Settings → Secrets → Actions → New repository secret"
echo ""
echo "1) VPS_HOST"
echo "   Значение: $(curl -s -6 ifconfig.co 2>/dev/null || echo '2a03:6f00:a::1:2540')"
echo ""
echo "2) VPS_SSH_KEY"
echo "   Значение (скопируйте ВСЁ между линиями):"
echo "---START---"
cat /home/deploy/.ssh/deploy_key
echo "---END---"
echo ""
echo "После этого каждый push в main будет"
echo "автоматически деплоиться на сервер."
echo "========================================="

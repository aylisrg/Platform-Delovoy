#!/bin/bash
# ============================================================
# Первичная настройка VPS для Platform Delovoy
# Запуск: bash setup-vps.sh
# Выполняется ОДИН РАЗ на свежем сервере.
# Последующие деплои — через GitHub Actions (deploy.yml).
# ============================================================
set -euo pipefail

REPO="https://github.com/aylisrg/Platform-Delovoy.git"
APP_DIR="/opt/delovoy"
GHCR_IMAGE="ghcr.io/aylisrg/platform-delovoy:latest"

echo ""
echo "========================================="
echo "  Настройка VPS для Деловой Парк"
echo "========================================="
echo ""

# --- 1. Обновление + базовые пакеты ---
echo "[1/9] Обновление системы..."
apt update -qq && apt upgrade -y -qq
apt install -y -qq curl git ufw fail2ban

# --- 2. Docker ---
echo "[2/9] Установка Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
fi
systemctl enable docker
systemctl start docker

# --- 3. Swap (2GB) для предотвращения OOM ---
echo "[3/9] Настройка swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo "/swapfile swap swap defaults 0 0" >> /etc/fstab
    echo "  Swap создан: 2GB"
else
    echo "  Swap уже существует, пропускаем."
fi

# --- 4. Docker mirror (ускорение pull в РФ) ---
echo "[4/9] Настройка Docker mirror..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://mirror.gcr.io"]
}
EOF
systemctl restart docker
sleep 3

# --- 5. Пользователь deploy ---
echo "[5/9] Создание пользователя deploy..."
if ! id "deploy" &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG docker deploy
fi

# --- 6. SSH-ключ для GitHub Actions ---
echo "[6/9] Генерация SSH-ключа..."
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

if [ ! -f /home/deploy/.ssh/deploy_key ]; then
    ssh-keygen -t ed25519 -f /home/deploy/.ssh/deploy_key -N "" -C "github-actions" -q
    cat /home/deploy/.ssh/deploy_key.pub >> /home/deploy/.ssh/authorized_keys
    chmod 600 /home/deploy/.ssh/authorized_keys
fi
chown -R deploy:deploy /home/deploy/.ssh

# --- 7. Firewall ---
echo "[7/9] Настройка файрвола..."
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow 22/tcp > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw --force enable > /dev/null

# --- 8. Docker auto-cleanup cron (prevent disk full) ---
echo "[8/10] Настройка автоочистки Docker..."
cat > /etc/cron.daily/docker-cleanup << 'CRONEOF'
#!/bin/sh
# Daily Docker cleanup to prevent disk exhaustion
docker container prune -f > /dev/null 2>&1
docker image prune -af > /dev/null 2>&1
docker builder prune -af > /dev/null 2>&1
apt-get clean > /dev/null 2>&1
journalctl --vacuum-size=50M > /dev/null 2>&1
find /var/log -name "*.gz" -delete > /dev/null 2>&1
CRONEOF
chmod +x /etc/cron.daily/docker-cleanup

# --- 9. Fail2Ban ---
echo "[9/10] Настройка Fail2Ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 3600
EOF
systemctl enable fail2ban -q
systemctl restart fail2ban

# --- 10. Клонирование проекта + первый запуск ---
echo "[10/10] Клонирование проекта..."
mkdir -p "$APP_DIR"

git clone "$REPO" "$APP_DIR/app" 2>/dev/null || (cd "$APP_DIR/app" && git pull origin main)

# Pull базовые Docker-образы
echo "  Загрузка Docker-образов..."
docker pull postgres:16-alpine
docker pull redis:7-alpine

# Первичная установка через deploy-full.sh
cd "$APP_DIR/app"
bash scripts/deploy-full.sh

SERVER_IPV4=$(curl -s -4 ifconfig.co 2>/dev/null || hostname -I | awk '{print $1}')
SERVER_IPV6=$(curl -s -6 ifconfig.co 2>/dev/null || echo "2a03:6f00:a::1:3e2b")

echo ""
echo "========================================="
echo "  ГОТОВО!"
echo "========================================="
echo ""
echo "Сайт доступен:"
echo "  IPv4: http://${SERVER_IPV4}"
echo "  IPv6: http://[${SERVER_IPV6}]"
echo ""
echo "--- Настройте GitHub Secrets ---"
echo ""
echo "  Settings → Secrets → Actions → New repository secret"
echo ""
echo "  1) VPS_HOST = ${SERVER_IPV4}"
echo "  2) VPS_PASSWORD = <пароль root>"
echo ""
echo "--- Настройте токены в .env ---"
echo ""
echo "  nano $APP_DIR/.env"
echo "  Заполните: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID, TIMEWEB_API_TOKEN"
echo "  Затем: docker compose -f $APP_DIR/app/docker-compose.yml restart app"
echo ""
echo "--- Сделайте GHCR package публичным ---"
echo ""
echo "  GitHub → Packages → platform-delovoy → Settings → Visibility → Public"
echo "  (чтобы VPS мог pull-ить без авторизации)"
echo ""
echo "После этого каждый push в main будет автоматически деплоиться."
echo "========================================="

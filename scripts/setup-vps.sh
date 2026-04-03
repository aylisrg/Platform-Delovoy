#!/bin/bash
# ===========================================================
# Скрипт первичной настройки VPS для Platform Delovoy
# Запускать от root: bash setup-vps.sh
# ===========================================================
set -euo pipefail

echo "=== 1. Обновление системы ==="
apt update && apt upgrade -y

echo "=== 2. Установка базовых пакетов ==="
apt install -y curl git ufw fail2ban

echo "=== 3. Создание пользователя deploy ==="
if ! id "deploy" &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG sudo deploy
    # Разрешаем deploy запускать docker без sudo (добавим в группу позже)
    echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/docker,/usr/bin/docker compose" >> /etc/sudoers.d/deploy
    chmod 440 /etc/sudoers.d/deploy
fi

echo "=== 4. Настройка SSH-ключа для deploy ==="
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

# Генерируем SSH-ключ для GitHub Actions → VPS
ssh-keygen -t ed25519 -f /home/deploy/.ssh/github_actions -N "" -C "github-actions-deploy"
cat /home/deploy/.ssh/github_actions.pub >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

echo ""
echo "============================================="
echo "ВАЖНО: Скопируйте ПРИВАТНЫЙ ключ ниже."
echo "Его нужно добавить в GitHub Secrets как VPS_SSH_KEY"
echo "============================================="
cat /home/deploy/.ssh/github_actions
echo ""
echo "============================================="

echo "=== 5. Усиление SSH ==="
# Отключаем вход по паролю, только по ключам
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart sshd

echo "=== 6. Настройка firewall (UFW) ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

echo "=== 7. Настройка Fail2Ban ==="
cat > /etc/fail2ban/jail.local << 'JAILEOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
JAILEOF
systemctl enable fail2ban
systemctl restart fail2ban

echo "=== 8. Установка Docker ==="
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker deploy
fi

echo "=== 9. Создание директории приложения ==="
mkdir -p /opt/delovoy
chown deploy:deploy /opt/delovoy

echo "=== 10. Создание docker-compose и .env на сервере ==="
cat > /opt/delovoy/docker-compose.yml << 'COMPOSEEOF'
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
    image: ghcr.io/aylisrg/platform-delovoy:latest
    container_name: delovoy-app
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
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

  nginx:
    image: nginx:alpine
    container_name: delovoy-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app

volumes:
  postgres_data:
  redis_data:
COMPOSEEOF

# Генерируем безопасные пароли
POSTGRES_PWD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
AUTH_SECRET=$(openssl rand -base64 32)

cat > /opt/delovoy/.env << ENVEOF
# Database
POSTGRES_PASSWORD=${POSTGRES_PWD}

# NextAuth
NEXTAUTH_SECRET=${AUTH_SECRET}
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=${AUTH_SECRET}

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=production

# Telegram (заполните реальными значениями)
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ADMIN_CHAT_ID=your-admin-group-id
ENVEOF

chmod 600 /opt/delovoy/.env

# nginx.conf
cat > /opt/delovoy/nginx.conf << 'NGINXEOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINXEOF

chown -R deploy:deploy /opt/delovoy

echo ""
echo "============================================="
echo "НАСТРОЙКА ЗАВЕРШЕНА!"
echo "============================================="
echo ""
echo "Следующие шаги:"
echo ""
echo "1. СКОПИРУЙТЕ приватный ключ выше и добавьте в GitHub Secrets:"
echo "   Settings → Secrets → Actions → New repository secret"
echo "   Имя: VPS_SSH_KEY"
echo "   Значение: содержимое ключа"
echo ""
echo "2. Добавьте остальные GitHub Secrets:"
echo "   VPS_HOST = 2a03:6f00:a::1:2540"
echo "   GHCR_USER = ваш-github-username"
echo "   GHCR_TOKEN = ваш-github-personal-access-token (с правом packages:write)"
echo ""
echo "3. ВАЖНО: Перед тем как закрыть эту сессию,"
echo "   добавьте СВОЙ SSH-ключ в /home/deploy/.ssh/authorized_keys"
echo "   чтобы сохранить доступ (root вход отключён!)"
echo ""
echo "4. Первый деплой: push в main → GitHub Actions → автоматически"
echo ""
echo "Файлы:"
echo "  /opt/delovoy/.env      — переменные окружения (пароли сгенерированы)"
echo "  /opt/delovoy/docker-compose.yml — конфигурация контейнеров"
echo "============================================="

#!/bin/bash
# ============================================================
# Delovoy Park — VPS Initial Setup Script (Timeweb)
# Run once on a fresh VPS to prepare for deployments.
# Usage: ssh root@your-vps "bash -s" < scripts/setup-vps.sh
# ============================================================
set -euo pipefail

echo "=== Delovoy Park — VPS Setup ==="

# --- 1. System packages ---
apt-get update && apt-get install -y \
  docker.io docker-compose-plugin \
  nginx certbot python3-certbot-nginx \
  fail2ban ufw curl jq

# --- 2. Firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (for certbot)
ufw allow 443/tcp   # HTTPS
ufw --force enable
echo "Firewall configured."

# --- 3. Deploy user ---
if ! id "deploy" &>/dev/null; then
  useradd -m -s /bin/bash -G docker deploy
  mkdir -p /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  echo "User 'deploy' created and added to docker group."
fi

# --- 4. App directories ---
mkdir -p /opt/delovoy-park
mkdir -p /opt/backups
chown deploy:deploy /opt/delovoy-park /opt/backups
echo "Directories created."

# --- 5. Backup rotation cron (keep last 30 days) ---
cat > /etc/cron.daily/cleanup-backups << 'CRON'
#!/bin/bash
find /opt/backups -name "*.sql.gz" -mtime +30 -delete
CRON
chmod +x /etc/cron.daily/cleanup-backups

# --- 6. Docker log rotation ---
cat > /etc/docker/daemon.json << 'DOCKER'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DOCKER
systemctl restart docker

# --- 7. Nginx config ---
cat > /etc/nginx/sites-available/delovoy-park << 'NGINX'
server {
    listen 80;
    server_name delovoy-park.ru www.delovoy-park.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    }

    # Static files — cache aggressively
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # Health check — no logging
    location /api/health {
        proxy_pass http://127.0.0.1:3000;
        access_log off;
    }

    client_max_body_size 20M;
}
NGINX

ln -sf /etc/nginx/sites-available/delovoy-park /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy .env to /opt/delovoy-park/.env"
echo "  2. Copy docker-compose.prod.yml to /opt/delovoy-park/docker-compose.yml"
echo "  3. Run: certbot --nginx -d delovoy-park.ru -d www.delovoy-park.ru"
echo "  4. Add GitHub Secrets: VPS_HOST, VPS_USER=deploy, VPS_SSH_KEY"
echo "  5. Push to main — deploy will run automatically"

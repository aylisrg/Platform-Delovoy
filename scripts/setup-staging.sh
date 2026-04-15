#!/usr/bin/env bash
# Setup staging environment on VPS
# Run once: ssh deploy@VPS 'bash -s' < scripts/setup-staging.sh

set -euo pipefail

echo "=== Setting up staging environment ==="

# Create staging directory
sudo mkdir -p /opt/delovoy-park-staging
sudo chown deploy:deploy /opt/delovoy-park-staging

# Copy staging compose file
echo "Copy docker-compose.staging.yml to /opt/delovoy-park-staging/"
echo "(Upload it manually or via git clone)"

# Create staging env file
if [ ! -f /opt/delovoy-park-staging/.env.staging ]; then
  cat > /opt/delovoy-park-staging/.env.staging <<'EOF'
# Staging environment — auto-generated
# Copy from production .env and adjust:
POSTGRES_PASSWORD=staging_password_change_me
NEXTAUTH_SECRET=staging-secret-change-me
NEXTAUTH_URL=https://staging.delovoy-park.ru
NEXT_PUBLIC_APP_URL=https://staging.delovoy-park.ru
NODE_ENV=production
EOF
  echo "Created .env.staging — edit it with correct values!"
else
  echo ".env.staging already exists"
fi

# Setup Nginx
echo "=== Nginx setup ==="
if [ ! -f /etc/nginx/sites-available/staging.delovoy-park.ru ]; then
  sudo tee /etc/nginx/sites-available/staging.delovoy-park.ru > /dev/null <<'NGINX'
server {
    listen 80;
    server_name staging.delovoy-park.ru;

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
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3001;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

  sudo ln -sf /etc/nginx/sites-available/staging.delovoy-park.ru /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  echo "Nginx configured for staging.delovoy-park.ru"

  # SSL via Certbot
  echo "=== SSL setup ==="
  echo "Run: sudo certbot --nginx -d staging.delovoy-park.ru"
else
  echo "Nginx config already exists"
fi

echo ""
echo "=== Next steps ==="
echo "1. Add DNS A-record: staging.delovoy-park.ru → $(curl -s ifconfig.me)"
echo "2. Edit /opt/delovoy-park-staging/.env.staging"
echo "3. Copy docker-compose.staging.yml to /opt/delovoy-park-staging/"
echo "4. Run: sudo certbot --nginx -d staging.delovoy-park.ru"
echo "5. Push to main — staging auto-deploys!"

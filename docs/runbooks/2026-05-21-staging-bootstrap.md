# Staging Bootstrap Runbook

One-time setup to bring the staging environment live on the VPS.
PR #146 merged the code; this runbook covers the infrastructure configuration.

---

## Prerequisites

- SSH access to the VPS (`ssh deploy@<vps-ip>`)
- Domain `delovoy.app` DNS management access (Timeweb)
- Telegram BotFather access (for creating staging bot)
- S3 credentials (already used by prod backup)

---

## Step 1 — Create Telegram staging bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. `/newbot` → name: `Delovoy Park Staging` → username: `DelovoyParkStaging_bot`
3. Copy the token → save as `TELEGRAM_STAGING_BOT_TOKEN` in `.env.staging`

---

## Step 2 — DNS

Add an A record in Timeweb DNS panel:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `staging` | `<vps-ip>` | 300 |

Result: `staging.delovoy.app` → VPS. TTL propagation ~5 min.

---

## Step 3 — nginx + TLS on VPS

```bash
ssh deploy@<vps-ip>

# Copy nginx config (already in repo)
sudo cp /opt/platform-delovoy/scripts/nginx-staging.conf /etc/nginx/sites-available/staging.delovoy.app
sudo ln -sf /etc/nginx/sites-available/staging.delovoy.app /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload

# Issue TLS cert
sudo certbot --nginx -d staging.delovoy.app --non-interactive --agree-tos -m admin@delovoy-park.ru

# Create basic-auth password (protect staging from public)
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd staging
# enter a password, share with team
sudo nginx -s reload
```

---

## Step 4 — Create .env.staging on VPS

```bash
ssh deploy@<vps-ip>
cd /opt/platform-delovoy

# Copy from prod env as a base, then override staging-specific values
cp .env .env.staging
nano .env.staging
```

Required overrides in `.env.staging`:

```env
# Database — staging DB (docker-compose.staging.yml maps to port 5434 internally)
DATABASE_URL=postgresql://delovoy:delovoy@localhost:5432/delovoy_park_staging

# Auth — MUST be different from prod to prevent session cross-contamination
NEXTAUTH_SECRET=<generate: openssl rand -base64 32>
NEXTAUTH_URL=https://staging.delovoy.app

# Telegram — use the staging bot token from Step 1
TELEGRAM_BOT_TOKEN=<TELEGRAM_STAGING_BOT_TOKEN from Step 1>
IS_STAGING=true

# Web Push — generate new VAPID keys for staging
# npm run generate:vapid  (or: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>

# S3 — same credentials as prod, but staging writes to staging/ prefix
S3_BACKUP_BUCKET=delovoy-backups
# (no change needed — backup script uses BACKUP_KIND_DIR=staging prefix)
```

---

## Step 5 — Start staging stack

```bash
cd /opt/platform-delovoy

# Pull latest images
docker compose -f docker-compose.staging.yml pull

# Start staging stack (postgres, redis, app, bot)
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d

# Check all containers are healthy
docker compose -f docker-compose.staging.yml ps
```

---

## Step 6 — Initial DB seed (or pull from prod)

Option A — fresh seed (empty staging DB):
```bash
docker exec platform-delovoy-app-staging npx prisma migrate deploy
docker exec -e NODE_ENV=staging platform-delovoy-app-staging npm run db:seed
```

Option B — pull from prod dump (recommended, gives realistic data):
```bash
# On VPS, run staging-refresh manually for the first time
bash /opt/platform-delovoy/scripts/staging-refresh.sh
```

---

## Step 7 — Set up daily refresh cron

```bash
# Edit crontab
crontab -e

# Add: run at 03:30 MSK (00:30 UTC), after prod backup (02:00 MSK)
30 0 * * * /opt/platform-delovoy/scripts/staging-refresh.sh >> /var/log/staging-refresh.log 2>&1
```

---

## Step 8 — Smoke test

1. Open `https://staging.delovoy.app` (enter basic-auth credentials)
2. Should see the login page
3. Log in as `admin@local / admin` (after dev-overlay seed) or with prod credentials (after prod-dump restore)
4. Verify modules load, no 500 errors in browser console

---

## Checklist

- [ ] Telegram staging bot created → token in `.env.staging`
- [ ] DNS A record added for `staging.delovoy.app`
- [ ] nginx config applied + TLS cert issued
- [ ] Basic-auth password set + shared with team
- [ ] `.env.staging` on VPS with unique `NEXTAUTH_SECRET` and `NEXTAUTH_URL`
- [ ] Docker staging stack running (`docker compose ps` all healthy)
- [ ] Initial DB populated (seed or prod-dump restore)
- [ ] Daily refresh cron installed
- [ ] Smoke test passed

---

## Troubleshooting

**Staging app shows DB errors:**
```bash
docker logs platform-delovoy-app-staging --tail 50
# Run pending migrations:
docker exec platform-delovoy-app-staging npx prisma migrate deploy
```

**Telegram bot 409 Conflict:**
Ensure prod and staging use different `TELEGRAM_BOT_TOKEN` values. `IS_STAGING=true` in `.env.staging` activates the conflict guard in `bot/index.ts`.

**staging-refresh.sh fails:**
```bash
cat /var/log/staging-refresh.log | tail -50
# Check S3 credentials are in .env.staging
# Check SANITIZE_DB_URL is reachable
```

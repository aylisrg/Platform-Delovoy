# Staging Setup — развёртывание с нуля

Один раз — для инициализации staging окружения на VPS.

## 0. Что у нас получится

```
https://staging.delovoy-park.ru
  ├─ Nginx (Basic Auth, первый слой)
  │   └─ 127.0.0.1:3001 → delovoy-staging-app
  │       ├─ Next.js middleware (Basic Auth, второй слой)
  │       ├─ StagingBanner — жёлтая полоса сверху
  │       └─ delovoy-staging-postgres (изолированная БД)
  └─ /api/health — без Basic Auth (для Timeweb uptime)
```

## 1. Подготовка

### 1.1 DNS
Добавить A-record в DNS-панели:
```
staging.delovoy-park.ru → <VPS_IP>  (TTL 300)
```

### 1.2 GitHub Secrets
В `Settings → Secrets and variables → Actions` добавить:
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` — если ещё нет
- `TELEGRAM_STAGING_BOT_TOKEN` — токен от `@DelovoyStaging_bot`
- `TELEGRAM_STAGING_CHAT_ID` — id dev-чата

Опционально:
- `GITHUB_DISPATCH_TOKEN` — fine-grained PAT с `actions:write`, scope на этот репозиторий (для кнопки "Deploy" в админке).

## 2. Bootstrap на VPS

```bash
ssh deploy@VPS
cd /opt/delovoy-park
git pull origin main
bash scripts/setup-staging.sh
```

Скрипт создаёт:
- `/opt/delovoy-park-staging/` — директория стейджа
- `/opt/delovoy-park-staging/.env.staging` — из шаблона
- `/etc/nginx/sites-available/staging.delovoy-park.ru` — Nginx конфиг

## 3. Секреты

Отредактировать `/opt/delovoy-park-staging/.env.staging`:

```bash
sudo vi /opt/delovoy-park-staging/.env.staging
```

Все значения с `change-me` заменить:

| Переменная | Как получить |
|------------|--------------|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `STAGING_BASIC_AUTH_USER` | любое, например `staging` |
| `STAGING_BASIC_AUTH_PASS` | `openssl rand -base64 16` |
| `TELEGRAM_STAGING_BOT_TOKEN` | `@BotFather` → `/newbot` → `@DelovoyStaging_bot` |
| `TELEGRAM_STAGING_CHAT_ID` | добавить бота в dev-чат, `curl https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `GOOGLE_CLIENT_ID`/`SECRET` | отдельный проект в Google Cloud Console, callback `https://staging.delovoy-park.ru/api/auth/callback/google` |
| `YANDEX_CLIENT_ID`/`SECRET` | отдельное приложение в Yandex ID console |

**Никогда** не копируй прод-значения — это нарушит изоляцию данных (FR-004).

## 4. htpasswd (Basic Auth для Nginx)

```bash
sudo apt install -y apache2-utils  # если нужно
sudo htpasswd -c /etc/nginx/.htpasswd-staging staging
# Введи пароль — тот же, что `STAGING_BASIC_AUTH_PASS` в .env.staging
# (приложение тоже проверяет его через middleware как второй слой)
```

## 5. SSL

```bash
sudo certbot --nginx -d staging.delovoy-park.ru
```

Certbot автоматически обновит Nginx конфиг и включит HTTP→HTTPS redirect.

## 6. Запуск стека

```bash
cd /opt/delovoy-park-staging

# Pull образа
docker pull ghcr.io/aylisrg/platform-delovoy:staging

# Старт postgres + redis
docker compose -f docker-compose.staging.yml up -d postgres redis
sleep 10

# Старт app
docker compose -f docker-compose.staging.yml up -d app

# Миграции (пустая БД с нуля)
docker compose -f docker-compose.staging.yml exec -T app npx prisma migrate deploy

# Создать SUPERADMIN вручную (seed на staging — пустой по FR-005)
docker compose -f docker-compose.staging.yml exec -T postgres psql -U delovoy -d delovoy_park_staging
# SQL:
# INSERT INTO "User" (id, email, "passwordHash", role, name, "createdAt", "updatedAt")
# VALUES ('staging_admin', 'admin@staging.delovoy-park.ru', '<bcrypt_hash>', 'SUPERADMIN', 'Staging Admin', NOW(), NOW());
```

Сгенерировать bcrypt-хеш:
```bash
docker compose -f docker-compose.staging.yml exec -T app node -e "require('bcryptjs').hash(process.argv[1], 10).then(console.log)" "StagingPassword123"
```

## 7. Проверка

```bash
# /api/health должен отвечать 200 без Basic Auth
curl https://staging.delovoy-park.ru/api/health

# Главная требует Basic Auth
curl -I https://staging.delovoy-park.ru
# → 401 Unauthorized

# С кредами — 200 + жёлтый баннер в HTML
curl -u staging:<пароль> https://staging.delovoy-park.ru | grep -i STAGING
```

## 8. Деплой новой версии

Через GitHub UI → Actions → "Deploy to Staging" → Run workflow → указать SHA (optional).

Время деплоя ~2 мин (p95 < 3 мин по FR-006).

Можно также из админки: `/admin/architect/deploy` → кнопка "Deploy to Staging"
(требует `GITHUB_DISPATCH_TOKEN` в прод `.env`).

## 9. Troubleshooting

| Симптом | Причина | Решение |
|---------|---------|---------|
| 502 на staging.delovoy-park.ru | app-контейнер упал | `docker logs delovoy-staging-app` |
| Basic Auth не работает | htpasswd-файл не читается Nginx | `sudo chmod 644 /etc/nginx/.htpasswd-staging` |
| Прод-бот отвечает на staging | не задан `TELEGRAM_STAGING_BOT_TOKEN` | Заполни в `.env.staging`, `docker compose restart app` |
| `/api/health` за Basic Auth | Nginx `location = /api/health` не подхватился | `sudo nginx -t && sudo systemctl reload nginx` |
| Staging съел прод RAM | Не сработали cgroup limits | `docker stats`, проверь `deploy.resources.limits` в compose |

## 10. Откат / удаление

```bash
cd /opt/delovoy-park-staging
docker compose -f docker-compose.staging.yml down -v  # -v удаляет volume с БД!
sudo rm /etc/nginx/sites-enabled/staging.delovoy-park.ru
sudo systemctl reload nginx
```

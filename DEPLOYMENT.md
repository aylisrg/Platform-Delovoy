# DEPLOYMENT.md — Правила разработки и деплоя

> Этот документ описывает полный цикл разработки и выкатки на продакшн для https://delovoy-park.ru/

---

## Архитектура деплоя

```
┌──────────────────┐     push/PR      ┌──────────────────┐
│  VSCode + Claude  │ ──────────────▶ │     GitHub        │
│  (локальная       │                  │  aylisrg/         │
│   разработка)     │                  │  platform-delovoy │
└──────────────────┘                  └────────┬─────────┘
                                               │
                                    ┌──────────┴──────────┐
                                    │                     │
                                    ▼                     ▼
                              PR → main            push → main
                              ┌──────────┐        ┌──────────────┐
                              │  CI.yml  │        │  Deploy.yml  │
                              │ lint     │        │ build image  │
                              │ test     │        │ push to GHCR │
                              │ typecheck│        │ SSH → VPS    │
                              │ build    │        │ health check │
                              └──────────┘        └──────┬───────┘
                                                         │
                                                         ▼
                                                  ┌──────────────┐
                                                  │ Timeweb VPS  │
                                                  │              │
                                                  │ Nginx (SSL)  │
                                                  │   ↓          │
                                                  │ Docker       │
                                                  │  ├ app       │
                                                  │  ├ bot       │
                                                  │  ├ postgres  │
                                                  │  └ redis     │
                                                  └──────────────┘
                                                         │
                                                         ▼
                                                  delovoy-park.ru
```

### Сервис `bot` — Telegram-бот @DelovoyPark_bot

Бот запускается как **отдельный Docker-сервис** в том же compose-стеке, использует тот же image что и `app`, но запускается командой `npx tsx bot/index.ts` вместо Next.js (через `entrypoint: []` + `command: [...]`).

Почему отдельный сервис, а не воркер внутри Next.js:
- Long polling Telegram getUpdates конфликтует с multi-worker моделью Next.js (409 Conflict при двух процессах с одним токеном).
- Изолированный lifecycle: рестарт бота не трогает HTTP-приложение и наоборот.
- Отдельные лимиты ресурсов (256 MB).

Ручной шаг **только при первом мерже этого PR** (последующие деплои сами поднимают `bot` через rolling-restart):
```bash
ssh deploy@<VPS>
cd /opt/delovoy-park
docker compose pull
docker compose up -d   # без --no-deps, чтобы создать новый сервис bot
docker compose logs -f bot   # убедиться что бот стартанул
```

Секреты `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` синхронизируются в `/opt/delovoy-park/.env` шагом `Sync secrets to server .env` workflow `deploy.yml`.

---

### Сервис `agent` — Claude Code Agent

Принимает задачи через Telegram и исполняет их через Claude Code CLI в изолированном workspace `/opt/claude-agent-workspace/`. Использует **отдельный бот-токен** (`AGENT_TELEGRAM_BOT_TOKEN`) — не конфликтует с `@DelovoyPark_bot`. Принимает команды только от владельца (`AGENT_TELEGRAM_USER_ID`). Нет доступа к prod БД/Redis.

**Образ:** `ghcr.io/aylisrg/platform-delovoy-agent:latest` (собирается workflow `build-agent.yml`).

**Одноразовая настройка после первого деплоя:**
```bash
# 1. Создать workspace и клонировать репо
ssh deploy@<VPS>
sudo bash /opt/delovoy-park/scripts/setup-agent-workspace.sh

# 2. Авторизовать Claude Code через claude.ai OAuth (API key не нужен)
docker compose exec agent claude login
# → Откроется URL в stdout, пройди авторизацию в браузере

# 3. Перезапустить сервис чтобы подхватить auth
docker compose restart agent
docker compose logs -f agent  # должно быть "Bot is running, waiting for messages"
```

**GitHub Secrets для агента:**

| Secret | Описание |
|--------|----------|
| `AGENT_TELEGRAM_BOT_TOKEN` | Токен нового бота (создать через @BotFather) |
| `AGENT_TELEGRAM_USER_ID` | Твой Telegram user_id (получить у @userinfobot) |
| `AGENT_GITHUB_PAT` | Fine-grained PAT: repo `contents:write` + `pull-requests:write` |

**Команды бота:**
- Любой текст → выполнить задачу через Claude Code
- `/status` → состояние очереди
- `/start` → приветствие + справка

---

## Правило №1: Никогда не пушь в main напрямую

**Весь код идёт через Pull Request.**

```
Рабочий процесс:
1. claude/fix-thing  или  feature/module-feature  ← рабочая ветка
2. Push в GitHub
3. CI автоматически: lint → test → typecheck → build
4. Если CI зелёный → PR → Review → Merge в main
5. Merge в main → автодеплой на VPS
```

Исключений нет. Даже hotfix идёт через PR (можно с пометкой `hotfix/`).

---

## Правило №2: CI — обязательный гейт

На **каждый PR** автоматически запускается:

| Шаг | Что проверяет | Время |
|-----|--------------|-------|
| `lint` | ESLint — стиль кода, ошибки | ~30 сек |
| `test` | Vitest — юнит-тесты | ~1 мин |
| `typecheck` | `tsc --noEmit` — типы TypeScript | ~30 сек |
| `build` | Docker build — приложение собирается | ~2 мин |

**PR нельзя мержить, если CI красный.** Настрой в GitHub:
- Settings → Branches → Branch protection rules → `main`
- Включи: "Require status checks to pass before merging"
- Выбери: `lint`, `test`, `typecheck`, `build`
- Включи: "Require branches to be up to date before merging"

---

## Правило №3: Автодеплой при мерже в main

При push/merge в `main`:

1. **Snapshot** — снапшот сервера через Timeweb API (если токен настроен)
2. **Build** — Docker-образ собирается в GitHub Actions
3. **Push** — образ пушится в GitHub Container Registry (GHCR)
4. **Deploy** — GitHub Actions по SSH:
   - Делает `docker pull` нового образа
   - Делает **бэкап БД** (`pg_dump`)
   - Запускает новый контейнер (`docker compose up -d --no-deps app`)
   - Ждёт health check (до 30 попыток по 5 сек = 2.5 мин)
4. **Verify** — проверяет `https://delovoy-park.ru/api/health`
5. **Rollback** — если health check не проходит, откатывает образ
6. **Alert** — при ошибке шлёт алерт в Telegram

---

## Правило №4: Бэкапы автоматические

- **Перед каждым деплоем** — полный дамп PostgreSQL
- Хранение: `/opt/backups/db-YYYYMMDD-HHMMSS.sql.gz`
- **Ежедневный бэкап** — cron `30 1 * * *` UTC (04:30 MSK) запускает
  `/opt/delovoy-park/scripts/cron-backup.sh` (регистрируется автоматически
  шагом деплоя; `pg_dump` через `docker exec`, `nice/ionice`, GFS-ротация,
  S3-загрузка, запись в `BackupLog`)
- Автоочистка: cron удаляет бэкапы старше 30 дней
- Ручной бэкап:
  ```bash
  ssh deploy@VPS "docker compose -f /opt/delovoy-park/docker-compose.yml exec -T postgres pg_dump -U delovoy delovoy_park | gzip > /opt/backups/manual-$(date +%Y%m%d).sql.gz"
  ```

---

## Правило №5: Миграции БД — осторожно

`prisma migrate deploy` выполняется автоматически в deploy.yml **до подмены контейнера** (`docker compose run --rm app npx prisma migrate deploy` новым образом, пока старый app обслуживает трафик). Провал миграции = деплой отменён, работающее приложение не тронуто. В `docker-entrypoint.sh` миграций больше нет — они держали порт 3000 мёртвым 1–3 минуты на каждом старте (инцидент 2026-07-20).

**Безопасные изменения** (деплоятся автоматически):
- Добавление нового поля с дефолтом
- Добавление новой таблицы
- Добавление индекса

**Опасные изменения** (требуют ручной миграции):
- Удаление поля/таблицы
- Переименование поля/таблицы
- Изменение типа поля
- Добавление NOT NULL без дефолта

Для опасных изменений:
1. Создай Prisma migration: `npx prisma migrate dev --name описание`
2. Проверь SQL в `prisma/migrations/`
3. Протестируй на локальном Docker
4. Деплой с мониторингом

---

## Правило №6: Мониторинг после деплоя

После каждого деплоя проверь:
1. `https://delovoy-park.ru/api/health` — должен вернуть `{"success": true}`
2. Основные страницы: `/`, `/cafe`, `/ps-park`, `/gazebos`, `/rental`
3. Логи: `ssh deploy@VPS "docker logs delovoy-app --tail 50"`

### Site Watchdog — постоянный внешний надзор + авто-восстановление

Workflow `.github/workflows/site-watchdog.yml` каждые ~5 минут проверяет
`https://delovoy-park.ru` (главная + `/api/health`) с раннера GitHub.
При недоступности: SSH на VPS → `scripts/watchdog-remediate.sh`
(диагностика + ступенчатое восстановление: зомби-контейнеры → nginx →
`docker restart delovoy-app` → `docker compose up -d`), Telegram-алерт с
диагностикой и GitHub issue с label `site-down` (закрывается автоматически
при восстановлении). Перезагрузка всего сервера — только вручную:
`timeweb-manage.yml → server-reboot`.

Ручной запуск: Actions → Site Watchdog → Run workflow
(`check-only` — только проверка, `force-remediate` — учебный прогон
восстановления).

### Прод-сервер (проверено 2026-07-18 через Timeweb API)

`delovoy-park-prod` (id 7548623): **2 CPU / 4 GB RAM / 48 GB NVMe**,
preset 2453, Ubuntu, локация ru-1, TZ = UTC. Диагностика без захода в
панель: `timeweb-manage.yml → server-status | server-logs | ops-diagnose`.

---

## Runbook: Telegram недоступен с VPS

Симптом: уведомления не доставляются, в логах/админке ошибка вида
«Сервер не смог соединиться с Telegram API» (`TELEGRAM_UNREACHABLE`), бот молчит.
Все серверные вызовы Bot API идут через `src/lib/telegram/client.ts`
(таймаут 15 с + env-переключатели), бот grammy — через те же env.

### Шаг 1 — Диагностика

Actions → **Telegram Diagnose** → Run workflow (chat_id по умолчанию — владелец).
- **Job `from-github`** проверяет токен и chat_id с раннера GitHub (вне РФ) и шлёт
  тестовое сообщение → отделяет проблему токена/чата от сетевой.
- **Job `from-vps`** по SSH прогоняет с сервера: DNS A/AAAA, `curl -4/-6` к
  `getMe`, baseline-контроли (api.github.com, ya.ru), проверку изнутри
  контейнера `app` — и печатает вердикт последним блоком лога.

### Шаг 2 — Митигация по вердикту

| Вердикт | Причина | Действие |
|---------|---------|----------|
| `TOKEN_INVALID` | Токен отозван/сменён | Обновить `TELEGRAM_BOT_TOKEN` в GH Secrets → redeploy |
| `DNS_FAIL` | Резолвер сервера не отвечает | Проверить `resolvectl status`, `/etc/resolv.conf`; сменить DNS на 1.1.1.1/8.8.8.8 |
| `V6_ONLY_FAIL` | Сломан IPv6-маршрут, а AAAA предпочитается | Отключить/депроритизировать IPv6 (`sysctl net.ipv6.conf.all.disable_ipv6=1` или `gai.conf`) |
| `CONTAINER_ONLY_FAIL` | Хост видит Telegram, контейнер — нет | Docker DNS/MTU: проверить `/etc/docker/daemon.json`, перезапустить docker |
| `NETWORK_DOWN` | Весь egress сломан | Тикет в Timeweb, проверить firewall egress |
| `FULL_BLOCK` | api.telegram.org блокируется с IP сервера | Включить обход (ниже) |

**Обход `FULL_BLOCK`** — задать один из GH Secrets и передеплоить
(deploy.yml сам занесёт их в `/opt/delovoy-park/.env`; пустые секреты
пропускаются), либо вписать в `.env` на сервере и `docker compose up -d app bot`:

1. `TELEGRAM_PROXY_URL` — HTTP(S) CONNECT-прокси. **Развёрнуто и используется:**
   3proxy в Docker на Hetzner-сервере агента (тот же бокс, где `platform-delovoy-agent`),
   порт открыт firewall'ом только для IP прод-VPS. Поднимается/переустанавливается
   идемпотентно workflow'ом **Telegram Relay Setup** (`.github/workflows/telegram-relay-setup.yml`,
   `Actions → Telegram Relay Setup → Run workflow`) — он же прописывает
   `TELEGRAM_PROXY_URL` в `/opt/delovoy-park/.env` и перезапускает `app`/`bot`.
   Credentials лежат на Hetzner-сервере в `/opt/tg-proxy/credentials` (не в репо).
   SOCKS не поддерживается — для него нужен вариант 2.
2. `TELEGRAM_API_ROOT` — релей Bot API (альтернатива/резерв, не развёрнут):
   - **Cloudflare Worker** (бесплатно): worker, проксирующий
     `https://api.telegram.org${url.pathname}${url.search}` c методом/телом as-is;
   - **nginx на Hetzner**: `location ~ ^/bot { proxy_pass https://api.telegram.org; proxy_ssl_server_name on; }`
     + allowlist по IP VPS. ⚠️ В URI содержится токен бота — на релее
     отключить логирование URI (`access_log off`).

⚠️ Ограничение обхода: shell-скрипты (`scripts/backup-db.sh`, `scripts/staging-refresh.sh`)
уважают только `TELEGRAM_API_ROOT`, не `TELEGRAM_PROXY_URL` — их алерты идут
по прямому пути и при `FULL_BLOCK` не доставляются, пока не настроен вариант 2.

### Шаг 3 — Проверка

Повторно запустить **Telegram Diagnose** — при активном обходе основной
вердикт останется `FULL_BLOCK`, но появится строка `BYPASS: OK` и сообщение
уйдёт через прокси/релей. Затем из админки `POST /api/admin/telegram/test-owner`.

---

## Правило №7: Версионирование

Версия в `package.json` обновляется по semver:
- `PATCH` (0.1.x) — баг-фиксы, мелкие правки
- `MINOR` (0.x.0) — новая фича, новый модуль
- `MAJOR` (x.0.0) — ломающие изменения API

Каждый Docker-образ тегируется: `latest`, `SHA`, `version`.

---

## Настройка GitHub Secrets

Для работы CI/CD нужно добавить secrets в GitHub:
Settings → Secrets and variables → Actions → New repository secret

| Secret | Значение | Где взять |
|--------|---------|-----------|
| `VPS_HOST` | IP-адрес Timeweb VPS | Timeweb API или панель |
| `VPS_USER` | `deploy` | Создаётся при провизионинге |
| `VPS_SSH_KEY` | Приватный SSH-ключ | `ssh-keygen -t ed25519` |
| `TIMEWEB_API_TOKEN` | JWT-токен Timeweb Cloud API | Панель Timeweb → Настройки → API и Terraform |
| `GITHUB_TOKEN` | Автоматический | Есть по умолчанию |

Environment "production" (Settings → Environments):
- Protection rules: Required reviewers (опционально)

---

## Настройка Branch Protection

GitHub → Settings → Branches → Add rule:
- Branch name pattern: `main`
- [x] Require a pull request before merging
- [x] Require status checks to pass before merging
  - Status checks: `Lint`, `Test`, `TypeScript Check`, `Build Docker Image`
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings

---

## Рабочий процесс с Claude Code

```
1. Открой VSCode с Claude Code
2. Claude создаёт ветку: claude/task-name или feature/module-feature
3. Claude пишет код + тесты
4. Claude пушит ветку, создаёт PR
5. CI проверяет автоматически (lint, test, typecheck, build)
6. Если CI красный — Claude фиксит и пушит снова
7. Ты ревьюишь PR (или сразу мержишь, если доверяешь)
8. Merge → автодеплой на delovoy-park.ru
9. Проверяешь сайт — готово!
```

---

## Первоначальная настройка VPS

### Вариант А: Автоматически через Timeweb API (рекомендуется)

Всё управление VPS через GitHub Actions — без захода в панель Timeweb.

**Предварительные требования:**
- GitHub Secret `TIMEWEB_API_TOKEN` — API-токен из панели Timeweb (Настройки → API и Terraform)

**Полный провизионинг (одна команда):**
```bash
gh workflow run timeweb-provision.yml -f action=full-provision -f preset_id=2453 -f ssh_public_key="ssh-ed25519 AAAA..."
```

Это автоматически:
1. Добавит SSH-ключ в Timeweb
2. Создаст сервер (Ubuntu 24.04, 2 CPU / 4 GB RAM / 50 GB NVMe)
3. Настроит firewall (порты 22, 80, 443)
4. Настроит DNS (delovoy-park.ru → IP сервера)
5. Установит Docker, Nginx, Certbot, fail2ban, UFW
6. Создаст пользователя `deploy`
7. Получит SSL-сертификат
8. Создаст production-конфигурацию

**Доступные тарифы серверов:**

| Preset ID | CPU | RAM | Disk | Цена/мес |
|-----------|-----|-----|------|----------|
| 2449 | 1 | 2 GB | 30 GB | 550 ₽ |
| 2451 | 2 | 2 GB | 40 GB | 800 ₽ |
| **2453** | **2** | **4 GB** | **50 GB** | **1000 ₽** (рекомендуется) |
| 2455 | 4 | 8 GB | 80 GB | 1800 ₽ |

**После создания VPS — добавь GitHub Secrets:**
```bash
gh secret set VPS_HOST --body "IP_АДРЕС_СЕРВЕРА"
gh secret set VPS_USER --body "deploy"
gh secret set VPS_SSH_KEY < ~/.ssh/deploy_key
```

### Управление VPS через Timeweb API

```bash
# Статус сервера
gh workflow run timeweb-manage.yml -f action=server-status

# Полный отчёт (сервер + DNS + firewall + баланс)
gh workflow run timeweb-manage.yml -f action=account-full-status

# Перезагрузка
gh workflow run timeweb-manage.yml -f action=server-reboot

# Создать снапшот
gh workflow run timeweb-manage.yml -f action=backup-create

# Логи контейнеров
gh workflow run timeweb-manage.yml -f action=server-logs

# DNS-записи
gh workflow run timeweb-manage.yml -f action=dns-list
gh workflow run timeweb-manage.yml -f action=dns-add-a -f dns_subdomain=api -f dns_value=1.2.3.4

# Firewall
gh workflow run timeweb-manage.yml -f action=firewall-list
gh workflow run timeweb-manage.yml -f action=firewall-add-rule -f firewall_port=8080

# Баланс
gh workflow run timeweb-manage.yml -f action=account-balance

# Произвольный API-вызов
gh workflow run timeweb-manage.yml -f action=custom-api -f custom_endpoint=/api/v1/servers -f custom_method=GET
```

### Вариант Б: Ручная настройка (legacy)

```bash
# 1. Запусти скрипт начальной настройки
ssh root@YOUR_VPS "bash -s" < scripts/setup-vps.sh

# 2. Скопируй production файлы
scp docker-compose.prod.yml deploy@YOUR_VPS:/opt/delovoy-park/docker-compose.yml
scp .env.production deploy@YOUR_VPS:/opt/delovoy-park/.env

# 3. Настрой SSL
ssh root@YOUR_VPS "certbot --nginx -d delovoy-park.ru -d www.delovoy-park.ru"

# 4. Авторизуй GHCR на сервере
ssh deploy@YOUR_VPS "echo YOUR_GITHUB_PAT | docker login ghcr.io -u aylisrg --password-stdin"

# 5. Первый запуск
ssh deploy@YOUR_VPS "cd /opt/delovoy-park && docker compose up -d"

# 6. Добавь GitHub Secrets (VPS_HOST, VPS_USER, VPS_SSH_KEY)
# 7. Настрой Branch Protection в GitHub
```

---

## Откат

Если деплой прошёл, но что-то сломалось:

```bash
# 1. Посмотри доступные версии
ssh deploy@YOUR_VPS "docker images ghcr.io/aylisrg/platform-delovoy --format '{{.Tag}}\t{{.CreatedAt}}'"

# 2. Откатись на предыдущий образ
ssh deploy@YOUR_VPS "cd /opt/delovoy-park && \
  docker compose stop app && \
  docker tag ghcr.io/aylisrg/platform-delovoy:PREVIOUS_SHA ghcr.io/aylisrg/platform-delovoy:latest && \
  docker compose up -d app"

# 3. Если нужно откатить БД
ssh deploy@YOUR_VPS "zcat /opt/backups/db-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T postgres psql -U delovoy delovoy_park"
```

---

## Структура файлов DevOps

```
.github/
├── workflows/
│   ├── ci.yml                  # CI: lint, test, typecheck, build (на PR)
│   ├── deploy.yml              # CD: build → push → deploy (на push в main)
│   ├── timeweb-provision.yml   # Создание и настройка VPS через Timeweb API
│   └── timeweb-manage.yml      # Управление VPS (статус, DNS, firewall, бэкапы)
├── CODEOWNERS              # Кто ревьюит что
├── pull_request_template.md
└── dependabot.yml

docker-compose.yml          # Для локальной разработки
docker-compose.prod.yml     # Для продакшна (Timeweb VPS)
Dockerfile                  # Multi-stage build
docker-entrypoint.sh        # Startup: crash-loop guard → start (миграции/сид — в deploy.yml)

scripts/
├── setup-vps.sh            # Первоначальная настройка VPS
├── seed.ts                 # Seed данных
└── health-check.ts         # External health check
```

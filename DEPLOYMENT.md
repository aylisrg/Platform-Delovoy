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
                                                  │  ├ postgres  │
                                                  │  └ redis     │
                                                  └──────────────┘
                                                         │
                                                         ▼
                                                  delovoy-park.ru
```

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

1. **Build** — Docker-образ собирается в GitHub Actions
2. **Push** — образ пушится в GitHub Container Registry (GHCR)
3. **Deploy** — GitHub Actions по SSH:
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
- Автоочистка: cron удаляет бэкапы старше 30 дней
- Ручной бэкап:
  ```bash
  ssh deploy@VPS "docker compose -f /opt/delovoy-park/docker-compose.yml exec -T postgres pg_dump -U delovoy delovoy_park | gzip > /opt/backups/manual-$(date +%Y%m%d).sql.gz"
  ```

---

## Правило №5: Миграции БД — осторожно

Prisma `db push` выполняется автоматически при старте контейнера (в `docker-entrypoint.sh`).

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
| `VPS_HOST` | IP-адрес Timeweb VPS | Панель Timeweb |
| `VPS_USER` | `deploy` | Создаётся скриптом `setup-vps.sh` |
| `VPS_SSH_KEY` | Приватный SSH-ключ | `ssh-keygen -t ed25519` |
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

## Первоначальная настройка VPS (один раз)

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
│   ├── ci.yml              # CI: lint, test, typecheck, build (на PR)
│   └── deploy.yml          # CD: build → push → deploy (на push в main)
├── CODEOWNERS              # Кто ревьюит что
├── pull_request_template.md
└── dependabot.yml

docker-compose.yml          # Для локальной разработки
docker-compose.prod.yml     # Для продакшна (Timeweb VPS)
Dockerfile                  # Multi-stage build
docker-entrypoint.sh        # Startup: prisma generate → db push → seed → start

scripts/
├── setup-vps.sh            # Первоначальная настройка VPS
├── seed.ts                 # Seed данных
└── health-check.ts         # External health check
```

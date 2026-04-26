# ADR: Staging Environment + Backup Strategy

- **Дата:** 2026-04-21
- **Статус:** Proposed (ожидает решений CTO по операционным вопросам из §5)
- **Модуль:** core / infrastructure
- **Фаза:** Phase 1 (блокер дальнейшего масштабирования)
- **Автор:** System Architect
- **Связанный PRD:** `docs/requirements/2026-04-21-staging-and-backups-prd.md`

---

## 1. Контекст

Сейчас команда тестирует всё на проде (`delovoy-park.ru`). Это приемлемо было для запуска (17.04.2026), но блокирует дальнейший релиз-цикл: невозможно безопасно проверить миграцию, поведение Telegram-бота, интеграции (Novofon, Yandex, SMTP) без риска для реальных арендаторов и клиентов.

Одновременно бекап-стратегия фрагментарна: в репозитории уже есть `scripts/backup-db.sh`, `scripts/cron-backup.sh`, `scripts/restore-backup.sh` и `backup` profile в `docker-compose.yml`, плюс pre-deploy `pg_dump` внутри `deploy.yml`. Но:

- Нет API/UI для просмотра списка бекапов и запуска restore.
- Нет явного гейта «миграция не стартует без свежего дампа».
- Хранилище — локальный том на том же диске что прод БД (нарушает FR-008).
- Нет поддержки PIT restore одной таблицы/записи.
- Нет `BackupLog` — аудит истории бекапов невозможен.

Staging тоже начат (`docker-compose.staging.yml`, `.github/workflows/deploy-staging.yml`, `scripts/setup-staging.sh`), но не доведён до рабочего состояния: нет защиты доступа, нет отдельного Telegram-бота, не протестирован end-to-end, нет ручного триггера с контролируемым «временем до готовности <3 мин».

**Задача ADR:** закрыть оба гапа одним связным решением, опираясь на уже написанные скрипты.

---

## 2. Рассмотренные альтернативы

### 2.1 Staging: где размещать

| Вариант | Плюсы | Минусы | Вердикт |
|---------|-------|--------|---------|
| **A. Тот же VPS, отдельные контейнеры** (PRD рекомендует) | Нулевые доп. расходы, быстрый деплой, shared Nginx/SSL | Делит RAM/CPU/диск с продом, risk «staging положил прод» | **Выбран** — при текущей нагрузке (см. §8) ресурсы есть |
| B. Отдельный VPS (preset 2449, 550 ₽/мес) | Полная изоляция | +550 ₽/мес, ещё один CI/CD target | Отложено до P5.2+ |
| C. Ephemeral (vercel preview / fly.io) | Per-PR окружения | Telegram-бот и БД — не подойдут | Не подходит |

### 2.2 Backup storage

| Вариант | Плюсы | Минусы | Вердикт |
|---------|-------|--------|---------|
| A. Локальный том на том же VPS | Бесплатно, быстрый restore | Диск умер → бекап умер (нарушает FR-008) | Только staging |
| **B. Timeweb S3 (S3-compatible)** | Тот же провайдер, RU-юрисдикция, дешёвый трафик внутри DC | Vendor lock, но минимальный (S3 API) | **Выбран для прода** (рекомендация PRD) |
| C. External S3 (Backblaze B2 / Yandex Object Storage) | Полная независимость от Timeweb | Трафик платный, валюта, compliance | Fallback |

### 2.3 PIT Restore — true PITR (WAL) vs logical snapshots

| Вариант | Плюсы | Минусы | Вердикт |
|---------|-------|--------|---------|
| A. PostgreSQL WAL archiving + `pg_basebackup` → истинный PIT на секунду | Откат к любому моменту | Сложная настройка, нужен WAL archive, занимает х3 места, restore всей БД (не таблицы) | Overkill |
| **B. Логический дамп + restore в изолированную БД + выборка нужной таблицы/записи** | Простая реализация, работает с существующим `pg_dump`, точечный restore | Гранулярность — 1 день (интервал между дампами) | **Выбран** |
| C. CDC / logical replication слот | Near-RT восстановление | Инфраструктурная сложность | Не для P1 |

**Пояснение к B:** под «PIT» в PRD понимается _point-in-item_ restore — восстановление конкретной таблицы или записи, а не секунды. Реализация: берём нужный дамп → восстанавливаем в **temp schema** staging-БД (`restore_temp_<backup_id>`) → `COPY`/`INSERT … SELECT` из temp schema в прод. Это покрывает acceptance criteria «PIT restore одной записи».

### 2.4 Защита staging

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| A. Basic Auth (Nginx) | 1 строка в Nginx | Отдельный пароль, не привязан к роли |
| B. IP allowlist | Просто | CEO работает с мобильных/разных сетей |
| **C. NextAuth session + middleware role gate** | Единая система ролей, SUPERADMIN-only | Нужно дублировать auth endpoints на staging |

**Выбрано C** — логика уже есть (`requireAdminSection`, `hasRole`), добавляем только **middleware-переключатель** на staging: если `process.env.STAGING_LOCKDOWN === "true"` → все non-public routes требуют `role === "SUPERADMIN"`. Публичные страницы (`/`, `/cafe`, `/ps-park`, ...) доступны, но с баннером «STAGING — не делайте реальных заказов». Доп. слой — Basic Auth на Nginx для всего staging-поддомена как второй барьер (защищает от случайной индексации и crawler-ов).

---

## 3. Решение

### 3.1 Staging (FR-001…FR-007)

- Хостинг: **тот же VPS**, отдельный compose stack `/opt/delovoy-park-staging/` (уже начат).
- Домен: `staging.delovoy-park.ru`, DNS A-record на тот же IP, Nginx proxy → `127.0.0.1:3001`, SSL через Certbot.
- Изолированные сервисы: `delovoy-staging-postgres`, `delovoy-staging-redis`, `delovoy-staging-app` в отдельном Docker network `delovoy-staging-net` (добавить в `docker-compose.staging.yml` секцию `networks`).
- **Отдельная БД** `delovoy_park_staging`, отдельный password, отдельный том `staging_postgres_data`. Credentials — в `/opt/delovoy-park-staging/.env.staging`, не пересекаются с прод.
- **Старт с пустой БД** — `docker-entrypoint.sh` видит `NODE_ENV=staging` или `SEED_MODE=empty` → запускает только `prisma db push` без seed (FR-005).
- **Staging Telegram-бот:** отдельный токен (`STAGING_TELEGRAM_BOT_TOKEN`), отдельный admin chat (`STAGING_TELEGRAM_ADMIN_CHAT_ID`). Бот-процесс запускается только если переменные заданы — в противном случае staging-контейнер работает без бота (FR-007).
- **Доступ (FR-002):** двухслойная защита:
  1. Nginx Basic Auth на `staging.delovoy-park.ru` (htpasswd с единым паролем, выдаётся CEO/разработчику) — барьер от индексации и случайных заходов.
  2. Внутри приложения флаг `STAGING_LOCKDOWN=true` + middleware-проверка: all `/admin/*` и mutating API требуют `session.user.role === "SUPERADMIN"`. Публичные страницы — с визуальным `<StagingBanner />`.
- **Ручной деплой (FR-003):** GitHub Actions `workflow_dispatch` на существующем `deploy-staging.yml`. Текущий авто-триггер на success CI — **оставляем как опцию** (continuous staging), но добавляем `inputs.manual_only: bool` чтобы CEO мог нажать кнопку в GitHub UI и задеплоить конкретный SHA.
- **<3 мин деплой (FR-006):** см. §6.1.

### 3.2 Backups (FR-008…FR-015)

- **Daily pg_dump** прод БД в 03:00 MSK (cron на VPS), запускается через `scripts/cron-backup.sh` (уже есть).
- **Storage:** Timeweb S3 bucket `delovoy-backups` + локальный кэш `/opt/backups/postgres/daily/` (последние 7 дней для быстрого restore без скачивания).
- **Retention:** **GFS — 7 daily + 4 weekly + 12 monthly** (см. §5 Open Q #2). Старые удаляются lifecycle-политикой S3 и `find -mtime` локально.
- **Pre-migration hook (FR-010):** package.json script `db:migrate:prod` обёрнут bash-скриптом `scripts/pre-migration-backup.sh`, который:
  1. Запускает `pg_dump` → сохраняет локально + заливает в S3 префикс `pre-migration/`.
  2. Создаёт `BackupLog` запись с `type=PRE_MIGRATION`.
  3. Возвращает exit 0 только при успехе. Если шаг fail → миграция не стартует.
  4. В CI workflow `_run-migration.yml` — отдельный `job: backup` с `needs: backup` на job `migrate`.
- **PIT restore (FR-012):** API `POST /api/admin/backups/restore` принимает `backup_id + scope (full|table|record) + target`. Для `table|record`:
  1. Скачивает дамп в временный volume `/tmp/restore/<jobId>/`.
  2. Создаёт временную БД `restore_tmp_<jobId>` в staging Postgres (не в прод!).
  3. `pg_restore` туда.
  4. Выполняет `pg_dump -t <table>` + `psql` target либо `SELECT + INSERT ON CONFLICT` для single record.
  5. Удаляет временную БД.
  6. Логирует в `BackupLog` с `type=RESTORE`.
- **Telegram alert on fail (FR-014):** уже работает в `backup-db.sh`. Добавляем: success-toast в опциональный чат при `BACKUP_NOTIFY_ON_SUCCESS=true` (FR-015).
- **История (FR-013):** `GET /api/admin/backups` — читает из `BackupLog` (с фильтром по типу/статусу/дате).

---

## 4. Component Diagram

```
                         TIMEWEB VPS (preset 2453: 2 CPU, 4 GB RAM, 50 GB SSD)
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│   Nginx (443 SSL)                                                                │
│   ├─ delovoy-park.ru          → 127.0.0.1:3000 (prod app)                        │
│   └─ staging.delovoy-park.ru  → 127.0.0.1:3001 (staging app, + Basic Auth)       │
│                                                                                  │
│   ┌─────────── PROD STACK ──────────┐   ┌──────── STAGING STACK ─────────┐      │
│   │ docker network: delovoy-net     │   │ docker network: delovoy-stg-net │      │
│   │                                  │   │                                  │     │
│   │  delovoy-app        (1 GB RAM)   │   │  delovoy-staging-app  (512 MB)  │     │
│   │  delovoy-postgres   (512 MB)     │   │  delovoy-staging-pg    (256 MB) │     │
│   │  delovoy-redis      (128 MB)     │   │  delovoy-staging-redis (64 MB)  │     │
│   │  delovoy-bot        (shared)     │   │  delovoy-staging-bot   (opt.)   │     │
│   │                                  │   │                                  │     │
│   │  DATABASE_URL → delovoy_park     │   │  DATABASE_URL → *_staging       │     │
│   │  TELEGRAM_BOT_TOKEN=prod         │   │  TELEGRAM_BOT_TOKEN=staging_*   │     │
│   └──────────────────────────────────┘   └─────────────────────────────────┘     │
│                                                                                  │
│   cron (03:00 MSK) → scripts/cron-backup.sh                                      │
│         │                                                                        │
│         ├─► pg_dump prod DB                                                      │
│         ├─► gzip → /opt/backups/postgres/daily/<ts>.sql.gz (local cache, 7 дней)│
│         ├─► aws s3 cp → s3://delovoy-backups/daily/<ts>.sql.gz                   │
│         └─► INSERT BackupLog(status=SUCCESS, sizeBytes, storagePath)             │
│                                                                                  │
└──────────────────────────────┬───────────────────────────────────────────────────┘
                               │
                               ▼
                  ┌───────────────────────────┐
                  │   TIMEWEB S3              │
                  │   bucket: delovoy-backups │
                  │   ├─ daily/   (7 дней)    │
                  │   ├─ weekly/  (4 недели)  │
                  │   ├─ monthly/ (12 мес)    │
                  │   └─ pre-migration/       │
                  │      (<SHA>/<ts>.sql.gz)  │
                  │                           │
                  │   lifecycle policy: auto- │
                  │   delete по retention     │
                  └───────────────────────────┘

Restore flow (PIT, scope=record):
  SUPERADMIN → UI → POST /api/admin/backups/restore { backup_id, scope: "record", table: "Booking", where: {...} }
    → Backup service скачивает dump из S3
    → pg_restore в temp DB на staging Postgres
    → SELECT нужную запись
    → INSERT/UPDATE в прод Postgres (с write-lock на таблицу)
    → Drop temp DB
    → BackupLog (type=RESTORE, scope, target, performedBy)
    → Telegram notify SUPERADMIN
```

---

## 5. Ответы на Open Questions из PRD

| # | Вопрос | Решение | Кто решает |
|---|--------|---------|------------|
| 1 | Где хранить дампы | **Timeweb S3** (единый провайдер, RU-юрисдикция, дешёвый трафик внутри DC). Локальный кэш 7 дней — для быстрого restore. | **CTO** (если выберет external S3 — легко подменить `BACKUP_S3_ENDPOINT`) |
| 2 | Retention flat 90d vs GFS | **GFS: 7 daily + 4 weekly + 12 monthly**. Экономит storage (~30% от 90 daily), даёт длинный history. Flat 90d — при явном требовании compliance. | **Architect (решено)** — CTO может оверрайднуть |
| 3 | Бекапы uploaded files | **Вне scope этой задачи.** Создать follow-up issue «Object Storage для пользовательских файлов + backup» (см. §11). На данный момент файлы хранятся в `public/uploads/` на VPS — защищены Timeweb infra-snapshot. | **CTO** (стоит ли включить сейчас) |
| 4 | Admin UI для backup/restore | **Минимальный UI в Phase 1:** страница `/admin/architect/backups` со списком + кнопкой «Restore». Restore Scope UI — только `full | table`, record-level — CLI-only до Phase 2. Full UI — follow-up. | **Architect (решено)** |
| 5 | Seed fixtures для staging | **Всегда пусто.** CEO заполняет вручную (так в PRD FR-005). Позже добавим `npm run seed:staging` с минимальным фикстурным набором (1 кафе-item, 1 беседка, 1 резервация) — follow-up. | **Architect (решено)** |
| 6 | Multiple staging branches | **Не сейчас.** Один staging-stack. Архитектура compose-файла допускает параметризацию `STAGING_NAME` → можно добавить позже без миграции данных. | **Architect (решено)** |

---

## 6. Deployment Flow

### 6.1 Staging deploy (<3 мин)

Бюджет времени (p95):

| Шаг | Время | Как достигается |
|------|-------|----------------|
| 1. CEO нажимает `Run workflow` → `deploy-staging.yml` | ~5 с | GitHub UI |
| 2. Retag existing `sha-<SHA>` image → `:staging` (GitHub Action `docker buildx imagetools create`) | ~15 с | Образ уже собран в CI — **не пересобираем** |
| 3. SSH в VPS, `docker pull ghcr.io/...:staging` | ~20 с | Layer cache; образ ~150 МБ |
| 4. `docker compose up -d --no-deps app` | ~10 с | Только app, postgres/redis не трогаем |
| 5. Health check loop (15 попыток × 5 с, обычно hit на 3-й) | ~15-60 с | `wget /api/health` |
| 6. Telegram notify | ~2 с | |
| **Итого p50** | **~1:10** | |
| **Итого p95** | **~2:30** | |

Ускорители:
- Fast path — no rebuild on auto-deploy (уже реализовано в `deploy-staging.yml` строка 44).
- `start_period: 60s` в healthcheck → health-check может пройти сразу, как только Next.js warm-up закончится.
- `depends_on: service_healthy` — postgres/redis уже подняты, `app` стартует в ~8 с.

### 6.2 Prod deploy — без изменений относительно текущего `deploy.yml`. Добавляется только `BackupLog` запись после pre-deploy dump.

---

## 7. Backup Flow (детально)

### 7.1 Cron schedule

```cron
# /etc/cron.d/delovoy-backup (на VPS, от имени root)
0 3 * * *   deploy  /opt/delovoy-park/scripts/cron-backup.sh >> /var/log/delovoy-backup.log 2>&1
```

### 7.2 Расширенный `backup-db.sh` (доработки)

```bash
# Доработки к существующему скрипту:
pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=custom -Z 9 -f "$BACKUP_FILE"
# --format=custom → pg_restore поддерживает -t для per-table restore

# После успеха — аплоад в S3
aws s3 cp "$BACKUP_FILE" "s3://delovoy-backups/daily/$(basename $BACKUP_FILE)" \
  --endpoint-url "$S3_ENDPOINT"

# GFS rotation — новая логика:
# - daily/   — mtime >7 дней → delete (локально) + S3 lifecycle 7d
# - weekly/  — копия каждого воскресенья, delete >28 дней
# - monthly/ — копия 1-го числа, delete >365 дней

# Запись в БД через psql → INSERT BackupLog
psql "$DATABASE_URL" -c "INSERT INTO \"BackupLog\" (id, type, status, \"sizeBytes\", \"storagePath\", \"createdAt\") VALUES ('$(uuidgen)', 'DAILY', 'SUCCESS', $SIZE, '$S3_KEY', NOW());"
```

### 7.3 Pre-migration hook

Новый скрипт `scripts/pre-migration-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Обязательный hook перед prisma migrate deploy. Fail → migration aborts.
MIGRATION_TAG="${1:-manual}"
TS=$(date +%Y%m%d_%H%M%S)
FILE="/opt/backups/postgres/pre-migration/${MIGRATION_TAG}_${TS}.dump"
mkdir -p "$(dirname "$FILE")"

pg_dump "$PROD_DATABASE_URL" --format=custom -Z 9 -f "$FILE"
aws s3 cp "$FILE" "s3://delovoy-backups/pre-migration/$(basename $FILE)" --endpoint-url "$S3_ENDPOINT"

# Record в БД
psql ... INSERT BackupLog type='PRE_MIGRATION' ...

echo "Pre-migration backup OK: $FILE"
```

Вшиваем в `.github/workflows/_run-migration.yml` отдельным job'ом:

```yaml
jobs:
  backup:
    name: Pre-migration backup (REQUIRED)
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with: { ... }
        script: |
          set -e
          /opt/delovoy-park/scripts/pre-migration-backup.sh "${{ github.ref_name }}"
  migrate:
    needs: backup   # <-- блокирует миграцию если backup failed
    ...
```

Локально (для dev): `package.json` скрипт:
```json
"db:migrate:prod": "bash scripts/pre-migration-backup.sh $npm_package_version && prisma migrate deploy"
```

---

## 8. Resource footprint

**Текущий VPS (preset 2453):** 2 vCPU, 4 GB RAM, 50 GB SSD.

**Текущее потребление (по `docker-compose.yml` limits, production):**
- app: 1 GB
- postgres: 512 MB
- redis: 128 MB
- **Занято прод-стеком:** ~1.6 GB RAM, ~1.2 vCPU, ~8 GB disk (БД + логи + образы).

**Планируемое staging-потребление (лимиты уже заданы в `docker-compose.staging.yml`):**
- app: 512 MB
- postgres: 256 MB
- redis: 64 MB
- **Итого staging:** ~0.8 GB RAM, ~0.5 vCPU, ~2 GB disk (пустая БД + один образ).

**Остаток:** RAM 4 − 1.6 − 0.8 = **1.6 GB свободно** (ядро, Nginx, cron, бекап-процессы); disk 50 − 8 − 2 − 5 (локальный кэш бекапов) = **35 GB свободно**.

**Вывод:** headroom есть. Тем не менее, рекомендую CTO включить Prometheus node-exporter + Telegram-алерт на `memory > 80%` / `disk > 75%` как превентивную меру (follow-up issue).

Если параллельный нагрузочный тест на staging + прод в пике совпадут — вероятен OOM. Митигация:
- `deploy.resources.limits` уже заданы → Docker не даст staging съесть прод-RAM.
- Staging postgres `shared_buffers=64MB` (форсить в `command:`).

---

## 9. Security

### 9.1 Staging access (FR-002)

**Два слоя:**
1. **Nginx Basic Auth** на `staging.delovoy-park.ru` (htpasswd единый для CEO+разработчика, ротация раз в 3 месяца). Защищает от публичной индексации, ботов, случайных переходов.
2. **Application-level lockdown** — новый ENV `STAGING_LOCKDOWN=true` в `.env.staging`. В `src/middleware.ts` (или новый `src/lib/staging-guard.ts`):
   - Все mutating endpoints (`POST|PATCH|DELETE` кроме `/api/auth/*`) → требуют `session.user.role === "SUPERADMIN"`.
   - Все `/admin/*` страницы → SUPERADMIN-only.
   - Публичные GET — доступны, но в layout рендерится `<StagingBanner />` (жёлтая полоса «STAGING — тестовая среда»).
3. **Визуальное отличие:** favicon + заголовок страниц `[STAGING] Деловой` — предохранение от путаницы «прод/стейдж».

### 9.2 Secrets разделение

| Секрет | Prod (`.env` на /opt/delovoy-park) | Staging (`.env.staging` на /opt/delovoy-park-staging) |
|--------|------------------------------------|-------------------------------------------------------|
| `POSTGRES_PASSWORD` | prod-only | уникальный staging-пароль |
| `NEXTAUTH_SECRET` | prod-only | уникальный staging-секрет |
| `TELEGRAM_BOT_TOKEN` | prod-бот | **отдельный @DelovoyStaging_bot** или пустой |
| `TELEGRAM_ADMIN_CHAT_ID` | prod-чат | отдельный dev-чат |
| `SMTP_USER/PASS` | реальный Yandex | staging — fake SMTP (Mailhog) или same creds + domain=staging.* |
| `NOVOFON_API_KEY` | боевой | sandbox-ключ или пустой (интеграции отключены) |
| `YANDEX_CLIENT_ID` | prod OAuth | отдельное приложение в Yandex ID console |
| `S3_*` | прод bucket | **не нужен на staging** — staging не делает бекапы |
| `STAGING_LOCKDOWN` | не задан (effectively false) | `true` |
| `STAGING_BANNER` | не задан | `true` |

**Правило:** staging **не имеет** `aws s3` credentials — это предотвращает случайный overwrite prod-бекапов со staging-машины.

### 9.3 Backup endpoints RBAC

Все новые API — **SUPERADMIN-only**, проверяется через существующий `requireAdminSection(session, "architect")` или явный `hasRole(user, "SUPERADMIN")`.

| Endpoint | Роль | Module access | Rate limit | Audit |
|----------|------|---------------|------------|-------|
| `GET /api/admin/backups` | SUPERADMIN | `architect` | 60/min (default authed) | read-only, AuditLog не нужен |
| `POST /api/admin/backups/restore` | **SUPERADMIN only** | `architect` + явная проверка `hasRole(SUPERADMIN)` | 5/hour (редкая операция) | AuditLog + BackupLog(type=RESTORE) + Telegram notify |
| `POST /api/admin/deploy/staging` | **SUPERADMIN only** | `architect` | 10/hour | AuditLog + Telegram notify |

### 9.4 Валидация

Все входные данные через Zod (см. §10.3). Формат ошибок — существующий `apiError(code, message)`:
- `UNAUTHORIZED` — нет сессии.
- `FORBIDDEN` — роль недостаточна.
- `BACKUP_NOT_FOUND` — backupId не существует.
- `RESTORE_IN_PROGRESS` — глобальный lock по Redis.
- `VALIDATION_ERROR` — Zod детали в `error.details`.

---

## 10. API Contracts

Базовый путь: `/api/admin/backups/*` и `/api/admin/deploy/staging`.

### 10.1 `GET /api/admin/backups`

**Query:**
```ts
{
  type?: "DAILY" | "WEEKLY" | "MONTHLY" | "PRE_MIGRATION" | "MANUAL" | "RESTORE";
  status?: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  from?: string;  // ISO date
  to?: string;
  limit?: number; // 1..100, default 50
  offset?: number;
}
```

**Response 200:**
```ts
{
  success: true,
  data: Array<{
    id: string;
    type: BackupType;
    status: BackupStatus;
    sizeBytes: number | null;
    storagePath: string;        // e.g. "s3://delovoy-backups/daily/..."
    downloadUrl?: string;       // signed URL, TTL 15 min (для SUPERADMIN)
    performedById?: string;     // для RESTORE / MANUAL
    performedByName?: string;
    error?: string;
    scope?: "full" | "table" | "record";
    targetTable?: string;
    createdAt: string;
  }>,
  meta: { total: number, limit: number, offset: number }
}
```

### 10.2 `POST /api/admin/backups/restore`

**Request body (Zod):**
```ts
const restoreSchema = z.object({
  backupId: z.string().cuid(),
  scope: z.enum(["full", "table", "record"]),
  dryRun: z.boolean().default(true),  // default TRUE — защита от случайного
  target: z.discriminatedUnion("scope", [
    z.object({ scope: z.literal("full") }),
    z.object({
      scope: z.literal("table"),
      table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      truncateBefore: z.boolean().default(false),
    }),
    z.object({
      scope: z.literal("record"),
      table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      primaryKey: z.record(z.string(), z.union([z.string(), z.number()])),
      upsert: z.boolean().default(true),
    }),
  ]).optional(),  // only required when scope != "full"
  confirmationPassword: z.string().min(8),  // SUPERADMIN password re-entry (как в DeletionLog)
});
```

**Response 202 (async):**
```ts
{
  success: true,
  data: {
    jobId: string;              // UUID для трекинга
    backupLogId: string;        // BackupLog record
    status: "IN_PROGRESS";
    estimatedSeconds: number;   // оценка по size
  }
}
```

**Response 200 (dry run):**
```ts
{
  success: true,
  data: {
    dryRun: true;
    wouldAffectRows: number;
    diff: Array<{ field: string; before: unknown; after: unknown }>;  // только для scope=record
  }
}
```

**Errors:**
- 400 `VALIDATION_ERROR` — Zod
- 401 `UNAUTHORIZED`
- 403 `FORBIDDEN` — не SUPERADMIN
- 404 `BACKUP_NOT_FOUND`
- 409 `RESTORE_IN_PROGRESS` — другой restore job активен (Redis lock `restore:active`)
- 422 `PASSWORD_MISMATCH` — `confirmationPassword` не совпал
- 500 `RESTORE_FAILED`

### 10.3 `POST /api/admin/deploy/staging`

**Request body:**
```ts
const deploySchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),  // default = main HEAD
  wipeDatabase: z.boolean().default(false),               // опционально — дроп staging БД
  notifyOnComplete: z.boolean().default(true),
});
```

**Поведение:** тонкий proxy к GitHub API — триггерит `workflow_dispatch` для `deploy-staging.yml` с переданным SHA. Сам деплой выполняется в GHA, а не в Node-процессе (безопаснее — нет SSH ключа в приложении).

**Response 202:**
```ts
{
  success: true,
  data: {
    workflowRunId: number;
    workflowUrl: string;        // https://github.com/.../actions/runs/...
    status: "triggered";
  }
}
```

**Errors:**
- 401/403 как выше
- 429 `DEPLOY_RATE_LIMIT` — 10/hour
- 502 `GITHUB_API_ERROR`

**Примечание:** использует `GITHUB_DISPATCH_TOKEN` (fine-grained PAT с permissions=actions:write) из `process.env`. Секрет хранится на VPS в `.env`, **не в коде**.

---

## 11. Data Model — `BackupLog`

**Решение:** да, добавляем модель. Она нужна для FR-013 (история), FR-014 (фиксация failed), audit, и для блокировки параллельных restore.

```prisma
model BackupLog {
  id             String        @id @default(cuid())
  type           BackupType
  status         BackupStatus  @default(IN_PROGRESS)
  sizeBytes      BigInt?                          // размер dump.gz
  storagePath    String?                          // "s3://delovoy-backups/daily/...sql.gz" или local path
  checksum       String?                          // sha256 для проверки целостности

  // Для RESTORE записей
  sourceBackupId String?                          // id BackupLog, из которого восстанавливали
  scope          RestoreScope?                    // full | table | record
  targetTable    String?
  targetKey      Json?                            // primaryKey для scope=record
  affectedRows   Int?

  // Для PRE_MIGRATION
  migrationTag   String?                          // e.g. "v0.143.2-hotfix-bbq"

  performedById  String?
  performedBy    User?         @relation(fields: [performedById], references: [id])

  durationMs     Int?
  error          String?                          // stack trace / сообщение
  metadata       Json?

  createdAt      DateTime      @default(now())
  completedAt    DateTime?

  @@index([type, createdAt])
  @@index([status])
  @@index([performedById])
}

enum BackupType {
  DAILY
  WEEKLY
  MONTHLY
  PRE_MIGRATION
  MANUAL
  RESTORE
}

enum BackupStatus {
  IN_PROGRESS
  SUCCESS
  FAILED
  PARTIAL   // для restore scope=table когда не все строки легли
}

enum RestoreScope {
  FULL
  TABLE
  RECORD
}
```

**Миграция:** ADDITIVE, безопасна (`CREATE TABLE IF NOT EXISTS`, новые enum-ы). Применяется через стандартный `_run-migration.yml` → **но! впервые прогоняется через новый pre-migration backup hook** — рекурсивно: чтобы включить hook, нужен один ручной бекап, что логируется не в `BackupLog` (ещё нет таблицы) — это bootstrap issue, описано в §13 task #7.

**Relation on User:** добавить в модель `User`:
```prisma
backupLogs  BackupLog[]
```

---

## 12. Risks & Mitigations

| Риск | Severity | Митигация |
|------|----------|-----------|
| Staging утекает реальные данные в prod (OAuth callback redirect с production accounts) | **HIGH** | Отдельные OAuth Client IDs, проверка `NEXTAUTH_URL` startWith `staging.` → reject prod-redirect; разная база = разные юзеры вообще |
| Забыли сделать pre-migration backup | **HIGH** | GHA job `backup` с `needs:` на `migrate` — технически невозможно пропустить; локально `db:migrate:prod` npm script тоже обёрнут |
| Staging положил прод через OOM/IO | **MEDIUM** | Docker memory limits (уже есть), cgroup CPU weight staging=256 prod=1024, отдельные volumes |
| Бекап падает молча (cron fail, недоступен S3) | **HIGH** | TG alert на fail + ежедневный «heartbeat» из монитора: если последний `BackupLog.status=SUCCESS` старше 26 часов → CRITICAL алерт |
| Restore дропнул прод таблицу | **CRITICAL** | `dryRun: true` по умолчанию, `confirmationPassword`, `scope=record` как дефолт в UI, Redis lock чтобы 2 restore одновременно не прошли |
| S3 bucket переполнен / counter не удалён | **MEDIUM** | Lifecycle policy на bucket-е + ежемесячный alert по размеру |
| Утечка `GITHUB_DISPATCH_TOKEN` из прод-сервера | **MEDIUM** | Fine-grained PAT scope=actions:write на один repo, ротация 90 дней |
| CEO нажал «wipe staging DB» на проде случайно | **LOW** | UI кнопки разные, endpoint `/api/admin/deploy/staging` физически не может трогать прод БД (нет connection string) |

---

## 13. Implementation Tasks

Порядок указан в §15. Каждая задача — отдельный тикет (PR).

| # | Тикет | FR | Файлы | Acceptance |
|---|-------|----|-------|------------|
| 1 | `chore(staging): Docker network isolation + banner + lockdown middleware` | FR-001, FR-002, FR-004 | `docker-compose.staging.yml`, `src/middleware.ts`, `src/components/StagingBanner.tsx`, `src/lib/staging-guard.ts` | Staging требует Basic Auth + SUPERADMIN login; public routes показывают banner; mutating requests without SUPERADMIN → 403 |
| 2 | `feat(staging): отдельный Telegram бот + isolated SMTP` | FR-007 | `bot/index.ts` (проверка env), `.env.staging.example`, `docs/staging-setup.md` | Staging использует `STAGING_TELEGRAM_BOT_TOKEN`, prod-бот не реагирует на staging-события |
| 3 | `feat(staging): Nginx config + SSL + DNS` | FR-001, FR-002 | `scripts/setup-staging.sh` (доработать), `docs/staging-setup.md` | `https://staging.delovoy-park.ru` отвечает 200 OK, Basic Auth активен, SSL Let's Encrypt |
| 4 | `feat(admin): POST /api/admin/deploy/staging + UI button` | FR-003, FR-006 | `src/app/api/admin/deploy/staging/route.ts`, `src/app/(admin)/architect/deploy/page.tsx` | Нажатие кнопки → новый GHA run появляется за 5 с, деплой завершается <3 мин (p95), UI показывает прогресс |
| 5 | `feat(db): BackupLog model + migration` | FR-013 | `prisma/schema.prisma`, `prisma/migrations/<ts>_add_backup_log/migration.sql` | Таблица создана, enum-ы есть, User relation добавлен, тесты на модель зелёные |
| 6 | `feat(backups): S3 upload + GFS rotation + BackupLog writes` | FR-008, FR-009 | `scripts/backup-db.sh` (доработать), `scripts/cron-backup.sh` | Дневной бекап лежит в S3, неделя → weekly/, месяц → monthly/, в БД появляется `BackupLog(type=DAILY)` |
| 7 | `feat(backups): pre-migration hook + CI gate` | FR-010 | `scripts/pre-migration-backup.sh`, `.github/workflows/_run-migration.yml`, `package.json` | Миграция не стартует без успешного backup job; failed backup → миграция FAIL |
| 8 | `feat(admin): GET /api/admin/backups` | FR-013 | `src/app/api/admin/backups/route.ts`, `src/modules/backups/service.ts`, `src/modules/backups/validation.ts` | SUPERADMIN видит список, фильтры работают, signed S3 URL генерится с TTL 15 min |
| 9 | `feat(admin): POST /api/admin/backups/restore (full + table)` | FR-011, FR-012 | `src/app/api/admin/backups/restore/route.ts`, `src/modules/backups/restore-service.ts` | Restore full в staging работает; restore table в прод работает; dryRun возвращает diff; Redis lock предотвращает concurrent |
| 10 | `feat(admin): UI /admin/architect/backups (list + restore)` | FR-013 | `src/app/(admin)/architect/backups/page.tsx`, `src/components/admin/BackupsList.tsx` | Список отображается, filter работает, «Restore» модалка требует пароль, dryRun показывает diff |
| 11 | `feat(backups): Telegram alerts (fail + optional success)` | FR-014, FR-015 | `scripts/backup-db.sh`, `src/modules/backups/notify.ts` | Fail → alert обязателен; success → alert только если `BACKUP_NOTIFY_ON_SUCCESS=true` |
| 12 | `docs(ops): restore runbook + staging setup guide` | FR-011 | `docs/runbooks/restore-backup.md`, `docs/staging-setup.md` | Runbook описывает step-by-step: full / table / record; QA прогнал по runbook один реальный restore |
| 13 | `test(backups): реальный E2E — dump → staging restore → assert` | FR-011 | `scripts/test-backup-restore.sh`, CI job (weekly) | Раз в неделю автотест: берёт свежий backup → восстанавливает в ephemeral staging DB → проверяет row count |

---

## 14. Test Plan (для QA)

### 14.1 Staging

| ID | Сценарий | Ожидаемый результат | Связь с PRD |
|----|----------|---------------------|-------------|
| ST-01 | CEO нажимает `workflow_dispatch` → ждёт | Staging здоров <3 мин, TG-уведомление | FR-003, FR-006 |
| ST-02 | Открыть `staging.delovoy-park.ru` из Chrome Incognito | Запрос Basic Auth | FR-002 |
| ST-03 | Ввести basic auth, зайти как USER на `/admin` | 403/redirect | FR-002 |
| ST-04 | Зайти как SUPERADMIN | Полный доступ, виден жёлтый баннер «STAGING» | FR-002 |
| ST-05 | Создать заказ в кафе на staging | Создаётся в staging БД, **prod БД нетронута** | FR-004 |
| ST-06 | Отправить `/start` боту @DelovoyStaging_bot | Ответ от staging-бота; prod-бот молчит | FR-007 |
| ST-07 | Проверить `/api/health` на staging | 200 OK | FR-001 |
| ST-08 | Убедиться что `delovoy_park_staging` БД пуста при первом старте | `SELECT count(*) FROM "Booking"` = 0 | FR-005 |

### 14.2 Backups

| ID | Сценарий | Ожидаемый результат | Связь с PRD |
|----|----------|---------------------|-------------|
| BK-01 | Дождаться cron 03:00 MSK | `BackupLog` row, файл в S3, локальный кэш, TG-notification опционально | FR-008, FR-014 |
| BK-02 | Руками: `docker compose run --rm backup` | То же самое, type=MANUAL | FR-008 |
| BK-03 | Симулировать S3 недоступность → запустить backup | TG alert CRITICAL, `BackupLog(status=FAILED)`, миграция не разрешена | FR-014 |
| BK-04 | Применить миграцию через `_run-migration.yml` | Job `backup` выполняется ПЕРВЫМ, миграция ждёт | FR-010 |
| BK-05 | Симулировать fail backup job | Job `migrate` не стартует | FR-010 |
| BK-06 | `GET /api/admin/backups?type=DAILY&limit=10` как SUPERADMIN | 200 OK, 10 записей | FR-013 |
| BK-07 | Тот же запрос как MANAGER | 403 FORBIDDEN | FR-002, security |
| BK-08 | `POST /api/admin/backups/restore` dryRun=true scope=record Booking id=X | Diff показан, прод НЕ изменён | FR-012 |
| BK-09 | Тот же с dryRun=false + правильный пароль | Запись восстановлена, `BackupLog(type=RESTORE)`, TG notify | FR-012 |
| BK-10 | Concurrent 2× restore | Второй → 409 RESTORE_IN_PROGRESS | FR-012 |
| BK-11 | Ручной E2E: дамп прода → restore в staging → сравнить count rows по 5 ключевым таблицам | Counts совпадают ±0 | FR-011, Acceptance |
| BK-12 | Retention: найти локальный бекап старше 8 дней после ночи | Удалён | FR-009 |
| BK-13 | Retention S3: объект старше 91 дня (daily/) | Lifecycle policy удалила | FR-009 |

### 14.3 Non-functional

| ID | Метрика | Ожидание |
|----|---------|----------|
| NF-01 | `GET /api/admin/backups` p95 latency | <200 ms |
| NF-02 | `POST /api/admin/deploy/staging` p95 | <500 ms (async trigger) |
| NF-03 | Staging deploy p95 (от клика до HTTP 200 на `/api/health`) | <180 с |
| NF-04 | Прод не деградирует во время staging deploy | prod p95 latency `/api/health` стабильна ±10% |
| NF-05 | Языковая проверка | Все admin UI на русском |

---

## 15. Рекомендуемый порядок имплементации

**Важно:** последовательность выбрана чтобы **риск операционной потери данных не вырос во время внедрения**.

```
Phase A (safe, параллельно):    #5 (BackupLog schema) → #6 (GFS+S3) → #7 (pre-migration hook)
                                  └─ закрываем главный риск (нет дампов перед миграцией)

Phase B (staging baseline):     #1 (lockdown) → #2 (staging bot) → #3 (Nginx+SSL)
                                  └─ staging юзабелен для ручного теста

Phase C (admin API):            #8 (GET backups) → #11 (TG alerts) → #9 (restore API, full+table)

Phase D (UX + polish):          #4 (deploy API+UI) → #10 (backups UI) → #12 (runbook) → #13 (E2E test)
```

**Причина такого порядка:** backups — безопасностный блокер (баг в миграции без свежего дампа = возможная потеря данных). Staging — удобство, но без него команда прожила до сегодня. Сначала закрываем риск, потом добавляем удобство.

---

## 16. Out of scope

Следующее **не входит** в эту задачу, создаются follow-up issues:

- Object Storage + backup для uploaded files (photos, menu images, tenant docs).
- WAL archiving для true second-level PITR (если бизнес попросит RPO <24h).
- Multi-branch staging (per-feature preview environments).
- Отдельный VPS для staging.
- Автоматические restore-тесты в CI (отдельный weekly job).
- Prometheus + Grafana для resource-мониторинга VPS.
- Staging seed fixtures / пресеты (один клик «demo data»).

---

## 17. Definition of Done

- [ ] Все 13 задач из §13 смержены в main.
- [ ] Staging доступен на `staging.delovoy-park.ru`, CEO может задеплоить и получить health=ok за <3 мин.
- [ ] Daily backup в 03:00 MSK → в S3, локальный кэш 7 дней, `BackupLog` запись.
- [ ] Миграция на прод **технически невозможна** без успешного pre-migration backup (проверено симуляцией).
- [ ] Реальный restore одной записи в проде выполнен через API и задокументирован в runbook.
- [ ] TG-alert на failed backup сработал в симуляции.
- [ ] QA прогнал test plan §14, все кейсы PASS.
- [ ] Runbook `docs/runbooks/restore-backup.md` написан и проверен на практике.

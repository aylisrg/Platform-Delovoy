# Правила разработки и деплоя — Platform Delovoy

> Этот документ описывает правила взаимодействия с GitHub, Timeweb VPS и процесс выкатки новых версий.

---

## 1. Сервер и окружение

| Параметр | Значение |
|---|---|
| Хостинг | Timeweb Cloud VPS |
| IPv4 | `5.129.255.244` |
| IPv6 | `2a03:6f00:a::1:3e2b` |
| OS | Ubuntu 22.04 |
| Server ID | `7225779` |
| Стек | Docker Compose (PostgreSQL 16 + Redis 7 + Next.js 16 app) |
| Путь на сервере | `/opt/delovoy/` |
| Docker Registry | `ghcr.io/aylisrg/platform-delovoy` |
| Репозиторий | `github.com/aylisrg/Platform-Delovoy` |

## 2. Timeweb API — обязательные правила для Claude

**Claude обязан использовать Timeweb Cloud API напрямую.**

Timeweb Cloud предоставляет полноценный REST API:
- Документация: `https://api.timeweb.cloud/api/v1`
- Авторизация: `Authorization: Bearer {TIMEWEB_API_TOKEN}`

### Что Claude может и должен делать через Timeweb API:

```
GET  /api/v1/servers/{id}             — статус сервера
GET  /api/v1/servers/{id}/statistics  — метрики CPU/RAM/Disk
GET  /api/v1/servers/{id}/logs        — логи сервера
POST /api/v1/servers/{id}/shutdown    — выключение
POST /api/v1/servers/{id}/start       — запуск
POST /api/v1/servers/{id}/reboot      — перезагрузка
```

### Правило: никогда не говорить "я не могу подключиться к Timeweb"

Если Claude не может получить данные с Timeweb API, он обязан:
1. Проверить наличие `TIMEWEB_API_TOKEN` в переменных окружения
2. Попробовать вызвать API напрямую через `fetch` / `curl`
3. Если токен отсутствует — запросить его у пользователя
4. Если API возвращает ошибку — показать точный HTTP-код и тело ответа

**Claude НЕ имеет права:**
- Говорить что "не поддерживает работу с Timeweb"
- Предлагать пользователю проверять сервер вручную
- Игнорировать доступ к API когда токен настроен

## 3. Ветки и Git Flow

### Структура веток

```
main                    ← production, деплоится автоматически
├── claude/{task}       ← ветки от Claude Code (CI, затем PR)
├── feature/{task}      ← ветки разработчиков (CI, затем PR)
└── hotfix/{task}       ← срочные фиксы (ручной мерж)
```

### Правила коммитов

Формат: `type: краткое описание`

| Тип | Когда |
|---|---|
| `feat` | Новая функциональность |
| `fix` | Баг-фикс |
| `refactor` | Рефакторинг без изменения поведения |
| `ci` | Изменения CI/CD |
| `docs` | Документация |
| `chore` | Зависимости, конфиг, мелочи |
| `deploy` | Изменения деплой-скриптов |

### CI на ветках (без автомержа)

Workflow `.github/workflows/ci.yml` при пуше в любую ветку запускает:
- `npm run lint` — линтер
- `npm test` — тесты
- `npm run build` — сборка

**Автомерж отключён.** Для попадания в `main` нужно:
1. Claude (или разработчик) пушит в свою ветку
2. CI проверяет — lint, tests, build
3. Создаётся Pull Request
4. Ревью и одобрение
5. Мерж в main вручную → автодеплой

### Автодеплой (CI/CD Pipeline)

Workflow `.github/workflows/deploy.yml` срабатывает при пуше в `main`:

```
Push to main
  → Job 1: lint + test
  → Job 2: docker build + push to GHCR (кешированные слои)
  → Job 3: SSH на VPS
    → git pull (обновить compose/entrypoint)
    → docker pull (готовый образ, секунды)
    → docker compose up -d --no-build (перезапуск только app)
    → Health gate: ждём /api/health = 200
    → Готово. Downtime: ~5 секунд
```

**Ключевые принципы:**
- Образы собираются в GitHub Actions (не на VPS) — исключает OOM
- На VPS только `docker pull` + `docker compose up` — быстро и безопасно
- postgres и redis НЕ перезапускаются при деплое
- Health check гарантирует что приложение живое перед завершением

## 4. Переменные окружения — КРИТИЧЕСКИ ВАЖНО

### Что НЕ должно быть в репозитории

- SSH пароли
- Timeweb API токены
- Реальные секреты БД
- Файл `.env`

### Где хранить секреты

| Секрет | Где хранить |
|---|---|
| IP сервера | GitHub Secrets: `VPS_HOST` |
| Пароль VPS | GitHub Secrets: `VPS_PASSWORD` |
| Timeweb API token | `/opt/delovoy/.env` на сервере |
| Telegram Bot token | `/opt/delovoy/.env` на сервере |
| Пароль PostgreSQL | `/opt/delovoy/.env` на сервере (генерируется один раз) |

### .env на сервере — НЕ перезаписывается при деплое

Скрипт `deploy-full.sh` генерирует `.env` ТОЛЬКО при первой установке:
```bash
if [ -f "$APP_DIR/.env" ]; then
    echo ".env уже существует — сохраняем секреты."
else
    # Генерируем .env только при первой установке
    generate_env
fi
```

## 5. Порядок деплоя новой версии

### Автоматический (через GitHub Actions)

```
Пуш в main → Тесты → Build+Push GHCR → SSH → Pull → Up → Health check
```

### Ручной (через SSH)

```bash
ssh root@5.129.255.244
cd /opt/delovoy/app
git pull origin main
docker pull ghcr.io/aylisrg/platform-delovoy:latest
docker compose --env-file /opt/delovoy/.env up -d --no-build
docker compose logs -f app
```

### Откат

```bash
ssh root@5.129.255.244
# Посмотреть доступные теги образов:
docker images ghcr.io/aylisrg/platform-delovoy --format "{{.Tag}}"
# Откатить на предыдущий:
docker pull ghcr.io/aylisrg/platform-delovoy:sha-<previous>
docker tag ghcr.io/aylisrg/platform-delovoy:sha-<previous> ghcr.io/aylisrg/platform-delovoy:latest
cd /opt/delovoy/app
docker compose --env-file /opt/delovoy/.env up -d --no-build
```

## 6. Мониторинг

### Эндпоинты здоровья

| URL | Что проверяет |
|---|---|
| `http://5.129.255.244/api/health` | Общий статус (DB + Redis) |
| `http://5.129.255.244/api/timeweb/health` | Связь с Timeweb API |
| `http://5.129.255.244/api/gazebos/health` | Модуль беседок |
| `http://5.129.255.244/api/cafe/health` | Модуль кафе |
| `http://5.129.255.244/api/rental/health` | Модуль аренды |

### Логи Docker

```bash
docker compose -f /opt/delovoy/app/docker-compose.yml logs -f app     # приложение
docker compose -f /opt/delovoy/app/docker-compose.yml logs -f postgres # БД
docker compose -f /opt/delovoy/app/docker-compose.yml ps               # статус
docker inspect --format='{{.State.Health.Status}}' delovoy-app         # health check
```

## 7. Чеклист перед каждым деплоем

- [ ] Тесты проходят локально (`npm test`)
- [ ] Линтер чист (`npm run lint`)
- [ ] Сборка проходит (`npm run build`)
- [ ] `.env.example` обновлён если добавлены новые переменные
- [ ] Миграции Prisma созданы если схема менялась
- [ ] Коммит-месседж следует конвенции

## 8. Первичная установка VPS

Для нового сервера:
```bash
bash scripts/setup-vps.sh
```
Затем:
1. Заполнить токены в `/opt/delovoy/.env`
2. Настроить GitHub Secrets: `VPS_HOST`, `VPS_PASSWORD`
3. Сделать GHCR package публичным (GitHub → Packages → Settings → Public)
4. Перезапустить: `docker compose -f /opt/delovoy/app/docker-compose.yml restart app`

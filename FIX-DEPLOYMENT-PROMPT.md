# Деплой: решённые проблемы и текущий статус

> Этот документ описывает проблемы деплоя, которые были выявлены и исправлены.

---

## Статус: ИСПРАВЛЕНО

Все критические проблемы деплоя решены. Текущий пайплайн:

```
Push to main → Test → Build+Push GHCR → SSH → Pull → Up → Health check
```

## Что было исправлено

### 1. .env перезаписывался при каждом деплое
**Проблема:** `deploy-full.sh` генерировал новый `.env` каждый раз, затирая `TIMEWEB_API_TOKEN`, `TELEGRAM_BOT_TOKEN` и меняя `POSTGRES_PASSWORD` (что ломало БД).

**Решение:** `.env` теперь генерируется ТОЛЬКО при первой установке. При повторных деплоях файл не трогается.

### 2. Docker build на VPS вызывал OOM
**Проблема:** `docker compose up --build` на VPS с 2GB RAM регулярно падал с OOM.

**Решение:** Docker-образы теперь собираются в GitHub Actions и пушатся в GHCR. На VPS только `docker pull` + `docker compose up --no-build`.

### 3. Полный downtime при деплое
**Проблема:** `docker compose down` + `docker compose up --build` = 2-5 минут offline.

**Решение:** `docker compose up -d --no-build` перезапускает только app контейнер. Postgres и Redis не трогаются. Downtime ~5 секунд.

### 4. --accept-data-loss на production БД
**Проблема:** `docker-entrypoint.sh` запускал `prisma db push --accept-data-loss` при каждом старте контейнера.

**Решение:** Флаг `--accept-data-loss` убран. Деструктивные изменения схемы теперь требуют ручной миграции.

### 5. Seed запускался при каждом рестарте
**Проблема:** `npx tsx scripts/seed.ts` выполнялся при каждом запуске контейнера.

**Решение:** Seed теперь запускается условно — только если в БД нет пользователей.

### 6. Два конфликтующих docker-compose.yml
**Проблема:** Один в репозитории (`context: .`), другой генерировался скриптом (`context: ./app`).

**Решение:** Единый `docker-compose.yml` в репозитории. Генерация убрана из `deploy-full.sh`.

### 7. Нет health check для app контейнера
**Проблема:** Невозможно было узнать, запустилось ли приложение.

**Решение:** Добавлен healthcheck в docker-compose.yml (`wget /api/health`). Deploy ждёт healthy status.

### 8. SSH пароль в открытом виде
**Проблема:** SSH пароль был виден в workflow файлах.

**Решение:** Все секреты в GitHub Secrets (`VPS_HOST`, `VPS_PASSWORD`).

## Сервер

| Параметр | Значение |
|---|---|
| IPv4 | `5.129.255.244` |
| IPv6 | `2a03:6f00:a::1:3e2b` |
| Timeweb Server ID | `7225779` |
| GHCR Image | `ghcr.io/aylisrg/platform-delovoy` |

## Полезные команды

```bash
# Проверить статус
curl http://5.129.255.244/api/health

# Timeweb API
curl -s -H "Authorization: Bearer $TIMEWEB_API_TOKEN" \
  https://api.timeweb.cloud/api/v1/servers/7225779

# Логи на сервере
ssh root@5.129.255.244
docker compose -f /opt/delovoy/app/docker-compose.yml logs -f app
docker inspect --format='{{.State.Health.Status}}' delovoy-app
```

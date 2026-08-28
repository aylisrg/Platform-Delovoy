# Disk Space Management — Platform Delovoy

## Уже работает в проде

Прод-образ собирается на GitHub Actions (`docker/build-push-action@v7`, GHA cache) и
попадает на VPS через `docker pull` (`deploy.yml`) — `docker compose up --build`
на самом VPS не происходит. Место на VPS всё равно накапливается: старые слои
образов после `pull`, builder cache от локальных ad-hoc сборок, старые бэкапы,
логи. Это уже покрыто тремя механизмами:

- **`.github/workflows/docker-cleanup.yml`** — по расписанию (воскресенье
  22:00 UTC) и **после каждого деплоя** (`workflow_run` на "Deploy to
  Production"). По SSH на VPS: `docker system prune -af`,
  `docker builder prune -af`, чистка старых бэкапов БД (оставляет последние 5),
  старых логов (`*.gz` старше 7 дней, `journalctl --vacuum-size=50M`), `/tmp`
  старше 3 дней, apt-кэш. Если после очистки диск всё ещё > 85% — Telegram-алерт
  админ-группе.
- **`.github/workflows/disk-space-monitor.yml`** — проверка каждые 6 часов.
  🟡 WARNING от 75%, 🔴 CRITICAL от 90% (прогон падает, чтобы это было видно и
  в Actions), в CRITICAL-сообщении подсказка `gh workflow run docker-cleanup.yml`.
- **`timeweb-manage.yml`** сам ставит на VPS eженедельный cron
  `/etc/cron.d/docker-weekly-cleanup`: `docker image prune -af --filter until=168h`
  — работает даже если GitHub Actions или SSH из GHA временно недоступны.

## Что добавляет этот документ/PR

Локальный ручной набор — **не** триггерится автоматически ни деплоем, ни
cron, ни workflow. Полезен для диагностики без доступа к GH Actions/VPS SSH,
или на dev-машине/staging с собственным Docker.

**Диагностика:**
```bash
./scripts/disk-usage-report.sh
```
Выведет: свободное место на `/`, `docker system df`, топ-10 images по размеру,
volumes/containers по размеру, dangling images/volumes.

**Очистка:**
```bash
./scripts/docker-cleanup.sh
```
Удаляет: images старше 72ч, остановленные контейнеры, неиспользуемые networks,
builder cache, orphaned volumes (`docker volume prune` без `-a` — не трогает
volumes, на которые ссылается хоть один контейнер, даже остановленный).

`scripts/post-deploy.sh` при ручном запуске сначала вызывает
`docker-cleanup.sh` (best-effort, `|| true`), затем `prisma db push` и
`npm run db:seed`. Он **не** часть автодеплоя: `deploy.yml` гоняет миграции
и сид напрямую (`prisma migrate deploy`, `scripts/seed.ts`) и этот файл не
вызывает; `docker-entrypoint.sh` тоже explicitly их не делает (см. комментарий
в файле про инцидент 2026-07-20). `post-deploy.sh` — только для ручного
прогона.

## Dockerfile

```dockerfile
RUN rm -rf .next/cache .next/turbo /root/.npm
```

Немного уменьшает builder-стадию образа (доп. к уже стоявшему `.next/cache`).
Т.к. `COPY --from=builder` в runner-стадию берёт только `.next/standalone` и
`.next/static`, эти кэши и так не попадали бы в финальный образ — эффект
только на размер промежуточного builder-слоя в GHA build cache, не на диск
VPS.

## Во время разработки локально

```bash
# Одноразовая полная очистка (удалит ВСЁ неиспользуемое)
docker system prune -a

# Очистка volumes (осторожно!)
docker volume prune

# Просмотр того что удалится
docker image prune -a --dry-run
```

## Ссылки

- [Docker Prune Documentation](https://docs.docker.com/config/pruning/)
- [Best Practices for Building Images](https://docs.docker.com/develop/dev-best-practices/)

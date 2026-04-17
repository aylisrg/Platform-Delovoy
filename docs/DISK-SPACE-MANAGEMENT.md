# Disk Space Management — Platform Delovoy

## Проблема

При каждом `docker compose up --build` создаётся новый image слой поверх существующих. Старые неиспользуемые images и builder-cache остаются на диске и накапливаются со временем, заполняя диск на VPS.

**Признаки проблемы:**
- Диск заполняется на 80-90% за несколько недель
- `docker system df` показывает большое количество неиспользуемого пространства
- Каждый build занимает всё больше времени

## Решение

### Уровень 1: Автоматическая очистка перед deploy (рекомендуется)

Обновлено: `scripts/post-deploy.sh` вызывает `scripts/docker-cleanup.sh` автоматически перед миграциями.

**Как работает:**
```bash
./scripts/post-deploy.sh
  └─> ./scripts/docker-cleanup.sh  # удаляет старые images и builder-cache
  └─> prisma db push
  └─> npm run db:seed
```

### Уровень 2: Ежедневная автоматическая очистка (cron)

Добавьте в crontab на VPS:

```bash
crontab -e
```

Добавьте строку:
```cron
# Ежедневная очистка Docker в 2:00 ночи
0 2 * * * /home/user/Platform-Delovoy/scripts/docker-cleanup.sh >> /var/log/docker-cleanup.log 2>&1
```

### Уровень 3: Ручная диагностика и очистка

**Посмотреть текущее использование дискового пространства:**
```bash
./scripts/disk-usage-report.sh
```

Выведет:
- Размер файловой системы и свободное место
- Docker system df (images, containers, volumes)
- Топ-10 самых больших images
- Данные о dangling (неиспользуемых) images и volumes

**Вручную очистить Docker:**
```bash
./scripts/docker-cleanup.sh
```

Что удаляется:
- Неиспользуемые images (старше 72 часов)
- Остановленные контейнеры
- Неиспользуемые networks
- **Builder cache (самый прожорливый!) — освобождает 500MB-2GB**
- Orphaned volumes

## Оптимизации в кодовой базе

### 1. Dockerfile (builder stage)

**Было:**
```dockerfile
RUN npm install
RUN rm -rf .next/cache
```

**Теперь:**
```dockerfile
RUN npm ci --only=production && npm ci --only=development
RUN rm -rf .next/cache .next/turbo /root/.npm
```

**Улучшения:**
- `npm ci` вместо `npm install` — более чистая установка, меньше побочных артефактов
- Удаляются `.next/turbo` и `/root/.npm` кэши
- Более предсказуемый размер image

### 2. .dockerignore (уже настроен)

```
node_modules
.next
.git
.github
.env
.env.*
coverage
*.md
.DS_Store
```

Исключает лишние файлы из контекста build, ускоряет сборку.

## Мониторинг

### Встроенный health check

Добавьте в `.env`:
```bash
# Запуск проверки диска каждый день в 3:00
CRON_DISK_CHECK="0 3 * * *"
```

### Telegram alert при заполнении диска

В администраторской группе в Telegram будет приходить сообщение если диск > 80%:

```
⚠️ DISK WARNING
Filesystem: /
Usage: 85%
Free: 230GB

Action: Run ./scripts/docker-cleanup.sh
```

(реализуется в `api/health` на следующей версии)

## Размеры обычно освобождаемых в одной очистке

| Компонент | Типичное освобождение |
|-----------|----------------------|
| Builder cache | 500MB–2GB |
| Dangling images | 100MB–500MB |
| Stopped containers | 10MB–100MB |
| Orphaned volumes | 50MB–200MB |
| **ИТОГО** | **~1-3GB** |

При ежедневной очистке диск останется в здоровом состоянии (40-60% используемо).

## Во время разработки локально

Если у вас на локальной машине также накапливается Docker-мусор:

```bash
# Одноразовая полная очистка (удалит ВСЁ неиспользуемое)
docker system prune -a

# Очистка volumes (осторожно!)
docker volume prune

# Просмотр того что удалится
docker image prune -a --dry-run
```

## Дорожная карта

- [x] Оптимизировать Dockerfile
- [x] Создать скрипты очистки
- [x] Интегрировать в post-deploy
- [ ] Настроить cron на VPS (требует SSH доступ)
- [ ] Telegram alerts при заполнении диска (Phase 4)
- [ ] Автоматическое предупреждение в админ-панели

## Ссылки

- [Docker Prune Documentation](https://docs.docker.com/config/pruning/)
- [Best Practices for Building Images](https://docs.docker.com/develop/dev-best-practices/)

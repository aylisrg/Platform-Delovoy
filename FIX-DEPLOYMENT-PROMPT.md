# Промпт для Claude: диагностика и фикс деплоя

> Скопируй этот промпт целиком в новый чат с Claude Code (или Claude с доступом к репозиторию).

---

## ПРОМПТ:

```
Ты работаешь с проектом Platform Delovoy (github.com/aylisrg/Platform-Delovoy).
Это бизнес-парк платформа на Next.js 16 + Prisma + PostgreSQL + Redis, задеплоенная на Timeweb VPS.

Сервер: 5.129.255.244 (Timeweb Cloud, Server ID: 7225779)
Репо: https://github.com/aylisrg/Platform-Delovoy

### КРИТИЧЕСКИЕ ПРОБЛЕМЫ КОТОРЫЕ НУЖНО ИСПРАВИТЬ:

#### 1. БЕЗОПАСНОСТЬ: SSH пароль в открытом виде
Файл `.github/workflows/deploy.yml` содержит SSH-пароль в plain text:
```
PASS='f.?Us+JKJy3S?8'
```
ЗАДАЧА:
- Удалить пароль из файла
- Перенести в GitHub Secrets (переменная `VPS_PASSWORD`)
- Заменить на `${{ secrets.VPS_PASSWORD }}` в workflow
- Добавить SSH-ключ как альтернативу (GitHub Secret `VPS_SSH_KEY`)

#### 2. deploy-full.sh затирает .env при каждом деплое
Скрипт `scripts/deploy-full.sh` каждый раз перезаписывает `/opt/delovoy/.env`, в том числе ставит `TIMEWEB_API_TOKEN=placeholder`. Из-за этого после каждого деплоя Timeweb API перестаёт работать.

ЗАДАЧА:
- Добавить проверку: если .env уже существует, НЕ перезаписывать
- Генерировать .env только при первой установке (когда файла нет)
- Если .env существует, только обновить DATABASE_URL (который зависит от пароля PostgreSQL)
- Добавить комментарий в скрипт с инструкцией

#### 3. IP-адрес расходится
В `.env.example` закомментирован старый IP `45.144.222.103`. Реальный сервер: `5.129.255.244`.

ЗАДАЧА:
- Обновить `.env.example`: заменить `45.144.222.103` → `5.129.255.244`
- Проверить весь проект на упоминания старого IP и заменить

#### 4. Два docker-compose.yml с разным контекстом
Корневой `docker-compose.yml` имеет `context: .`, а скрипт `deploy-full.sh` генерирует свой с `context: ./app`. Это создаёт путаницу.

ЗАДАЧА:
- Убрать генерацию docker-compose.yml из deploy-full.sh
- Использовать ТОЛЬКО корневой docker-compose.yml из репозитория
- В deploy-full.sh: копировать docker-compose.yml из репо в /opt/delovoy/ с правильными путями
- ИЛИ: запускать docker compose прямо из /opt/delovoy/app/

#### 5. Timeweb API интеграция
В проекте уже есть модуль `src/modules/timeweb/service.ts` с полной интеграцией Timeweb API. Но из-за проблемы #2 (затирание токена) он не работает на проде.

ЗАДАЧА:
- Убедиться что TIMEWEB_API_TOKEN сохраняется между деплоями
- Проверить что эндпоинт /api/timeweb/health работает
- Если нужен токен — запросить его у пользователя через Timeweb Dashboard:
  https://timeweb.cloud/my/api-keys

ВАЖНОЕ ПРАВИЛО: ты ОБЯЗАН работать с Timeweb API напрямую. API доступен по адресу:
- Base URL: https://api.timeweb.cloud/api/v1
- Auth: Bearer token
- Документация: https://api.timeweb.cloud/api/v1/docs

НЕ говори что "не можешь подключиться к Timeweb". Используй curl/fetch для прямых вызовов API.

#### 6. Проверить что сайт реально работает
После всех фиксов:
- Сделать HTTP запрос к http://5.129.255.244/ и убедиться что отвечает
- Проверить http://5.129.255.244/api/health
- Проверить docker ps на сервере (через SSH или Timeweb API)

### ПОРЯДОК ДЕЙСТВИЙ:

1. Сначала прочитай все файлы которые нужно менять
2. Исправь deploy.yml (безопасность)
3. Исправь deploy-full.sh (не затирать .env)
4. Обнови .env.example (IP)
5. Разреши конфликт docker-compose.yml
6. Закоммить всё в ветку `fix/deployment-security`
7. Проверь что сборка и тесты проходят
8. Замержи в main

### ФАЙЛЫ КОТОРЫЕ НУЖНО ПРОВЕРИТЬ/ИЗМЕНИТЬ:
- .github/workflows/deploy.yml
- scripts/deploy-full.sh
- scripts/setup-vps.sh
- .env.example
- docker-compose.yml
- CLAUDE.md (обновить IP если упоминается)
- DEVELOPMENT-RULES.md (добавить в репо)
```

---

## ДОПОЛНИТЕЛЬНО: если Claude говорит что не может подключиться к Timeweb

Отправь ему это:

```
Timeweb Cloud имеет полноценный REST API. Вот как его использовать:

# Проверить статус сервера:
curl -s -H "Authorization: Bearer $TIMEWEB_API_TOKEN" \
  https://api.timeweb.cloud/api/v1/servers/7225779

# Получить статистику:
curl -s -H "Authorization: Bearer $TIMEWEB_API_TOKEN" \
  https://api.timeweb.cloud/api/v1/servers/7225779/statistics

# Перезагрузить сервер:
curl -s -X POST -H "Authorization: Bearer $TIMEWEB_API_TOKEN" \
  https://api.timeweb.cloud/api/v1/servers/7225779/reboot

Документация API: https://api.timeweb.cloud/api/v1/docs

Токен создаётся в: https://timeweb.cloud/my/api-keys

В проекте уже есть полный модуль для работы с Timeweb API:
- src/modules/timeweb/service.ts — HTTP клиент, кеширование, все операции
- src/modules/timeweb/types.ts — TypeScript типы
- src/modules/timeweb/validation.ts — Zod схемы
- src/app/api/timeweb/* — REST эндпоинты (info, stats, logs, power, health)

Используй его. Не выдумывай отговорок.
```

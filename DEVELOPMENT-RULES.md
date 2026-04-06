# Правила разработки и деплоя — Platform Delovoy

> Этот документ описывает правила взаимодействия с GitHub, Timeweb VPS и процесс выкатки новых версий.

---

## 1. Сервер и окружение

| Параметр | Значение |
|---|---|
| Хостинг | Timeweb Cloud VPS |
| IP | `5.129.255.244` |
| OS | Ubuntu 22.04 |
| Server ID | `7215757` |
| Стек | Docker Compose (PostgreSQL 16 + Redis 7 + Next.js 16 app) |
| Путь на сервере | `/opt/delovoy/` |
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
├── claude/{task}       ← ветки от Claude Code (автомерж если тесты прошли)
├── feature/{task}      ← ветки разработчиков (автомерж если тесты прошли)
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

Workflow `.github/workflows/auto-merge.yml` при пуше в ветки `claude/**` и `feature/**` запускает:
- ✅ `npm run lint` — линтер
- ✅ `npm test` — тесты
- ✅ `npm run build` — сборка

**Автомерж отключён.** Для попадания в `main` нужно:
1. Claude (или разработчик) пушит в свою ветку
2. CI проверяет — lint, tests, build
3. Создаётся Pull Request
4. Ревью и одобрение
5. Мерж в main вручную → автодеплой

### Автодеплой

Workflow `.github/workflows/deploy.yml` срабатывает при пуше в `main`:
1. Запускает тесты
2. Подключается к VPS по SSH
3. Делает `git pull` на сервере
4. Запускает `docker compose up --build -d`
5. Проверяет что сайт отвечает

## 4. Переменные окружения — КРИТИЧЕСКИ ВАЖНО

### Что НЕ должно быть в репозитории

❌ SSH пароли  
❌ Timeweb API токены  
❌ Реальные секреты БД  
❌ Файл `.env`

### Где хранить секреты

| Секрет | Где хранить |
|---|---|
| SSH-доступ к VPS | GitHub Secrets: `VPS_SSH_KEY` |
| Пароль VPS | GitHub Secrets: `VPS_PASSWORD` |
| Timeweb API token | GitHub Secrets: `TIMEWEB_API_TOKEN` + `/opt/delovoy/.env` на сервере |
| Пароль PostgreSQL | `/opt/delovoy/.env` на сервере (генерируется один раз) |

### .env на сервере — НЕ перезаписывается при деплое

Скрипт `deploy-full.sh` должен проверять:
```bash
if [ ! -f "$APP_DIR/.env" ]; then
    # Генерируем .env только при первой установке
    generate_env
else
    echo "[2/5] .env уже существует, пропускаем"
fi
```

## 5. Порядок деплоя новой версии

### Автоматический (через GitHub Actions)

```
Пуш в main → Тесты → SSH на VPS → git pull → docker compose up --build -d → проверка
```

### Ручной (через SSH)

```bash
ssh root@5.129.255.244
cd /opt/delovoy/app
git pull origin main
cd /opt/delovoy
docker compose up --build -d
docker compose logs -f app
```

### Откат

```bash
ssh root@5.129.255.244
cd /opt/delovoy/app
git log --oneline -5          # найти предыдущий коммит
git checkout {commit-hash}
cd /opt/delovoy
docker compose up --build -d
```

## 6. Мониторинг

### Эндпоинты здоровья

| URL | Что проверяет |
|---|---|
| `http://5.129.255.244/api/health` | Общий статус приложения |
| `http://5.129.255.244/api/timeweb/health` | Связь с Timeweb API |
| `http://5.129.255.244/api/gazebos/health` | Модуль беседок |
| `http://5.129.255.244/api/cafe/health` | Модуль кафе |
| `http://5.129.255.244/api/rental/health` | Модуль аренды |

### Логи Docker

```bash
docker compose -f /opt/delovoy/docker-compose.yml logs -f app     # приложение
docker compose -f /opt/delovoy/docker-compose.yml logs -f postgres # БД
docker compose -f /opt/delovoy/docker-compose.yml ps               # статус
```

## 7. Чеклист перед каждым деплоем

- [ ] Тесты проходят локально (`npm test`)
- [ ] Линтер чист (`npm run lint`)
- [ ] Сборка проходит (`npm run build`)
- [ ] `.env.example` обновлён если добавлены новые переменные
- [ ] Миграции Prisma созданы если схема менялась
- [ ] Коммит-месседж следует конвенции

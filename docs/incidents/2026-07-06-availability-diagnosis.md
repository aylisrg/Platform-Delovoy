# Диагностика периодической недоступности delovoy-park.ru

**Дата:** 2026-07-06
**Статус:** этапы 0–2 выполнены (2026-07-06, ветка `claude/project-refactor-availability-ufxadr`):
- Этап 0 — выполнен на VPS через `timeweb-manage.yml → ops-memory-relief` (run 28772278895): зомби-контейнер удалён (−300 MB), swap 2G включён (available 456→689 Mi). `delovoy-agent` оставлен — перенос на Hetzner требует отдельного решения.
- Этап 1 — коммит `4cbe879`: restart unless-stopped, NODE_OPTIONS 768M, autoheal, swap в setup-vps.sh. Вступит в силу после мержа и деплоя.
- Этап 2 — коммит `a0a79b3`: SSE-каркас с abort-cleanup и лимитом соединений, вечный Redis-реконнект, instrumentation-гарды, лог fail-open rate-limit. Тесты: 2507 passed.
- Этап 3 — не начат (поведенческие риски пагинации, требует отдельного решения)
**Источники данных:** кодовая база, история GitHub Actions, открытые issues, живое состояние VPS (`timeweb-manage.yml` → `server-logs` / `server-status`, запуски [28771641619](https://github.com/aylisrg/Platform-Delovoy/actions/runs/28771641619) и [28771649246](https://github.com/aylisrg/Platform-Delovoy/actions/runs/28771649246))

## TL;DR

Главная причина периодических падений — **хроническая нехватка памяти на недоразмеренном сервере** (1 vCPU / 2 GB вместо предполагаемых документацией 2 CPU / 4 GB), усиленная утечкой SSE-соединений в приложении и политикой `restart: on-failure:5`, из-за которой Docker после серии крашей перестаёт поднимать app вовсе.

## Факты с VPS (сняты 2026-07-06 06:12 UTC)

| Факт | Значение | Вывод |
|---|---|---|
| Сервер `delovoy-park-prod` (Timeweb id 7548623) | **1 vCPU / 2048 MB RAM** | DEPLOYMENT.md и лимиты compose рассчитаны на 2 CPU / 4 GB. Сервер вдвое меньше плана |
| `free -h` | 1.5 Gi used, **117 Mi free, 443 Mi available** | Постоянный дефицит памяти; свопа нет (`setup-vps.sh` его не создаёт) |
| Сумма mem-лимитов контейнеров | app 1G + postgres 512M + redis 128M + bot 256M = **1.9G ≈ 100% RAM** | Любой пик = OOM-killer |
| `delovoy-agent` | Up 5 weeks **на прод-VPS** | По DEPLOYMENT.md агент должен жить на отдельном Hetzner. Съедает память прода |
| `delovoy-park-app-run-5b45dfd42ff7` | Up **2 months** | Зомби-контейнер от ручного `docker compose run` — второй полный инстанс Next.js, зря держит сотни MB |
| `delovoy-app` | Up **4 days** (последний деплой — 1 июля, 5 дней назад) | Приложение перезапускалось **вне деплоя** → подтверждённый краш/OOM-рестарт |
| Диск | 41% | Не причина (мониторинг диска зелёный) |
| Логи app | Флуд `Failed to find Server Action` | Клиенты со старыми страницами после частых деплоев; шум, не причина падений |

## Причинно-следственная цепочка

1. **Память течёт в приложении** — SSE-эндпоинты (`src/app/api/webapp/events/stream/route.ts:61`, `src/app/api/admin/events/stream/route.ts:51`) не обрабатывают обрыв клиента (`request.signal` нигде не слушается): keepalive-`setInterval` и Redis-подписчики в `src/lib/realtime/redis-bus.ts` (Map `listeners`) накапливаются днями.
2. **Node не знает про лимит 1G** — `--max-old-space-size=4096` задан только на build-стадии Dockerfile, на рантайме V8 считает, что у него вся память хоста → контейнер убивается cgroup-OOM вместо мягкого GC.
3. **`restart: on-failure:5` только у app** (у postgres/redis/bot — `unless-stopped`). При краш-лупе (OOM при старте, недоступная БД) Docker после 5 попыток **перестаёт поднимать app** — сайт лежит до ручного вмешательства/деплоя. Docker-healthcheck есть, но к рестарту не привязан.
4. Фоновые отягчающие:
   - Redis-клиент **навсегда прекращает реконнект после 10 попыток** (`src/lib/redis.ts:15-18`) → rate-limit молча отключается (fail-open, `src/lib/rate-limit.ts:33`), realtime умирает до рестарта app;
   - нет глобального `unhandledRejection`/`uncaughtException`-гарда (нет `instrumentation.ts`) — одно необработанное исключение роняет процесс;
   - `getSystemMap` (`src/modules/monitoring/architect-service.ts:61-96`) устраивает fan-out внутренних HTTP-запросов сам в себя (по одному на активный модуль).

## Рекомендуемый план устранения

### Этап 0 — операционные действия, без кода (эффект сразу)
- Удалить зомби-контейнер `delovoy-park-app-run-5b45dfd42ff7` (`docker rm -f`).
- Перенести `delovoy-agent` на Hetzner (workflow `provision-hetzner-agent.yml` уже есть) или остановить.
- Добавить swap 2G на VPS (страховка от OOM).
- Либо апгрейд тарифа до 2 CPU / 4 GB — самый дешёвый способ купить стабильность.

### Этап 1 — PR: инфраструктура (`docker-compose.prod.yml`, `Dockerfile`, `scripts/setup-vps.sh`)
- `app: restart: unless-stopped` вместо `on-failure:5`.
- Рантайм `NODE_OPTIONS=--max-old-space-size=768` для app-контейнера.
- Создание swapfile в `setup-vps.sh`.
- Autoheal по healthcheck (например, контейнер `willfarrell/autoheal` или systemd-таймер с `docker compose restart` по unhealthy).

### Этап 2 — PR: живучесть процесса (`src/lib`, SSE)
- SSE: общий хелпер с `request.signal.addEventListener("abort", cleanup)` + лимит соединений на пользователя (2 файла роутов + `redis-bus.ts`).
- `src/lib/redis.ts`: убрать вечный отказ от реконнекта, `redisAvailable` выводить из `redis.status`.
- `src/instrumentation.ts`: обработчики `unhandledRejection`/`uncaughtException` с логированием в SystemEvent.
- Громкое логирование, когда rate-limit отключился из-за Redis.

### Этап 3 — PR: тяжёлые запросы (по мере надобности)
- `src/modules/clients/service.ts`: пагинация unbounded `findMany` (строки 211, 402, 646, 668, 921), разбить транзакцию `mergeClients`.
- `getSystemMap`: заменить HTTP fan-out на чтение кешированного снапшота.
- `connection_limit` в `DATABASE_URL`.

Каждый этап — отдельный PR по правилам CLAUDE.md (1 PR = 1 фича, тесты в том же коммите).

## Верификация исправлений

- После этапа 0/1: `timeweb-manage.yml → server-logs` — available memory > 1 GB, нет контейнеров-зомби; `docker inspect delovoy-app --format '{{.RestartCount}}'` не растёт сутки.
- После этапа 2: держать открытым SSE-клиент, оборвать соединение без close — размер `listeners` Map и число интервалов не растут; остановить Redis на 5 минут, поднять — реконнект и rate-limit восстанавливаются без рестарта app.
- Общий критерий: 2+ недели без незапланированных рестартов app (аптайм контейнера == дате последнего деплоя).

## Попутные наблюдения (вне рамок этой диагностики)

- Issue [#206](https://github.com/aylisrg/Platform-Delovoy/issues/206) (неприменённые миграции) фактически закрыт изменением деплой-пайплайна: `deploy.yml` теперь выполняет `prisma migrate deploy` на каждом деплое — issue можно закрыть после проверки `_prisma_migrations` на проде.
- Флуд `Failed to find Server Action` в логах — следствие частых авто-деплоев (каждый merge в main); клиенты со старой вкладкой получают ошибку. Лечится реже деплоями или уведомлением клиентов о новой версии (механизм release-notify уже есть).

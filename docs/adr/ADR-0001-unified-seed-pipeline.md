# ADR-0001: Unified Seed Pipeline Auto-Run on Prod Deploy

## Status
Accepted — 2026-04-29

## Context
Prod inci­dent: `/admin/tasks` падает с «Доска не настроена. Запустите seed». Миграция `20260426000000_tasks_kanban_and_channel_agnostic_notifications` применилась, таблицы есть, но `TaskBoard` пустой.

Причины:
- В репо три разрозненных сидера: `scripts/seed.ts` (core), `scripts/seed-tasks.ts`, `scripts/seed-rental.ts`. Между ними нет общего entrypoint.
- `docker-entrypoint.sh` вызывает `seed.ts` **только если в БД 0 пользователей** (первый старт). На существующем prod-инстансе условие не срабатывает → `seed-tasks.ts` не исполнялся ни разу.
- `.github/workflows/run-seed.yml` (manual button) вызывает только `seed.ts`, про tasks ничего не знает.
- Любая будущая миграция, которая требует справочных данных (новые модули/доски/категории), повторит этот баг.

Нужен механизм: **миграция → автоматический seed справочных данных → приложение готово к работе**, без ручного вмешательства. Решение должно быть идемпотентным (миграция тригерит seed на каждом деплое — это нормальное поведение, а не аварийный режим).

## Decision

1. **Single entrypoint** `scripts/seed.ts` оркестрирует все доменные сидеры последовательно. Каждый домен вынесен в отдельный модуль `scripts/seeds/<domain>.ts` и экспортирует чистую функцию `(prisma) → Promise<void>`. Никакого `prisma.$connect()` / `process.exit()` внутри доменных файлов — только в orchestrator.
2. **Идемпотентность обязательна**: каждый сидер использует `upsert` по уникальному ключу (slug, составной unique). Двукратный вызов = тот же конечный state, без дублей и без обновления `createdAt`.
3. **Auto-run на каждом деплое**: новый шаг в `.github/workflows/deploy.yml` после успешного health check, до smoke-тестов. Один раз — на каждый prod-deploy. Запуск через `docker compose exec -T app npx tsx scripts/seed.ts`.
4. **`run-seed.yml` остаётся** как emergency manual trigger с тем же entrypoint — без дублирующей логики.

### Почему не `prisma.seed` в `package.json`
`prisma db seed` запускается только командой `prisma migrate dev` / `prisma migrate reset`. На prod мы используем `prisma migrate deploy` — он seed **не вызывает** by design. Привязка через `package.json` создала бы ложное ощущение интеграции, не работающее в нашем pipeline. Явный шаг в deploy.yml честнее и проверяем.

### Почему не в `docker-entrypoint.sh`
Текущий entrypoint уже вызывает seed условно (только при пустой БД) — менять условие на «всегда» рискованно: каждый рестарт контейнера (OOM, ручной `docker compose restart`) запускает seed → лишняя нагрузка и шум в логах. Шаг в deploy.yml выполняется ровно один раз на релиз — это правильная гранулярность.

## Consequences

**Выигрываем:**
- Zero-touch консистентность справочных данных. Любая новая миграция, требующая seed, добавляет блок в `scripts/seeds/<domain>.ts` — и автоматически прогоняется на следующем деплое.
- Одна точка правды для развёртывания (`scripts/seed.ts`), нет drift между manual и auto.
- Идемпотентность тестируется юнит-тестом — проблема ловится в CI, не на prod.

**Ограничения:**
- **PII запрещён** в сидерах. Никаких реальных email/телефонов/ФИО арендаторов — это попадёт в git. `seed-rental.ts` оставляем как отдельный admin-only скрипт, его НЕ включаем в orchestrator (он читает `seed-rental.json`, который содержит реальные данные).
- **Только справочные данные**, не транзакционные. Модули, доски, колонки, категории, демо-офисы — да. Брони, заказы, договоры — нет.
- **Production-specific** seed-данные (например реальный `telegramId=694696` суперадмина) допустимы, но должны быть либо взяты из `process.env`, либо явно помечены как «owner override».
- **Rollback**: сидеры используют только `upsert`/`create`, никогда `delete`. Откат миграции = ручная очистка строк, добавленных сидером (DBA-операция, не автоматизируем).
- Время деплоя +5–10 секунд (стоимость идемпотентного `upsert` на ~30 строк).

## Implementation Contract (для senior-developer)

### Структура файлов

```
scripts/
├── seed.ts                       # orchestrator (entry point)
├── seeds/
│   ├── core.ts                   # SUPERADMIN, modules (cafe/ps-park/gazebos/parking/rental/inventory/management), gazebo+ps resources, menu items, demo offices, recurring expenses
│   └── tasks.ts                  # Module(tasks), TaskBoard(general), TaskColumn[6], TaskCategory[9]
├── seed-tasks.ts                 # УДАЛЯЕМ (логика переехала в scripts/seeds/tasks.ts)
└── seed-rental.ts                # ОСТАЁТСЯ как есть, НЕ включается в orchestrator (содержит PII из seed-rental.json)
```

### Сигнатуры

```ts
// scripts/seeds/core.ts
import type { PrismaClient } from "@prisma/client";
export async function seedCore(prisma: PrismaClient): Promise<void> { /* ... */ }

// scripts/seeds/tasks.ts
import type { PrismaClient } from "@prisma/client";
export async function seedTasks(prisma: PrismaClient): Promise<void> { /* ... */ }
```

```ts
// scripts/seed.ts (orchestrator)
import { PrismaClient } from "@prisma/client";
import { seedCore } from "./seeds/core";
import { seedTasks } from "./seeds/tasks";

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("🌱 Seed pipeline started");
    await seedCore(prisma);   // Module rows must exist first
    await seedTasks(prisma);  // depends on Module(tasks)
    console.log("✅ Seed pipeline completed");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); });
```

**Порядок строгий**: `seedCore` создаёт `Module` rows (включая `tasks` если решим перенести оттуда — но в данной итерации `Module(tasks)` остаётся внутри `seedTasks` через upsert, чтобы не плодить cross-file зависимости).

### Идемпотентность — обязательные правила

| Сущность | Уникальный ключ для upsert |
|----------|---------------------------|
| `User` (admin) | `telegramId` |
| `Module` | `slug` |
| `Resource` (gazebo/ps) | `(moduleSlug, name)` через find→update/create (нет составного unique в схеме) |
| `MenuItem` | `(moduleSlug, name)` через find→create |
| `Office` | `(building, floor, number)` |
| `RecurringExpense` | `name` через find→create |
| `TaskBoard` | `slug` |
| `TaskColumn` | `(boardId, sortOrder)` через find→update/create |
| `TaskCategory` | `slug` |

`update` блок в `upsert` обновляет только описательные поля (`name`, `description`, `color`, `keywords`). НЕ перезаписывает `isActive`, `createdAt`, JSON-конфиг — иначе менеджер вручную выключит модуль через UI и seed его обратно включит.

### Изменения в `.github/workflows/deploy.yml`

Между текущими шагами **«Deploy via SSH»** (заканчивается на `exit 0` после health check passed) и **«Verify deployment + smoke tests»** добавить новый step. Альтернативно — расширить блок `=== Run data migrations ===` внутри «Deploy via SSH»:

Точное место — `deploy.yml` строки 243–247, заменить блок:

```yaml
            if [ "$HEALTHY" = true ]; then
              echo "=== Run data migrations ==="
              docker compose exec -T app npx tsx scripts/set-public-phone.ts \
                && echo "✅ Phone config applied" \
                || echo "⚠️ set-public-phone.ts failed — check manually"
              exit 0
            fi
```

на:

```yaml
            if [ "$HEALTHY" = true ]; then
              echo "=== Run unified seed pipeline ==="
              docker compose exec -T app npx tsx scripts/seed.ts \
                && echo "✅ Seed pipeline OK" \
                || { echo "❌ Seed pipeline FAILED"; exit 1; }

              echo "=== Run data migrations ==="
              docker compose exec -T app npx tsx scripts/set-public-phone.ts \
                && echo "✅ Phone config applied" \
                || echo "⚠️ set-public-phone.ts failed — check manually"
              exit 0
            fi
```

**Важно**: failure seed-а — это failure деплоя (`exit 1`). Без справочных данных модуль tasks не работает — это не «non-fatal». Smoke tests после этого должны валидировать `/admin/tasks`.

### Изменения в `run-seed.yml`

Без изменений по логике — он уже зовёт `scripts/seed.ts`. После рефакторинга он автоматически запустит весь pipeline через единый entrypoint. Обновить только описание/коммент:

```yaml
# Manual emergency trigger. Calls the same unified pipeline as deploy.yml.
# Idempotent — safe to run any time.
```

### Изменения в `docker-entrypoint.sh`

Удалить блок `--- 4. Restore rental data (one-time) ---` (строки 57–75) **только после** того, как rental данные подтверждённо есть на prod. Это **не часть текущего ADR** — отдельный cleanup.

Блок `--- 3. Conditional seed ---` оставить как есть (страховка для первого старта на чистой БД).

### Тесты (обязательны)

Создать `scripts/seeds/__tests__/core.test.ts` и `scripts/seeds/__tests__/tasks.test.ts`. На каждый сидер — минимум:

1. **Idempotency test**: вызов дважды → одинаковое количество строк в каждой задействованной таблице, нет дублей по unique-ключу.
2. **Empty DB test**: на пустой БД создаёт ожидаемое количество строк (например `seedTasks` → 1 Module + 1 TaskBoard + 6 TaskColumn + 9 TaskCategory).
3. **Partial state test**: если 2 из 9 категорий уже существуют с кастомным `name`, seed не перезаписывает их полностью — только описательные поля.

Мокаем Prisma через `vi.mock('@prisma/client')` с in-memory store, или используем testcontainers для PostgreSQL. Предпочтение — testcontainers (быстрее покрывает реальные unique-constraint баги). Если testcontainers недоступны в CI — мок через `vi.fn()` с эмуляцией upsert-семантики.

### RBAC и Security (применимо к скриптам)

- **Доступ к запуску**: workflow `deploy.yml` и `run-seed.yml` имеют `environment: production` → требуют approval из protected env. Никакая роль приложения (USER/MANAGER/SUPERADMIN) к этому отношения не имеет — это infra layer.
- **Никаких секретов в коде сидеров**. `telegramId` админа можно прочитать из `process.env.SUPERADMIN_TELEGRAM_ID` (default — текущий хардкод, для backward compat).
- **Никакого PII**. Code Reviewer обязан проверить `git diff scripts/seeds/` на наличие email/phone/ФИО реальных людей.
- **Rate limiting не применим** (не HTTP endpoint).
- **Audit log**: добавить `console.log` с timestamp и количеством обработанных строк в каждом сидере. Этого достаточно — записи попадут в Docker logs и видны через `docker compose logs app`.

## Проверка после деплоя

После мержа PR и первого прохода нового pipeline:

```bash
# на VPS
docker compose exec -T app npx tsx -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  Promise.all([
    p.taskBoard.count(),
    p.taskColumn.count(),
    p.taskCategory.count(),
  ]).then(([b,c,cat]) => console.log({boards: b, columns: c, categories: cat}))
   .finally(() => p.\$disconnect());
"
# Ожидаем: { boards: >=1, columns: >=6, categories: >=9 }
```

И открыть `/admin/tasks` — доска должна загружаться без ошибки seed.

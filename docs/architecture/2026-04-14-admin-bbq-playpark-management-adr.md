# ADR: Управленческие панели Барбекю Парк и Плей Парк + Защита БД + Тесты админки

**Дата:** 2026-04-14
**Статус:** Предложено
**Авторы:** System Architect (Claude)

---

## Контекст

### Проблема 1: Барбекю Парк (gazebos) не имеет timeline-расписания
Текущая админка Барбекю Парка (`src/app/admin/gazebos/page.tsx`) -- это вертикальный список бронирований с формой создания. У Плей Парка уже есть полноценный timeline-grid с ресурсами по строкам, часами по столбцам, быстрым бронированием кликом по слоту, карточкой деталей и маркером текущего времени. Барбекю Парку нужен аналогичный UX.

### Проблема 2: Нет подстраниц управления
Оба модуля (ps-park и gazebos) живут на одной странице `/admin/{module}`. Нет отдельных экранов для управления ресурсами, истории бронирований с фильтрами, аналитики и настроек модуля.

### Проблема 3: Нет тестов для компонентов админки
Компоненты `src/components/admin/ps-park/` и `src/components/admin/gazebos/` не покрыты тестами.

### Проблема 4: БД не защищена
- Используется `prisma db push` вместо миграций -- нет истории изменений схемы
- Нет soft delete для критичных моделей (Booking, Order, Resource)
- Нет автоматических бэкапов
- Нет ограничения на деструктивные операции на уровне PostgreSQL

### Текущая архитектура (что уже есть)

**PS Park (эталон):**
- `src/app/admin/ps-park/page.tsx` -- монолитная страница со всем: timeline, shift panel, active sessions, pending bookings, resources, history
- `src/components/admin/ps-park/` -- 16 компонентов: `timeline-grid.tsx`, `date-navigator.tsx`, `quick-booking-popover.tsx`, `booking-detail-card.tsx`, `booking-actions.tsx`, `table-editor.tsx`, `active-sessions-panel.tsx`, `shift-panel.tsx`, `booking-history-table.tsx`, `session-bill-modal.tsx`, `complete-session-button.tsx`, `extend-session-button.tsx`, `add-items-button.tsx`, `admin-booking-form.tsx`, `test-alerts-button.tsx`
- `src/modules/ps-park/service.ts` -- `getTimeline()`, `getActiveSessions()`, CRUD ресурсов, CRUD бронирований
- `src/modules/ps-park/types.ts` -- `TimelineData`, `TimelineBooking`, `ActiveSession`, `BookingBill`
- `src/app/api/ps-park/timeline/route.ts` -- API для загрузки timeline по дате

**Gazebos (текущее состояние):**
- `src/app/admin/gazebos/page.tsx` -- плоская страница: stats, booking form, resources table, bookings list
- `src/components/admin/gazebos/` -- 3 компонента: `booking-actions.tsx`, `admin-booking-form.tsx`, `resource-editor.tsx`
- `src/modules/gazebos/service.ts` -- `listResources()`, `listBookings()`, `createBooking()`, `updateBookingStatus()`, `getAvailability()` (без `getTimeline()`)
- `src/modules/gazebos/types.ts` -- `GazeboResource`, `GazeboBooking`, `BookingFilter`, `DayAvailability` (без `TimelineData`)

---

## Рассмотренные варианты

### Вариант A: Создать общий абстрактный модуль для timeline + подстраниц

Создать `src/components/admin/shared/timeline/` с параметризованными компонентами, которые оба модуля переиспользуют через props (moduleSlug, apiPrefix, labels).

**Плюсы:** Максимальное переиспользование, единый источник истины.
**Минусы:** Преждевременная абстракция. PS Park имеет уникальные концепции (shifts, active sessions, session billing, item add), которые Gazebos не использует. Общий компонент станет God Component с кучей условий. Рефакторинг существующего PS Park рискован (regression).

### Вариант B: Клонировать PS Park компоненты для Gazebos, адаптировать, потом извлечь общее

Скопировать timeline-grid, date-navigator, quick-booking-popover, booking-detail-card для Gazebos, убрать PS Park-специфику (items, sessions, shifts), адаптировать labels. Подстраницы создать через Next.js route groups. Позже, когда оба модуля стабилизируются, извлечь общие компоненты.

**Плюсы:** Быстро, безопасно (PS Park не трогаем), каждый модуль развивается независимо. Соответствует принципу Domain Modules из CLAUDE.md.
**Минусы:** Дублирование кода (timeline-grid, date-navigator). Но это 2 файла по ~300 строк, и они уже начнут расходиться (разные метаданные, разные действия).

### Вариант C: Извлечь 2-3 leaf-компонента в shared, остальное -- per-module

Извлечь только чистые utility-компоненты без бизнес-логики (`DateNavigator`, базовый layout timeline-сетки) в `src/components/admin/shared/`. Module-specific компоненты (booking popover, detail card, actions) остаются в per-module директориях.

**Плюсы:** Баланс между переиспользованием и изоляцией. DateNavigator идентичен для обоих модулей. Timeline-сетка отличается только labels и booking-click behavior.
**Минусы:** Нужно определить границу "что shared, что нет" -- это субъективно.

---

## Решение

**Вариант C: Извлечь leaf-компоненты в shared, остальное per-module.**

### Обоснование

1. `DateNavigator` -- чистый UI, не зависит от модуля. Переиспользуем как есть.
2. `TimelineGrid` -- 80% логики одинаковое (рендер сетки, часы, маркер времени, стиль бронирований), но booking-click, popover content и detail card -- разные. Создаём `<BaseTimelineGrid>` в shared, который принимает render-props для booking blocks и slot clicks. Каждый модуль оборачивает в свой компонент.
3. `QuickBookingPopover` и `BookingDetailCard` -- module-specific (разные поля: playerCount vs guestCount, items vs no items, session billing vs simple booking).
4. Подстраницы через Next.js nested routes (уже поддерживается App Router).
5. Навигация внутри модуля -- через табы (client component `ModuleTabs`).

---

## Архитектурное решение

### 1. Структура маршрутов (подстраницы)

```
src/app/admin/gazebos/
  page.tsx                    -- Timeline (главная) -- ПЕРЕПИСАТЬ
  resources/page.tsx          -- CRUD ресурсов -- НОВЫЙ
  bookings/page.tsx           -- История бронирований с фильтрами -- НОВЫЙ
  analytics/page.tsx          -- Метрики и графики -- НОВЫЙ
  settings/page.tsx           -- Настройки модуля -- НОВЫЙ
  marketing/page.tsx          -- Уже есть (Авито, Директ)
  layout.tsx                  -- Layout с табами -- НОВЫЙ

src/app/admin/ps-park/
  page.tsx                    -- Timeline + Active Sessions (главная) -- РЕФАКТОРИНГ
  resources/page.tsx          -- CRUD столов -- НОВЫЙ (извлечь из page.tsx)
  bookings/page.tsx           -- История с фильтрами -- НОВЫЙ (извлечь из page.tsx)
  analytics/page.tsx          -- Метрики и графики -- НОВЫЙ
  settings/page.tsx           -- Настройки модуля -- НОВЫЙ
  layout.tsx                  -- Layout с табами -- НОВЫЙ
```

### 2. Навигация внутри модуля (табы)

Новый shared-компонент:

```
src/components/admin/shared/module-tabs.tsx
```

```typescript
// Props:
type ModuleTabsProps = {
  moduleSlug: string;
  tabs: { label: string; href: string; badge?: number }[];
};
```

Рендерит горизонтальные табы под заголовком. Активный таб определяется по `usePathname()`. Используется в `layout.tsx` каждого модуля.

Конфигурация табов:

| Таб | Href | Оба модуля? |
|-----|------|-------------|
| Расписание | `/admin/{module}` | Да |
| Ресурсы | `/admin/{module}/resources` | Да |
| Бронирования | `/admin/{module}/bookings` | Да |
| Аналитика | `/admin/{module}/analytics` | Да |
| Настройки | `/admin/{module}/settings` | Да |
| Реклама | `/admin/gazebos/marketing` | Только gazebos |

### 3. Компоненты: что переиспользовать, что создать

#### Извлечь в shared (из PS Park):

| Компонент | Откуда | Куда | Изменения |
|-----------|--------|------|-----------|
| `DateNavigator` | `ps-park/date-navigator.tsx` | `shared/date-navigator.tsx` | Без изменений, чистый UI |
| `ModuleTabs` | --- | `shared/module-tabs.tsx` | Новый компонент |

#### Создать для Gazebos (на основе PS Park):

| Компонент | Прототип (PS Park) | Отличия |
|-----------|-------------------|---------|
| `TimelineGrid` | `ps-park/timeline-grid.tsx` | Убрать: items, session billing. Добавить: guestCount в booking block. API: `/api/gazebos/timeline` вместо `/api/ps-park/timeline` |
| `QuickBookingPopover` | `ps-park/quick-booking-popover.tsx` | Убрать: playerCount. Добавить: guestCount. API: `/api/gazebos/admin-book` |
| `BookingDetailCard` | `ps-park/booking-detail-card.tsx` | Убрать: playerCount, items, itemsTotal, session billing. Добавить: guestCount. API: `/api/gazebos/bookings/{id}` |
| `BookingHistoryTable` | `ps-park/booking-history-table.tsx` | Адаптировать labels (Стол -> Беседка). Добавить фильтры по дате, статусу, ресурсу |

#### Оставить per-module (не трогать в PS Park):

| Компонент | Причина |
|-----------|---------|
| `ActiveSessionsPanel` | Только PS Park (сессионная модель) |
| `ShiftPanel` | Только PS Park (смены) |
| `SessionBillModal` | Только PS Park (итоговый чек сессии) |
| `CompleteSessionButton` | Только PS Park |
| `ExtendSessionButton` | Только PS Park |
| `AddItemsButton` | Только PS Park (товары из склада) |

### 4. Изменения схемы данных (Prisma)

#### 4.1 Soft delete для критичных моделей

Добавить поле `deletedAt DateTime?` к моделям, где удаление допустимо, но данные нужно сохранить:

```prisma
model Booking {
  // ... existing fields ...
  deletedAt   DateTime?           // NEW: soft delete

  @@index([deletedAt])            // NEW
}

model Resource {
  // ... existing fields ...
  deletedAt   DateTime?           // NEW: soft delete

  @@index([deletedAt])            // NEW
}

model Order {
  // ... existing fields ...
  deletedAt   DateTime?           // NEW: soft delete
}

model MenuItem {
  // ... existing fields ...
  deletedAt   DateTime?           // NEW: soft delete
}
```

**Не добавляем soft delete к:**
- `User` -- уже есть механизм деактивации через role
- `Tenant` -- уже есть `isDeleted: Boolean`
- `AuditLog`, `SystemEvent` -- иммутабельные логи, никогда не удаляются
- `FinancialTransaction` -- иммутабельный финансовый лог

**Конвенция:** Все сервисы должны добавлять `where: { deletedAt: null }` в запросы чтения. Создать хелпер `notDeleted()` в `src/lib/db.ts`:

```typescript
export const notDeleted = { deletedAt: null } as const;
```

#### 4.2 Baseline migration

Текущее состояние: `prisma db push` (нет директории `prisma/migrations/`).

Шаги:
1. `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`
2. `npx prisma migrate resolve --applied 0_init`
3. Все дальнейшие изменения -- через `npx prisma migrate dev`

### 5. Новые API endpoints

#### 5.1 Gazebos Timeline API (НОВЫЙ)

```
GET /api/gazebos/timeline?date=YYYY-MM-DD
```

Response (аналогичен `/api/ps-park/timeline`):
```json
{
  "success": true,
  "data": {
    "date": "2026-04-14",
    "resources": [
      { "id": "...", "name": "Беседка #1", "capacity": 10, "pricePerHour": 2000 }
    ],
    "bookings": [
      {
        "id": "...",
        "resourceId": "...",
        "startTime": "2026-04-14T10:00:00.000Z",
        "endTime": "2026-04-14T14:00:00.000Z",
        "status": "CONFIRMED",
        "clientName": "Иван",
        "clientPhone": "+79991234567",
        "metadata": { "guestCount": 8 }
      }
    ],
    "hours": ["08:00", "09:00", ..., "22:00"]
  }
}
```

Реализация: добавить `getTimeline(date: string)` в `src/modules/gazebos/service.ts` (аналог PS Park).

#### 5.2 Bookings History API с пагинацией (НОВЫЙ для обоих модулей)

```
GET /api/{module}/bookings?page=1&perPage=20&status=COMPLETED&dateFrom=2026-04-01&dateTo=2026-04-14&resourceId=xxx
```

Response:
```json
{
  "success": true,
  "data": [...bookings with user+resource info...],
  "meta": { "page": 1, "perPage": 20, "total": 142 }
}
```

Текущий `GET /api/gazebos/bookings` уже есть, но без пагинации. Нужно расширить.
Текущий `GET /api/ps-park/bookings` -- аналогично.

#### 5.3 Analytics API (НОВЫЙ для обоих модулей)

```
GET /api/{module}/analytics?period=week|month|quarter
```

Response:
```json
{
  "success": true,
  "data": {
    "totalBookings": 142,
    "completedBookings": 120,
    "cancelledBookings": 12,
    "totalRevenue": 284000,
    "averageCheck": 2367,
    "occupancyRate": 0.68,
    "byDay": [
      { "date": "2026-04-08", "bookings": 12, "revenue": 24000 },
      ...
    ],
    "byResource": [
      { "resourceId": "...", "resourceName": "...", "bookings": 45, "revenue": 90000 },
      ...
    ],
    "topHours": [
      { "hour": 12, "bookings": 28 },
      { "hour": 14, "bookings": 25 },
      ...
    ]
  }
}
```

Реализация: `getAnalytics(period)` в `src/modules/{module}/service.ts`. Агрегация через Prisma groupBy.

#### 5.4 Module Settings API (НОВЫЙ)

```
GET  /api/{module}/settings         -- текущие настройки (из Module.config JSON)
PATCH /api/{module}/settings        -- обновить настройки
```

Настройки хранятся в `Module.config` (JSONB). Структура для каждого модуля:

```typescript
// gazebos
type GazeboModuleConfig = {
  openHour: number;        // default 8
  closeHour: number;       // default 23
  minBookingHours: number; // default 1
  maxBookingHours: number; // default 8
  cancellationPolicy: {
    freeCancelHours: number; // default 24
    penaltyPercent: number;  // default 50
  };
};

// ps-park
type PSParkModuleConfig = {
  openHour: number;
  closeHour: number;
  minBookingHours: number;
  slotRoundingMinutes: number; // default 30
  sessionAlertMinutes: number; // default 10
};
```

### 6. Файловая структура -- полный список изменений

```
# НОВЫЕ файлы
src/components/admin/shared/
  date-navigator.tsx              # Извлечь из ps-park/date-navigator.tsx
  module-tabs.tsx                 # Табы навигации внутри модуля

src/components/admin/gazebos/
  timeline-grid.tsx               # Адаптация ps-park/timeline-grid.tsx
  quick-booking-popover.tsx       # Адаптация ps-park/quick-booking-popover.tsx
  booking-detail-card.tsx         # Адаптация ps-park/booking-detail-card.tsx
  booking-history-table.tsx       # Адаптация ps-park/booking-history-table.tsx

src/app/admin/gazebos/
  layout.tsx                      # Layout с табами
  page.tsx                        # ПЕРЕПИСАТЬ: timeline вместо плоского списка
  resources/page.tsx              # CRUD ресурсов (извлечь из текущего page.tsx)
  bookings/page.tsx               # История с фильтрами и пагинацией
  analytics/page.tsx              # Метрики
  settings/page.tsx               # Настройки модуля

src/app/admin/ps-park/
  layout.tsx                      # Layout с табами
  page.tsx                        # РЕФАКТОРИНГ: оставить timeline + active sessions
  resources/page.tsx              # CRUD столов (извлечь из текущего page.tsx)
  bookings/page.tsx               # История с фильтрами
  analytics/page.tsx              # Метрики
  settings/page.tsx               # Настройки

src/app/api/gazebos/
  timeline/route.ts               # GET /api/gazebos/timeline
  analytics/route.ts              # GET /api/gazebos/analytics
  settings/route.ts               # GET + PATCH /api/gazebos/settings

src/app/api/ps-park/
  analytics/route.ts              # GET /api/ps-park/analytics
  settings/route.ts               # GET + PATCH /api/ps-park/settings

# Типы
src/modules/gazebos/types.ts      # Добавить: TimelineData, TimelineBooking
src/modules/ps-park/types.ts      # Без изменений (уже есть)

# Сервисы
src/modules/gazebos/service.ts    # Добавить: getTimeline(), getAnalytics()
src/modules/ps-park/service.ts    # Добавить: getAnalytics()

# Тесты
src/components/admin/shared/__tests__/
  date-navigator.test.tsx
  module-tabs.test.tsx

src/components/admin/gazebos/__tests__/
  timeline-grid.test.tsx
  quick-booking-popover.test.tsx
  booking-detail-card.test.tsx

src/components/admin/ps-park/__tests__/
  timeline-grid.test.tsx
  booking-detail-card.test.tsx
  booking-history-table.test.tsx

# Защита БД
prisma/migrations/0_init/migration.sql    # Baseline migration
scripts/backup-db.sh                       # pg_dump + ротация
scripts/lint-migration.sh                  # Проверка на DROP/TRUNCATE

# ИЗМЕНЯЕМЫЕ файлы
prisma/schema.prisma              # + deletedAt поля
src/lib/db.ts                     # + notDeleted helper
src/components/admin/ps-park/
  date-navigator.tsx              # Заменить на импорт из shared/
  timeline-grid.tsx               # Обновить импорт DateNavigator
```

### 7. Защита БД

#### 7.1 Миграции (baseline)

```bash
# На production сервере (одноразово):
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql

npx prisma migrate resolve --applied 0_init
```

После этого все изменения через `npx prisma migrate dev --name <description>`.

CI pipeline: добавить проверку `npx prisma migrate status` -- если есть непримененные миграции, build fails.

#### 7.2 Автоматические бэкапы

Скрипт `scripts/backup-db.sh`:

```bash
#!/bin/bash
# Ежедневный бэкап PostgreSQL с ротацией 30 дней
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
DB_NAME="${DB_NAME:-delovoy_park}"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"

# Ротация
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
```

Cron: `0 3 * * * /path/to/scripts/backup-db.sh`

#### 7.3 Ограничение DELETE на уровне PostgreSQL

Создать отдельного DB-пользователя для приложения:

```sql
-- Пользователь для приложения (без DELETE на критичных таблицах)
CREATE ROLE delovoy_app WITH LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA public TO delovoy_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO delovoy_app;
-- DELETE только на некритичных таблицах (Session, VerificationToken, AdminPermission)
GRANT DELETE ON "Session", "VerificationToken", "AdminPermission", "Account" TO delovoy_app;
-- Sequences нужны для INSERT
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO delovoy_app;

-- Пользователь для миграций (полные права)
CREATE ROLE delovoy_admin WITH LOGIN PASSWORD '...' SUPERUSER;
```

`DATABASE_URL` приложения использует `delovoy_app`. Миграции запускаются через отдельный `DATABASE_URL_ADMIN`.

#### 7.4 Линтер миграций

Скрипт `scripts/lint-migration.sh`:

```bash
#!/bin/bash
# Проверка SQL-миграций на деструктивные операции
set -euo pipefail

FORBIDDEN_PATTERNS="DROP TABLE|DROP COLUMN|TRUNCATE|DROP INDEX"
EXIT_CODE=0

for file in prisma/migrations/*/migration.sql; do
  if grep -iE "$FORBIDDEN_PATTERNS" "$file" > /dev/null 2>&1; then
    echo "WARNING: Destructive operation found in $file:"
    grep -inE "$FORBIDDEN_PATTERNS" "$file"
    EXIT_CODE=1
  fi
done

if [ $EXIT_CODE -eq 0 ]; then
  echo "All migrations passed lint check."
fi
exit $EXIT_CODE
```

CI: добавить `scripts/lint-migration.sh` в pipeline перед `prisma migrate deploy`.

---

## Стратегия тестирования

### Фреймворк

- **Vitest** (уже настроен в `vitest.config.ts`)
- **React Testing Library** для компонентов
- Мокирование: `vi.mock('@/lib/db')`, `vi.mock('next/navigation')`

### Покрытие

#### Tier 1: Unit-тесты сервисов (высший приоритет)

| Файл | Тесты |
|------|-------|
| `src/modules/gazebos/service.ts` | `getTimeline()` -- возвращает правильный формат, фильтрует только PENDING/CONFIRMED |
| `src/modules/gazebos/service.ts` | `getAnalytics()` -- агрегация за period, пустые данные |
| `src/modules/ps-park/service.ts` | `getAnalytics()` -- аналогично |
| `src/modules/gazebos/validation.ts` | Zod-схемы для timeline query, settings update |
| `src/modules/ps-park/validation.ts` | Zod-схемы для analytics query, settings update |

#### Tier 2: Тесты компонентов (React Testing Library)

| Компонент | Тесты |
|-----------|-------|
| `shared/date-navigator.tsx` | Рендер, клик "Сегодня", навигация +/- день, ввод даты |
| `shared/module-tabs.tsx` | Рендер табов, active state по pathname, badge count |
| `gazebos/timeline-grid.tsx` | Рендер ресурсов и часов, клик по свободному слоту открывает popover, бронирование блок отображается |
| `gazebos/quick-booking-popover.tsx` | Рендер формы, валидация (start < end), submit вызывает API |
| `gazebos/booking-detail-card.tsx` | Рендер деталей бронирования, кнопки действий по статусу |
| `ps-park/timeline-grid.tsx` | Рендер ресурсов, маркер текущего времени, booking blocks |
| `ps-park/booking-detail-card.tsx` | Items отображаются, billing summary корректен |
| `ps-park/booking-history-table.tsx` | Рендер строк, клик по completed показывает bill |

#### Tier 3: API integration тесты

| Endpoint | Тесты |
|----------|-------|
| `GET /api/gazebos/timeline` | Happy path, invalid date, empty day |
| `GET /api/{module}/analytics` | Happy path, empty period, invalid period param |
| `GET /api/{module}/settings` | Returns config, auth required |
| `PATCH /api/{module}/settings` | Updates config, validates input, auth SUPERADMIN only |
| `GET /api/{module}/bookings` | Pagination, filters, empty result |

### Паттерн мокирования

```typescript
// Мокируем Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    resource: { findMany: vi.fn() },
    booking: { findMany: vi.fn(), count: vi.fn() },
    module: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

// Мокируем next/navigation для компонентов
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/admin/gazebos"),
  useRouter: vi.fn(() => ({ refresh: vi.fn(), push: vi.fn() })),
}));
```

---

## План реализации (порядок)

### Этап 1: Фундамент (1-2 дня)
1. Baseline migration (`0_init`)
2. Добавить `deletedAt` поля в schema + миграция
3. Создать `notDeleted` хелпер в `src/lib/db.ts`
4. Скрипты `backup-db.sh` и `lint-migration.sh`
5. Извлечь `DateNavigator` в `shared/`
6. Создать `ModuleTabs` компонент

### Этап 2: Gazebos Timeline (2-3 дня)
1. Добавить `TimelineData`, `TimelineBooking` типы в `src/modules/gazebos/types.ts`
2. Добавить `getTimeline()` в `src/modules/gazebos/service.ts`
3. Создать `GET /api/gazebos/timeline` route
4. Создать gazebos timeline-grid, quick-booking-popover, booking-detail-card
5. Переписать `src/app/admin/gazebos/page.tsx` на timeline

### Этап 3: Подстраницы (2-3 дня)
1. Создать layout.tsx с табами для обоих модулей
2. Извлечь resources в `/admin/{module}/resources`
3. Создать bookings history с фильтрами для обоих модулей
4. Создать analytics endpoint + страницу
5. Создать settings endpoint + страницу

### Этап 4: Тесты (1-2 дня)
1. Tier 1: unit-тесты сервисов (getTimeline, getAnalytics)
2. Tier 2: компонентные тесты (timeline-grid, date-navigator, module-tabs)
3. Tier 3: API integration тесты

### Этап 5: DB Protection (0.5 дня)
1. Настроить DB users на production
2. Добавить lint-migration.sh в CI
3. Добавить cron для backup-db.sh

---

## Риски и митигации

| Риск | Митигация |
|------|-----------|
| Baseline migration ломает production | Используем `migrate resolve --applied` -- не выполняет SQL, только помечает как применённую |
| Soft delete ломает существующие запросы | Поэтапно: сначала добавляем поле (nullable), потом обновляем сервисы. `deletedAt: null` -- это то же самое что "нет поля" для существующих записей |
| PS Park рефакторинг (подстраницы) ломает работу менеджера | Сначала создаём подстраницы, потом переносим. Главная страница остаётся рабочей на каждом шаге |
| DB user без DELETE блокирует Prisma cascade deletes | Разрешаем DELETE на Session, VerificationToken, Account, AdminPermission (таблицы где Prisma делает onDelete: Cascade) |

---

## Из scope исключено

- WebSocket для real-time обновлений timeline (overkill для 3-8 ресурсов)
- Drag-and-drop бронирований на timeline (Phase 6+)
- Экспорт аналитики в PDF/Excel (Phase 6+)
- Shift management для Gazebos (не нужен -- нет сессионной модели)
- Полный рефакторинг PS Park timeline-grid в shared компонент (после стабилизации обоих модулей)

# CLAUDE.md — Platform Delovoy

> Этот файл — источник правды для архитектуры, стратегии и правил разработки платформы Деловой Парк (Селятино, Московская область). Claude Code и все разработчики должны следовать этим соглашениям.

---

## Философия проекта

### Миссия
Сайт бизнес-парка "Деловой" — не просто витрина, а **платформа управления бизнесом**. Фронтенд для клиентов (B2C) и богатый бекенд для менеджеров и администратора (B2B).

### Принципы разработки

1. **API-First** — любой функционал сначала появляется как REST API, потом получает UI (веб, бот, мобилка). Все клиенты работают через один API-слой.
2. **Domain Modules** — каждый бизнес (кафе, PS Park, беседки, аренда офисов) — изолированный модуль со своей логикой, но с общими сервисами (auth, notifications, payments).
3. **Progressive Enhancement** — запускаем MVP каждого модуля, потом наращиваем. Не нужно сразу делать идеальный функционал.
4. **Manager Autonomy** — каждый менеджер видит только свой домен. Суперадмин видит всё через единый дашборд.
5. **Config as Code** — конфигурация модулей хранится в структурированном виде (БД + YAML). Включение/выключение модулей, лимиты, настройки — без изменения кода.

---

## Стек технологий

| Компонент | Технология | Почему |
|-----------|-----------|--------|
| Frontend + API | **Next.js 15** (App Router) | Единая кодовая база, Server Components, Route Handlers как REST API |
| ORM | **Prisma** | Type-safe, автогенерация типов, миграции из коробки |
| База данных | **PostgreSQL** | Реляционная БД для договоров, бронирований, финансов. JSONB для гибких конфигов |
| Кэш/очереди | **Redis** | Сессии, кэш, очередь уведомлений, rate limiting |
| Авторизация | **NextAuth.js** | Роли, Telegram OAuth, email magic links |
| Стили | **Tailwind CSS** | Utility-first, быстрая разработка UI |
| Деплой | **Docker Compose** на VPS | Полный контроль, без оверхеда Kubernetes |
| Мониторинг | Встроенный (PostgreSQL + Telegram alerts) | Простота на старте, масштабируется при необходимости |

### Версии (минимальные)
- Node.js >= 20 LTS
- PostgreSQL >= 16
- Redis >= 7
- npm (не yarn, не pnpm — для единообразия)

---

## Архитектура

### Высокоуровневая схема

```
┌─────────────────────────────────────────────────────────┐
│                       CLIENTS                            │
│   Web (SPA)  │  Telegram Bot  │  Mobile App  │  Admin   │
└──────┬───────┴───────┬────────┴──────┬───────┴────┬─────┘
       │               │               │            │
       ▼               ▼               ▼            ▼
┌─────────────────────────────────────────────────────────┐
│              API GATEWAY + AUTH (RBAC)                    │
│         Next.js Route Handlers + Middleware               │
└──────┬──────────────┬──────────────┬────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌────────────┐ ┌──────────────┐ ┌───────────┐
│ Auth+Roles │ │ Notifications│ │ Payments  │
│ (shared)   │ │ (shared)     │ │ (shared)  │
└────────────┘ └──────────────┘ └───────────┘
       │              │              │
       ▼              ▼              ▼
┌─────────────────────────────────────────────────────────┐
│                  DOMAIN MODULES                          │
│                                                          │
│  B2C:  Cafe │ PS Park │ Gazebos │ Parking               │
│  B2B:  Office Rental │ Tenant CRM │ Accounting          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  INFRASTRUCTURE                          │
│   PostgreSQL  │  Redis  │  File Storage  │  Monitoring   │
└─────────────────────────────────────────────────────────┘
```

### Структура директорий

```
platform-delovoy/
├── CLAUDE.md                    # Этот файл
├── docker-compose.yml           # PostgreSQL + Redis + App
├── .env.example                 # Шаблон переменных окружения
├── prisma/
│   ├── schema.prisma            # Схема базы данных
│   └── migrations/              # Миграции Prisma
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (public)/            # Публичные страницы (B2C)
│   │   │   ├── page.tsx         # Главная
│   │   │   ├── cafe/            # Кафе — меню, заказ
│   │   │   ├── ps-park/         # PlayStation Park — бронирование
│   │   │   ├── gazebos/         # Беседки — бронирование
│   │   │   └── parking/         # Парковка — информация
│   │   ├── (admin)/             # Админ-панель (защищена RBAC)
│   │   │   ├── dashboard/       # Общий дашборд суперадмина
│   │   │   ├── modules/         # Управление модулями
│   │   │   ├── users/           # Управление пользователями
│   │   │   ├── monitoring/      # Мониторинг и статус системы
│   │   │   └── [module]/        # Динамические панели менеджеров
│   │   ├── api/                 # REST API (Route Handlers)
│   │   │   ├── auth/            # Авторизация (NextAuth)
│   │   │   ├── modules/         # Реестр модулей
│   │   │   ├── cafe/            # API кафе
│   │   │   ├── ps-park/         # API PlayStation Park
│   │   │   ├── gazebos/         # API беседок
│   │   │   ├── parking/         # API парковки
│   │   │   ├── rental/          # API аренды офисов
│   │   │   ├── notifications/   # API уведомлений
│   │   │   ├── monitoring/      # API мониторинга
│   │   │   └── health/          # Health check endpoint
│   │   └── layout.tsx           # Корневой layout
│   ├── lib/                     # Общие утилиты
│   │   ├── db.ts                # Prisma client singleton
│   │   ├── auth.ts              # NextAuth конфигурация
│   │   ├── redis.ts             # Redis client
│   │   ├── api-response.ts      # Стандартизированные API-ответы
│   │   ├── rate-limit.ts        # Rate limiting через Redis
│   │   ├── logger.ts            # Логирование в system_events
│   │   └── permissions.ts       # RBAC хелперы
│   ├── modules/                 # Бизнес-логика доменных модулей
│   │   ├── cafe/
│   │   │   ├── service.ts       # Бизнес-логика
│   │   │   ├── types.ts         # Типы
│   │   │   └── validation.ts    # Zod-схемы валидации
│   │   ├── ps-park/
│   │   ├── gazebos/
│   │   ├── parking/
│   │   ├── rental/
│   │   └── monitoring/
│   ├── components/              # React-компоненты
│   │   ├── ui/                  # Базовые UI-компоненты
│   │   ├── admin/               # Компоненты админки
│   │   └── public/              # Компоненты публичной части
│   └── middleware.ts            # Next.js middleware (auth guard, logging)
├── bot/                         # Telegram-бот (отдельный процесс)
│   ├── index.ts                 # Точка входа бота
│   ├── handlers/                # Обработчики команд
│   └── keyboards/               # Inline-клавиатуры
└── scripts/                     # Утилиты
    ├── seed.ts                  # Начальные данные
    └── health-check.ts          # Внешний health-check скрипт
```

---

## Система ролей (RBAC)

### Роли

| Роль | Описание | Доступ |
|------|----------|--------|
| `SUPERADMIN` | Архитектор/владелец системы | Всё: все модули, настройки, мониторинг, управление пользователями |
| `MANAGER` | Менеджер конкретного модуля | Только свой модуль: заказы, бронирования, настройки модуля |
| `USER` | Клиент B2C | Публичные страницы, бронирование, заказы, личный кабинет |

### Привязка менеджера к модулю

```
User (role: MANAGER) → ModuleAssignment → Module (e.g. "cafe", "gazebos")
```

Менеджер может быть привязан к нескольким модулям. Middleware проверяет: `hasModuleAccess(userId, moduleSlug)`.

### Middleware-цепочка для API

```
Request → Rate Limit → Auth Check → Role Check → Module Access Check → Handler → Logging
```

---

## Схема базы данных (ядро)

```prisma
// === USERS & AUTH ===

model User {
  id            String    @id @default(cuid())
  email         String?   @unique
  phone         String?   @unique
  name          String?
  role          Role      @default(USER)
  telegramId    String?   @unique
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  moduleAssignments ModuleAssignment[]
  bookings          Booking[]
  orders            Order[]
  auditLogs         AuditLog[]
}

enum Role {
  SUPERADMIN
  MANAGER
  USER
}

// === MODULE SYSTEM ===

model Module {
  id          String       @id @default(cuid())
  slug        String       @unique  // "cafe", "ps-park", "gazebos", "rental"
  name        String                // "Кафе", "PlayStation Park"
  description String?
  isActive    Boolean      @default(true)
  config      Json?                 // Гибкие настройки модуля
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  assignments ModuleAssignment[]
}

model ModuleAssignment {
  id        String   @id @default(cuid())
  userId    String
  moduleId  String
  user      User     @relation(fields: [userId], references: [id])
  module    Module   @relation(fields: [moduleId], references: [id])

  @@unique([userId, moduleId])
}

// === BOOKING (общая для беседок, PS Park) ===

model Booking {
  id          String        @id @default(cuid())
  moduleSlug  String                 // "gazebos", "ps-park"
  resourceId  String                 // ID беседки или стола
  userId      String
  user        User          @relation(fields: [userId], references: [id])
  date        DateTime
  startTime   DateTime
  endTime     DateTime
  status      BookingStatus @default(PENDING)
  metadata    Json?                  // Доп. данные (кол-во гостей и т.д.)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

enum BookingStatus {
  PENDING
  CONFIRMED
  CANCELLED
  COMPLETED
}

// === BOOKABLE RESOURCES (беседки, столы PS) ===

model Resource {
  id          String   @id @default(cuid())
  moduleSlug  String            // "gazebos", "ps-park"
  name        String            // "Беседка №1", "Стол PlayStation 3"
  description String?
  capacity    Int?
  pricePerHour Decimal?
  isActive    Boolean  @default(true)
  metadata    Json?             // Фото, характеристики
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// === ORDERS (кафе) ===

model Order {
  id          String      @id @default(cuid())
  moduleSlug  String               // "cafe"
  userId      String
  user        User        @relation(fields: [userId], references: [id])
  status      OrderStatus @default(NEW)
  totalAmount Decimal
  deliveryTo  String?              // Номер офиса для доставки
  items       OrderItem[]
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

enum OrderStatus {
  NEW
  PREPARING
  READY
  DELIVERED
  CANCELLED
}

model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id])
  menuItemId String
  quantity  Int
  price     Decimal
}

model MenuItem {
  id          String   @id @default(cuid())
  moduleSlug  String   @default("cafe")
  category    String            // "Напитки", "Пицца", "Основное"
  name        String
  description String?
  price       Decimal
  imageUrl    String?
  isAvailable Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// === B2B: RENTAL ===

model Tenant {
  id          String   @id @default(cuid())
  companyName String
  contactName String
  email       String?
  phone       String?
  inn         String?           // ИНН компании
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  contracts   RentalContract[]
}

model Office {
  id          String   @id @default(cuid())
  number      String   @unique  // "301", "A-12"
  floor       Int
  area        Decimal           // Площадь в м²
  pricePerMonth Decimal
  status      OfficeStatus @default(AVAILABLE)
  metadata    Json?             // Фото, планировка
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  contracts   RentalContract[]
}

enum OfficeStatus {
  AVAILABLE
  OCCUPIED
  MAINTENANCE
}

model RentalContract {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  officeId    String
  office      Office   @relation(fields: [officeId], references: [id])
  startDate   DateTime
  endDate     DateTime
  monthlyRate Decimal
  deposit     Decimal?
  status      ContractStatus @default(ACTIVE)
  documentUrl String?          // Ссылка на скан договора
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum ContractStatus {
  DRAFT
  ACTIVE
  EXPIRING      // Автоматически ставится за 30 дней до endDate
  EXPIRED
  TERMINATED
}

// === MONITORING ===

model SystemEvent {
  id          String   @id @default(cuid())
  level       EventLevel
  source      String            // "api", "cafe", "health-check", "auth"
  message     String
  metadata    Json?             // Stack trace, request data и т.д.
  createdAt   DateTime @default(now())
}

enum EventLevel {
  INFO
  WARNING
  ERROR
  CRITICAL
}

model AuditLog {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  action      String            // "booking.create", "order.cancel", "module.toggle"
  entity      String            // "Booking", "Order", "Module"
  entityId    String?
  metadata    Json?             // Было/стало
  createdAt   DateTime @default(now())
}
```

---

## Мониторинг — три уровня

### Level 1: Инфраструктура (каждые 30 секунд)
- `GET /api/health` — общий health check (DB connection, Redis ping, disk space)
- Логирование в `SystemEvent` с level `CRITICAL` при недоступности
- Алерт в Telegram-группу при 2+ неудачных пингах подряд

### Level 2: Модули приложения
- `GET /api/{module}/health` — health check каждого модуля
- Автоматический сбор: количество запросов/час, средний response time, последняя ошибка
- Алерт при росте 5xx ошибок выше порога

### Level 3: Бизнес-метрики (агрегация каждый час)
- Бронирования за день (по модулям)
- Выручка за день/неделю
- Арендаторы с истекающими договорами (за 30 дней)
- Алерт при отсутствии бронирований в рабочее время (аномалия)

### Маршрутизация алертов

| Уровень | Канал |
|---------|-------|
| CRITICAL | Telegram + SMS суперадмину |
| ERROR | Telegram-группа админов |
| WARNING | Только дашборд |
| INFO | Лог в БД |

---

## API: стандарты и соглашения

### Формат ответа

```typescript
// Успех
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 42 }  // только для списков
}

// Ошибка
{
  "success": false,
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "Это время уже занято"
  }
}
```

### Именование эндпоинтов

```
GET    /api/{module}              — список ресурсов
GET    /api/{module}/:id          — один ресурс
POST   /api/{module}              — создать
PATCH  /api/{module}/:id          — обновить
DELETE /api/{module}/:id          — удалить (soft delete)

GET    /api/{module}/health       — health check модуля

# Специфичные
POST   /api/gazebos/book          — забронировать беседку
POST   /api/cafe/order            — сделать заказ
GET    /api/rental/expiring       — договоры, истекающие в ближайшие 30 дней
```

### Валидация

Все входные данные валидируются через **Zod**-схемы. Схемы лежат в `src/modules/{module}/validation.ts`.

### Rate Limiting

- Публичные API: 60 запросов/минуту на IP
- Авторизованные: 120 запросов/минуту на пользователя
- Админские: без лимита
- Реализация через Redis (sliding window)

---

## Реальный список модулей (по `src/modules/` на 2026-04-25)

Этот список — **источник правды** о том, что физически есть в коде. Если фичи нет в этом списке — её нет, точка. Если в списке есть что-то, чего нет в дорожной карте ниже, — это **scope creep**, который накопился без обновления документа правды.

| Модуль | Статус в roadmap | Назначение |
|--------|------------------|-----------|
| `auth` | ✅ Phase 0 | NextAuth, magic-link, providers |
| `monitoring` | ✅ Phase 0 | health checks, SystemEvent |
| `notifications` | ✅ Phase 0 | unified channel routing |
| `gazebos` | ✅ Phase 1 | беседки |
| `ps-park` | ✅ Phase 2 | PlayStation Park |
| `cafe` | ✅ Phase 2 | кафе |
| `parking` | ✅ Phase 2 | парковка |
| `booking` | ✅ Phase 1+2 | shared booking core |
| `rental` | ✅ Phase 3 | аренда офисов |
| `clients` | ✅ Phase 3 | CRM арендаторов |
| `analytics` | ✅ Phase 4 | сводные метрики, balance/conversions/campaigns |
| `users` | ✅ Phase 4 | админ-управление пользователями |
| `profile` | ⚠️ только webapp | API контактов USER (`/api/profile/*`) |
| `feedback` | ❌ scope creep | обращения пользователей |
| `inventory` | ❌ scope creep | складской учёт (SKU, receipts, audits, write-offs) |
| `management` | ❌ scope creep | расходы, recurring задачи |
| `telephony` | ❌ scope creep | Novofon SMS/звонки |
| `telegram-link` | ❌ scope creep | привязка Telegram-аккаунта к web-юзеру |
| `pipeline-metrics` | ❌ scope creep | метрики agent-pipeline (eval/) |
| `backups` | ❌ scope creep | бэкапы БД для super-admin |

**Правило при следующем расхождении:** если модуль появляется в коде до того, как попадает в roadmap, — это нарушение процесса. Чинится через PRD от `product-owner` (см. `agents/po.md`) **до** старта реализации.

---

## Дорожная карта

### Phase 0 — Фундамент ✅

- [x] **Step 1**: Scaffold проекта — Next.js 15, Prisma, Docker Compose (PostgreSQL + Redis), .env
- [x] **Step 2**: Схема БД — все модели, seed-скрипт (16 моделей, 7 enum)
- [x] **Step 3**: Auth + RBAC — NextAuth.js v5, роли (SUPERADMIN/MANAGER/USER), middleware guards
- [x] **Step 4**: API layer — стандартизированные ответы (`apiResponse`/`apiError`), rate limiting (Redis), request logging (`AuditLog`)
- [x] **Step 5**: Мониторинг — health endpoints, `SystemEvent`, Telegram alert bot (Grammy)
- [x] **Step 6**: Admin dashboard shell — layout, sidebar, module registry, system status, user management

### Phase 1 — Пилотный B2C модуль: Беседки ✅

- [x] Публичная страница с календарём доступности
- [x] API бронирования (создание, отмена, подтверждение) — 7 endpoints
- [x] Панель менеджера беседок (список броней, управление ресурсами)
- [x] Telegram-бот: бронирование беседки через чат (Grammy + inline keyboards)
- [x] Уведомления (подтверждение, напоминание, алерты менеджеру)

### Phase 2 — Масштабирование B2C ✅

- [x] PlayStation Park (бронирование столов, 7 API endpoints, панель менеджера)
- [x] Кафе (меню CRUD, заказы NEW→PREPARING→READY→DELIVERED, 6 API endpoints, корзина)
- [x] Парковка (информационная страница — места, правила, контакты)
- [x] Единый личный кабинет в **Telegram Mini App** (`/webapp/profile`)
- [ ] **Публичный личный кабинет в вебе (`/profile`) — НЕ СДЕЛАН.** USER заходит через signin, но дальше ему некуда — нет страницы "мои брони / мои заказы / мои контакты" вне Telegram. Закрывается в текущем рефакторинге.
- [x] Обновлённая главная страница с навигацией по всем модулям

### Phase 3 — B2B: Аренда офисов ✅

- [x] Каталог офисов (поэтажный план, цены, статусы по этажам)
- [x] CRM арендаторов (контакты, ИНН, история договоров)
- [x] Управление договорами (жизненный цикл: DRAFT→ACTIVE→EXPIRING→EXPIRED/TERMINATED, авто-статусы)
- [x] Финансы (выручка в реальном времени, ежемесячный отчёт через GET /api/rental/reports)
- [x] Отчётность для бухгалтерии (занятость, выручка, истекающие договоры)

### Phase 4 — Дашборд архитектора ✅

- [x] System Map — интерактивная карта всех модулей со статусами (green/yellow/red)
- [x] Config GUI — включение/выключение модулей, изменение лимитов
- [x] Аналитика — сводные бизнес-метрики по всем модулям
- [x] Логи и аудит — кто, когда, что сделал

### Phase 5.0 — Запуск (17 апреля 2026) 🚀

- [ ] Деплой на production (delovoy-park.ru), smoke-тест всех модулей (#59)
- [ ] Настройка усиленного мониторинга на первую неделю (#60)
- [ ] Telegram-алерты: health check, 5xx, аномалии бронирований
- [ ] Ежедневный утренний отчёт в Telegram (броней, выручка, статус)

### Phase 5.1 — Программа лояльности

Единая карта участника парка "Деловой" — работает во всех бизнесах (PS Park, кафе, беседки, бани, барбекю). За покупки начисляются баллы, баллы тратятся на скидку в любом бизнесе.

- [ ] Схема БД: `LoyaltyAccount`, `LoyaltyTransaction`, уровни Гость → Резидент → VIP (#61)
- [ ] API: начисление/списание баллов, баланс, история, уровни `/api/loyalty/*` (#62)
- [ ] Интеграция во все модули (PS Park, кафе, беседки) — начисление при завершении услуги
- [ ] UI личного кабинета: баланс, уровень, прогресс-бар, история транзакций (#63)
- [ ] Telegram-бот: `/balance`, `/history`, push-уведомления о начислении и повышении уровня (#64)

**Уровни:**
| Уровень | Порог трат | Скидка |
|---------|-----------|--------|
| Гость | 0 ₽ | — |
| Резидент | 5 000 ₽ | 5% |
| VIP | 20 000 ₽ | 10% |

### Phase 5.2 — Резиденты Делового

Каталог бизнесов арендаторов парка. Мы сами создаём профили из CRM-данных, арендатор верифицируется и при желании дополняет. Цель — внутренняя B2B-экосистема со взаимными скидками.

- [ ] Импорт профилей из CRM: `Tenant` → `ResidentProfile`, категоризация, заполнение вручную (#65)
- [ ] Claim-механика: invite-link на email/телефон из договора → OTP верификация → привязка к аккаунту (#66)
- [ ] Защита: одноразовый токен с TTL 7 дней, OTP 10 мин / 3 попытки, один Tenant = один owner
- [ ] Публичная витрина `/residents` — карточки бизнесов, фильтр по категории, поиск (#67)
- [ ] Кабинет резидента: редактирование профиля (лого, описание, спецпредложение) с модерацией (#68)
- [ ] Авто-скрытие при расторжении договора (`TERMINATED` → `SUSPENDED`)
- [ ] Telegram-бот: `/резиденты` с inline-кнопками по категориям

### Phase 5.3 — Дашборд владельца ("Центр управления")

Один экран — полная картина всех бизнесов парка. Не просто цифры, а actionable сигналы: где хорошо, где проблема, где надо действовать.

- [ ] Сервис агрегации метрик по всем модулям `/api/analytics/overview`, Redis-кэш 5 мин (#69)
- [ ] Обзорный дашборд: карточки по каждому бизнесу (аренда, PS Park, кафе, беседки, бани) (#70)
- [ ] Метрики: занятость %, выручка (день/неделя/месяц), средний чек, загрузка, тренды
- [ ] Детальный экран по модулю: графики (Recharts), тепловая карта загрузки, сравнение периодов (#71)
- [ ] Прогноз выручки на конец месяца (линейная экстраполяция)
- [ ] Общий P&L по парку одной строкой
- [ ] Система алертов: нет броней 3+ часа, истекающие договоры, рекорд выручки, 5xx ошибки (#72)
- [ ] Доставка алертов: дашборд + Telegram (CRITICAL сразу, MEDIUM — утренний дайджест)

---

## Правила для разработчиков (и Claude Code)

### Git

- Ветки: `main` (production), `claude/{task}` и `feature/{module}-{feature}` (разработка)
- Коммиты: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- **Автомерж отключён** — ветки `claude/**` и `feature/**` проходят CI (lint + test + build), но НЕ мержатся автоматически
- PR обязателен для мержа в `main` — Claude пушит в ветку, создаёт PR, ждёт одобрения
- Claude Code НЕ должен пушить напрямую в `main`

### Код

- TypeScript strict mode — всегда
- Все API-ответы через хелпер `apiResponse()` / `apiError()`
- Все входные данные через Zod-валидацию
- Бизнес-логика в `src/modules/{module}/service.ts`, не в route handlers
- Route handlers только: парсят запрос → вызывают сервис → возвращают ответ
- Нет `any` — если тип непонятен, создай интерфейс

### Модули

- Каждый новый модуль регистрируется в таблице `Module`
- Каждый модуль должен реализовать health check: `GET /api/{slug}/health`
- Каждый модуль имеет свой `src/modules/{slug}/` с файлами: `service.ts`, `types.ts`, `validation.ts`
- Менеджер модуля назначается через `ModuleAssignment`

### Scope guard (anti-scope-creep)

Правила, которые применяются к Claude Code и всем агентам:

1. **Нельзя создавать новый модуль** (`src/modules/{slug}/`) без PRD от `product-owner` и записи в "Реальный список модулей" в этом файле.
2. **Нельзя расширять scope в обход PO.** Если в процессе реализации обнаруживается необходимость в дополнительной фиче — это новая итерация: stop, открой issue, дождись PO. Не "пока я тут, добавлю ещё".
3. **Каждый PR =≤ одна фича.** Релиз-боты и автоматические fix-PR-ы Claude (типа "fix-warehouse-receipt-bug") должны быть точечными и закрывать **один** баг с одним тестом.
4. **CLAUDE.md синхронизируется в том же PR**, где появляется/удаляется модуль или фича из roadmap. Расхождение этого документа с реальностью — это баг, не норма.
5. **Code Reviewer обязан флагнуть scope creep.** Если PR трогает 5+ модулей или добавляет нерасписанный новый модуль — verdict NEEDS_CHANGES.

### Безопасность

- Никогда не возвращай пароли, токены, внутренние ID в API-ответах для публичных эндпоинтов
- Все мутации логируются в `AuditLog`
- Rate limiting на всех публичных эндпоинтах
- CORS настроен только на разрешённые домены

### Тестирование

- Unit-тесты для бизнес-логики в `src/modules/`
- Integration-тесты для API endpoints
- `npm test` должен проходить перед мержем

**Обязательное правило для Claude Code — тесты вместе с кодом:**
- При написании ЛЮБОГО нового кода — сразу пишешь тесты в том же коммите
- Новая функция в `service.ts` → тест в `__tests__/service.test.ts`
- Новая схема в `validation.ts` → тест в `__tests__/validation.test.ts`
- Новый API route handler → минимум тест на happy path и один error path
- Новый модуль → директория `__tests__/` с покрытием всей бизнес-логики
- Тесты пишутся без реальной БД/Redis — мокируй через `vi.mock('@/lib/db')`
- После любого изменения кода `npm test` должен оставаться зелёным
- Тест-фреймворк: **Vitest** (`npm test` = `vitest run`, конфиг в `vitest.config.ts`)

---

## Переменные окружения

```env
# Database
DATABASE_URL="postgresql://delovoy:password@localhost:5432/delovoy_park"

# Redis
REDIS_URL="redis://localhost:6379"

# NextAuth
NEXTAUTH_SECRET="generate-a-secure-secret"
NEXTAUTH_URL="http://localhost:3000"

# Telegram Bot
TELEGRAM_BOT_TOKEN="your-bot-token"
TELEGRAM_ADMIN_CHAT_ID="your-admin-group-id"

# App
NEXT_PUBLIC_APP_URL="https://delovoy-park.ru"
NODE_ENV="development"
```

---

## Контакты и ресурсы

- **Сайт**: https://delovoy-park.ru/
- **Репозиторий**: github.com/aylisrg/platform-delovoy
- **Локация**: Бизнес-парк "Деловой", Селятино, Московская область

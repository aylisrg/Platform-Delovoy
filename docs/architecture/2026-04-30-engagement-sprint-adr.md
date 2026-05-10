# ADR-0010: Engagement Sprint — публичный профиль, Telegram onboarding, атрибуция бронирований

## Статус

Предложено (2026-04-30)

## Контекст

PRD: `docs/requirements/2026-04-30-engagement-sprint.md`
Аудит вовлечённости: `docs/analytics/2026-04-30-engagement-audit.md`

Первый пост-лонч аудит (14+ дней после запуска) выявил три блокирующих паттерна:

1. 67% броней создаёт администратор — публичный профиль `/profile` не реализован, USER после sign-in оказывается в тупике.
2. 0% USER с привязанным Telegram — `TelegramLinkToken` модель в схеме есть (добавлена ранее), но web→bot флоу привязки не реализован.
3. Поле `source` в `Booking` отсутствует — атрибуция канала (web/bot/admin) невозможна. `cancelReason` в схеме есть, но UI не собирает его при отмене.

Три фичи спринта решают эти проблемы с минимальным scope:
- **F1**: публичная страница `/profile` (модуль `profile` частично существует)
- **F2**: web→bot Telegram-привязка через `TelegramLinkToken`
- **F3**: поле `source` в `Booking` + принудительный `cancelReason` в UI

---

## F1: Публичный профиль USER (`/profile`)

### Варианты

#### Вариант A: Расширить существующий `src/modules/profile/`
Модуль `profile` уже есть (`src/modules/profile/`, `/api/profile/*`) — реализованы API контактов USER. Добавляем страницу `src/app/(public)/profile/page.tsx` и новые API endpoints для бронирований.

- Плюсы: нет нового модуля, нет нарушения scope-guard, переиспользуем существующие сервисы.
- Минусы: модуль `profile` частично overlap с `booking` — нужна аккуратная граница.

#### Вариант B: Создать новый маршрут в `(public)/`
Страница как самостоятельный маршрут без привязки к модулю profile — прямо вызывает `BookingService` и `UserService`.

- Плюсы: изолировано.
- Минусы: дублирует логику, которая уже в `profile`.

### Решение

**Вариант A.** Расширяем `src/modules/profile/` тремя дополнениями: (1) `BookingHistoryService` — агрегирует брони USER (делегирует к booking service), (2) страница `/profile`, (3) новые API endpoints. Страница защищена middleware (только авторизованный USER).

### Схема данных

Изменений в БД не требуется для базового профиля. Все необходимые поля уже есть в `User` и `Booking`.

### API-контракт

```
GET /api/profile
Authorization: session (USER+)
Response: {
  success: true,
  data: {
    id: string,
    name: string | null,
    email: string | null,
    phone: string | null,
    telegramId: string | null,
    telegramUsername: string | null  // из metadata если есть
  }
}

PATCH /api/profile
Authorization: session (USER+)
Body: { name?: string, phone?: string }
Validation (Zod):
  name: z.string().min(2).max(100).optional()
  phone: z.string().regex(/^\+7\d{10}$/).optional()
Response: { success: true, data: { id, name, phone } }

GET /api/profile/bookings
Authorization: session (USER+)
Query: ?page=1&limit=20&status=PENDING|CONFIRMED|CANCELLED|COMPLETED
Response: {
  success: true,
  data: Booking[],
  meta: { page, limit, total }
}

// Отмена бронирования — уже может существовать в /api/gazebos/:id или /api/ps-park/:id
// Если нет — добавляем универсальный endpoint:
PATCH /api/bookings/:id/cancel
Authorization: session (USER+ — только свои брони; MANAGER — любые в своём модуле)
Body: { cancelReason: string, cancelReasonText?: string }
Validation (Zod):
  cancelReason: z.enum(['CHANGED_PLANS','FOUND_OTHER_TIME','BOOKING_ERROR','TOO_EXPENSIVE','OTHER'])
  cancelReasonText: z.string().max(200).optional()
Response: { success: true, data: { id, status: 'CANCELLED', cancelReason } }
```

### Маршруты Next.js

```
src/app/(public)/profile/
  page.tsx           — SSR, проверяет auth, рендерит профиль
  bookings/
    page.tsx         — список бронирований (можно как вкладка главной страницы)
```

### RBAC

- `GET /api/profile` — USER (только свои данные)
- `PATCH /api/profile` — USER (только свои данные; берём `userId` из `session.user.id`, не из body)
- `GET /api/profile/bookings` — USER (фильтр по `userId` обязателен на уровне сервиса)
- `PATCH /api/bookings/:id/cancel` — USER (проверяем `booking.userId === session.user.id`), MANAGER (для своего модуля через `hasModuleAccess`), SUPERADMIN (без ограничений)

### Влияние на существующие модули

- `src/modules/profile/` — расширяется (новые методы в `service.ts`)
- `src/modules/booking/` — `cancelBooking` метод дополняется обязательным `cancelReason`
- `src/app/(public)/profile/` — новый маршрут
- `src/app/api/profile/` — новые handlers (bookings, cancel)
- `src/middleware.ts` — `/profile` добавляется в список защищённых маршрутов для USER

---

## F2: Web→Bot Telegram-привязка

### Контекст схемы

Модель `TelegramLinkToken` уже существует в `prisma/schema.prisma`:

```prisma
model TelegramLinkToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([token])
  @@index([userId])
  @@index([expiresAt])
}
```

Это означает: схема готова. Требуется только реализация API + bot handler.

В ветке `fix/bot-to-web-login-bot-side` уже реализован bot→web флоу (one-time login URL для возвращающихся пользователей). Web→bot флоу использует ту же модель `TelegramLinkToken` в обратном направлении.

### Варианты

#### Вариант A: Переиспользовать `TelegramLinkToken` для web→bot
Та же модель, семантика та же: токен генерируется на веб-стороне, подтверждается ботом.

- Плюсы: нет новых миграций, консистентность схемы.
- Минусы: нужно убедиться, что bot-сторона не путает направления (login vs link).

#### Вариант B: Новая модель `TelegramWebLinkToken`
Отдельная модель для семантической ясности.

- Плюсы: нет coupling между login и link флоу.
- Минусы: дублирование схемы, лишняя миграция.

### Решение

**Вариант A** с добавлением поля `purpose` (или дифференциацией через `token` prefix). Рекомендую добавить поле `purpose` в `TelegramLinkToken`:

```prisma
model TelegramLinkToken {
  id        String                  @id @default(cuid())
  userId    String
  user      User                    @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String                  @unique
  purpose   TelegramLinkTokenPurpose @default(LINK_ACCOUNT)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime                @default(now())

  @@index([token])
  @@index([userId])
  @@index([expiresAt])
}

enum TelegramLinkTokenPurpose {
  LINK_ACCOUNT   // web → bot: привязка Telegram к web-профилю
  BOT_LOGIN      // bot → web: one-time login URL для бота
}
```

Это backward-compatible изменение (дефолт `LINK_ACCOUNT` для новых записей; существующие login-токены не затронуты если purpose дефолтный или уже `usedAt IS NOT NULL`).

### API-контракт

```
POST /api/profile/telegram-link
Authorization: session (USER+)
Rate limit: 3 запроса / 15 минут на userId (Redis)
Body: {} (пустой)
Response: {
  success: true,
  data: {
    deepLink: "https://t.me/DelovoyPark_bot?start=link_<token>",
    expiresAt: ISO8601
  }
}

Логика:
1. Проверяем, не привязан ли уже telegramId
2. Инвалидируем предыдущие неиспользованные LINK_ACCOUNT токены этого userId
3. Генерируем token = "link_" + crypto.randomBytes(32).toString('hex')
4. Сохраняем TelegramLinkToken { userId, token, purpose: LINK_ACCOUNT, expiresAt: now+10min }
5. Возвращаем deepLink

GET /api/profile/telegram-link/status
Authorization: session (USER+)
Response: {
  success: true,
  data: {
    linked: boolean,
    telegramUsername: string | null,
    pendingToken: boolean  // есть ли активный неиспользованный токен
  }
}
```

### Bot handler (Telegram-сторона)

Deep-link `?start=link_<token>` активирует в боте handler `/start link_<token>`:

```
Логика bot-handler:
1. Парсим token из start payload
2. Ищем TelegramLinkToken WHERE token = token AND usedAt IS NULL AND expiresAt > now AND purpose = LINK_ACCOUNT
3. Если не найден → "Ссылка устарела или уже использована. Вернитесь в профиль."
4. Если `User.telegramId` уже занят другим userId → "Этот Telegram уже привязан к другому аккаунту."
5. UPDATE User SET telegramId = ctx.from.id, updatedAt = now WHERE id = token.userId
6. UPDATE TelegramLinkToken SET usedAt = now WHERE id = token.id
7. UPSERT NotificationPreference { userId, channel: 'TELEGRAM' } — если ещё нет
8. AuditLog { userId: token.userId, action: 'profile.telegram_linked', entity: 'User', entityId: token.userId }
9. Ответ боту: "Ваш Telegram успешно привязан к аккаунту в системе бизнес-парка Деловой. Теперь вы будете получать уведомления о бронированиях здесь."
```

### RBAC

- `POST /api/profile/telegram-link` — USER (только для своего userId из session)
- `GET /api/profile/telegram-link/status` — USER
- Rate limit через Redis ключ `telegram_link_rate:<userId>` (sliding window 15 min)

### Влияние на существующие модули

- `prisma/schema.prisma` — добавление `purpose` field и `TelegramLinkTokenPurpose` enum (одна миграция)
- `src/modules/profile/service.ts` — новые методы `generateTelegramLinkToken`, `getTelegramLinkStatus`
- `src/app/api/profile/telegram-link/` — новые route handlers
- `bot/handlers/` — обновление `/start` handler для обработки `link_` prefix
- `src/modules/notifications/` — UPSERT preference при успешной привязке

---

## F3: Поле `source` в `Booking` + принудительный `cancelReason`

### Контекст

- `cancelReason` — поле уже есть в `Booking`, но не собирается UI. Решение: UI-изменение в компонентах отмены.
- `source` — поля нет. Требуется миграция.

### Схема данных

```prisma
enum BookingSource {
  WEB
  BOT
  ADMIN
}

model Booking {
  // ... существующие поля ...
  source       BookingSource @default(WEB)
  // cancelReason уже есть: String?
}
```

### Миграция исторических данных

```sql
-- Шаг 1: добавить enum и поле с дефолтом WEB (Prisma сгенерирует автоматически)
-- Шаг 2: data migration для существующих записей
UPDATE "Booking" b
SET source = 'ADMIN'
WHERE EXISTS (
  SELECT 1 FROM "AuditLog" al
  WHERE al.action = 'booking.admin_create'
    AND al."entityId" = b.id
);
-- Остальные записи остаются WEB (дефолт)
```

Миграция выполняется через `prisma migrate dev --create-only` + ручной SQL-шаг в migration file.

### API-изменения

При создании бронирования (`POST /api/gazebos/book`, `POST /api/ps-park/book`):

```
Веб (route handler): передаёт source: 'WEB' в BookingService.create()
Бот (bot handler): передаёт source: 'BOT' в BookingService.create()
Менеджер/Админ (admin API): передаёт source: 'ADMIN'
```

`BookingService.create()` принимает `source: BookingSource` как обязательный параметр (не из тела запроса пользователя — из контекста вызова).

**Важно:** `source` НЕ принимается из тела HTTP-запроса пользователя. Устанавливается server-side на основе контекста вызова (role + entry point).

### UI: принудительный cancelReason

Компоненты, вызывающие отмену бронирования (страница профиля, панель менеджера), добавляют диалог перед вызовом cancel API:

```typescript
// Zod validation для cancel endpoint
const cancelBookingSchema = z.object({
  cancelReason: z.enum([
    'CHANGED_PLANS',
    'FOUND_OTHER_TIME',
    'BOOKING_ERROR',
    'TOO_EXPENSIVE',
    'OTHER'
  ]),
  cancelReasonText: z.string().max(200).optional(),
})
```

`cancelReason` в `Booking` остаётся `String?` в схеме (не меняем на enum — сохраняем гибкость для будущих причин). Enum-валидация на уровне Zod.

При отмене менеджером через панель — автоматически ставится `'ADMIN_CANCEL'` без диалога.

### Влияние на существующие модули

- `prisma/schema.prisma` — добавление `BookingSource` enum + `source` поле (одна миграция)
- `src/modules/booking/service.ts` — `create()` принимает `source: BookingSource`; `cancel()` требует `cancelReason`
- `src/modules/booking/validation.ts` — новые Zod-схемы
- `src/app/api/gazebos/` — передаёт `source: 'WEB'` при создании
- `src/app/api/ps-park/` — передаёт `source: 'WEB'` при создании
- `bot/handlers/` — передаёт `source: 'BOT'` при создании через бота
- Admin route handlers — передают `source: 'ADMIN'`
- Компоненты отмены в `src/components/` — добавляют диалог выбора причины

---

## Сводная таблица изменений схемы

| Изменение | Тип | Миграция | Backward compatible |
|-----------|-----|----------|-------------------|
| `TelegramLinkToken.purpose` (enum + field) | ADD | Да | Да (default) |
| `TelegramLinkTokenPurpose` enum | ADD | Да | — |
| `BookingSource` enum | ADD | Да | — |
| `Booking.source` field | ADD | Да | Да (default WEB) |

Итого: 2 миграции (или 1 объединённая, если в одном спринте).

---

## Последствия и риски

### Риски

1. **Bot-handler конфликт `link_` vs `login_` prefix**: нужно убедиться, что существующий `/start login_<token>` handler не перехватывает `link_` deep-links. Решение: проверка prefix в начале start-handler.

2. **Polling на статус привязки**: AC-4 профиля требует обновления без перезагрузки. Предлагаем polling `GET /api/profile/telegram-link/status` каждые 3 секунды пока `linked=false` и `pendingToken=true`, с таймаутом 15 минут. WebSocket избыточен для этого use-case.

3. **Данные миграции `source`**: AuditLog не гарантированно содержит `booking.admin_create` для всех исторических записей. Записи без AuditLog-подтверждения получают дефолт `WEB` — возможно небольшое искажение исторических данных. Приемлемо (данные за 16 дней, dev-окружение).

### Не затронуто

- Phase 5.1 (программа лояльности) — не начинается
- Phase 5.2 (резиденты) — не начинается
- Phase 5.3 (дашборд владельца) — не начинается
- Модули `cafe`, `parking`, `rental` — не затрагиваются напрямую
- Новые npm-пакеты — не требуются

---

## Чеклист Developer

- [ ] ADR прочитан и понят
- [ ] Миграция создана через `prisma migrate dev --create-only`
- [ ] Data migration SQL добавлен в migration file
- [ ] `BookingService.create()` принимает `source` как server-side параметр (не из request body)
- [ ] `POST /api/profile/telegram-link` rate-limited через Redis
- [ ] Bot-handler обновлён: `link_` prefix обрабатывается отдельно от `login_` prefix
- [ ] Polling на `/api/profile/telegram-link/status` с таймаутом 15 мин
- [ ] `cancelReason` валидируется через Zod enum в cancel handler
- [ ] Все новые endpoints логируют мутации в `AuditLog`
- [ ] `npm test` зелёный после всех изменений
- [ ] Unit-тесты для `generateTelegramLinkToken`, `cancelBooking` (с проверкой cancelReason), `createBooking` (проверка source)

---

## GitHub Issues (предлагаемые)

| Issue | Модуль | Приоритет |
|-------|--------|-----------|
| feat(profile): публичная страница /profile — история бронирований + контакты | profile, booking | P0 |
| feat(profile): Telegram-привязка — web→bot deep-link флоу | profile, bot, notifications | P0 |
| feat(booking): добавить поле source (WEB/BOT/ADMIN) + миграция | booking | P0 |
| feat(booking): принудительный cancelReason в UI при отмене | booking, profile | P1 |
| feat(profile): статус привязки Telegram — polling endpoint | profile | P1 |

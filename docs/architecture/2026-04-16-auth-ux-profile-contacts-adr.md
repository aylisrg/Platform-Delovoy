# ADR: Бесшовный вход и управление контактами в личном кабинете

**Дата**: 16 апреля 2026  
**Статус**: Принято  
**PRD**: docs/requirements/2026-04-16-auth-ux-profile-contacts-prd.md

---

## Контекст

Клиенты входят через Telegram, Google, Яндекс, VK, WhatsApp OTP или Email magic link. Проблемы:
1. Исторически NextAuth показывал экран «укажите email» для новых пользователей без email (Telegram, WhatsApp). Это закрыто патчем #91 через `pages.newUser = "/auth/redirect"`, но не поддерживает `callbackUrl` — после входа пользователь всегда попадает на `/` вместо исходной страницы.
2. Нет раздела для самостоятельного добавления контактов к существующему аккаунту.
3. NotificationSettings уже есть в ЛК, но не позволяет добавить новые каналы.

---

## Текущее состояние (что уже реализовано)

| Компонент | Статус |
|-----------|--------|
| `pages.newUser = "/auth/redirect"` | ✅ Есть — email-форма не показывается |
| `/auth/redirect` page | ✅ Есть — но не читает `callbackUrl` |
| `User.email`, `User.phone`, `User.telegramId`, `User.vkId` | ✅ Все поля в схеме |
| `NotificationPreference.preferredChannel` | ✅ Есть в схеме |
| `NotificationSettings` компонент в ЛК | ✅ Показывает доступные каналы |
| WhatsApp OTP flow (`/api/auth/whatsapp`) | ✅ Есть (для входа) |
| Email magic link flow (`/api/auth/email/send`) | ✅ Есть (для входа) |
| ЛК (`/dashboard`) | ✅ Есть — брони, заказы, обращения, уведомления |

**Вывод**: Схема БД изменений не требует. Нужны новые API-эндпоинты для привязки контактов и UI в ЛК.

---

## Варианты

### Вариант A: Переиспользовать существующие auth endpoints для привязки контактов

Адаптировать `/api/auth/whatsapp` и `/api/auth/email/send` — добавить режим «привязка к аккаунту» через параметр `mode: "attach"`.

**Плюсы**: Меньше кода  
**Минусы**: Нарушает single-responsibility — auth endpoints начинают делать две разные вещи. Усложняет тестирование. Потенциальные security-риски (привязка чужого контакта).

### Вариант B: Отдельный profile-модуль с новыми endpoints ✅ ВЫБРАН

Создать `src/modules/profile/` и `src/app/api/profile/` — изолированный модуль для управления профилем.

**Плюсы**: Чистое разделение — auth отвечает за вход, profile за управление данными. Легко тестировать. Auth-endpoints не меняются.  
**Минусы**: Небольшое дублирование логики OTP/magic-link.

---

## Решение: Вариант B

### Изменения схемы БД

**Нет изменений в schema.prisma** — все нужные поля уже есть.

### Структура нового модуля

```
src/modules/profile/
├── service.ts          # Бизнес-логика: get/update profile, attach contacts
├── types.ts            # ProfileData, AttachEmailRequest, AttachPhoneRequest
├── validation.ts       # Zod-схемы
└── __tests__/
    ├── service.test.ts
    └── validation.test.ts

src/app/api/profile/
├── route.ts            # GET /api/profile, PATCH /api/profile
└── contacts/
    ├── email/
    │   ├── request/route.ts   # POST /api/profile/contacts/email/request
    │   └── confirm/route.ts   # POST /api/profile/contacts/email/confirm
    └── phone/
        ├── request/route.ts   # POST /api/profile/contacts/phone/request
        └── confirm/route.ts   # POST /api/profile/contacts/phone/confirm
```

### Redis-ключи для верификации контактов

Отдельные ключи, не пересекаются с auth-флоу:
```
profile:email-verify:{userId}   → token (string, TTL 10 мин)
profile:phone-otp:{userId}      → "{normalizedPhone}:{code}" (TTL 5 мин)
profile:phone-cooldown:{userId} → "1" (TTL 60 сек)
```

### API-контракт

#### GET /api/profile
Возвращает профиль текущего пользователя.

```
GET /api/profile
Auth: required (любая роль)

Response 200:
{
  "success": true,
  "data": {
    "id": "cuid",
    "name": "Иван",
    "image": "https://...",
    "contacts": {
      "telegram": "@username",    // null если не привязан
      "email": "user@email.com",  // null если не привязан
      "phone": "+79001234567",    // null если не привязан
      "vk": "vk_id"              // null если не привязан
    }
  }
}
```

#### PATCH /api/profile
Обновляет имя пользователя.

```
PATCH /api/profile
Auth: required
Body: { "name": "Иван Иванов" }  // 2-100 символов

Response 200:
{
  "success": true,
  "data": { "name": "Иван Иванов" }
}

Error 422: { "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

#### POST /api/profile/contacts/email/request
Отправляет письмо с кодом подтверждения для привязки email.

```
POST /api/profile/contacts/email/request
Auth: required
Body: { "email": "new@email.com" }

Response 200: { "success": true, "data": { "sent": true } }
Error 409: { "error": { "code": "EMAIL_IN_USE", "message": "Email уже привязан к другому аккаунту" } }
Error 400: { "error": { "code": "EMAIL_ALREADY_ATTACHED", "message": "Email уже привязан к вашему аккаунту" } }
Error 429: { "error": { "code": "RATE_LIMIT", ... } }
```

#### POST /api/profile/contacts/email/confirm
Подтверждает email по коду/токену из письма.

```
POST /api/profile/contacts/email/confirm
Auth: required
Body: { "token": "hex-token" }

Response 200: { "success": true, "data": { "email": "new@email.com" } }
Error 400: { "error": { "code": "INVALID_TOKEN", "message": "Неверный или истёкший код" } }
Error 409: { "error": { "code": "EMAIL_IN_USE", "message": "Email занят другим аккаунтом" } }
```

#### POST /api/profile/contacts/phone/request
Отправляет OTP в WhatsApp для привязки номера.

```
POST /api/profile/contacts/phone/request
Auth: required
Body: { "phone": "+79001234567" }

Response 200: { "success": true, "data": { "sent": true, "phone": "7900***67" } }
Error 409: { "error": { "code": "PHONE_IN_USE", "message": "Номер уже привязан к другому аккаунту" } }
Error 400: { "error": { "code": "PHONE_ALREADY_ATTACHED", "message": "Номер уже привязан к вашему аккаунту" } }
Error 429: { "error": { "code": "RATE_LIMIT", ... } }
```

#### POST /api/profile/contacts/phone/confirm
Подтверждает телефон по OTP коду.

```
POST /api/profile/contacts/phone/confirm
Auth: required
Body: { "phone": "+79001234567", "code": "123456" }

Response 200: { "success": true, "data": { "phone": "+79001234567" } }
Error 400: { "error": { "code": "INVALID_CODE", "message": "Неверный код" } }
Error 410: { "error": { "code": "CODE_EXPIRED", "message": "Код истёк, запросите новый" } }
```

### Изменения в /auth/redirect

Добавить поддержку `callbackUrl` query-параметра:

```typescript
// Было: window.location.href = "/"
// Стало:
const params = new URLSearchParams(window.location.search);
const callbackUrl = params.get("callbackUrl");
const safe = callbackUrl?.startsWith("/") ? callbackUrl : null;
window.location.href = safe ?? "/";
```

### UI-компонент: Мои контакты

Новый Client Component `src/components/public/profile/contacts-card.tsx`:
- Карточка в `/dashboard` после "Настройки уведомлений"
- Строки: Telegram / Email / Телефон
- Для каждого: значение (если есть) или кнопка «Добавить»
- Inline-форма при нажатии «Добавить» (без отдельной страницы)
- Inline name editor в заголовке ЛК

---

## Последствия

### Что меняется
- Новый модуль `src/modules/profile/` (service, types, validation, tests)
- 5 новых API-эндпоинтов в `src/app/api/profile/`
- Исправление `src/app/auth/redirect/page.tsx` (поддержка callbackUrl)
- Новый React-компонент `src/components/public/profile/contacts-card.tsx`
- Обновление `src/app/(public)/dashboard/page.tsx` (добавить карточки контактов и имени)

### Что не меняется
- `prisma/schema.prisma` — без изменений
- Auth-эндпоинты (`/api/auth/*`) — без изменений
- `NotificationSettings` компонент — без изменений

### Безопасность
- Все profile-endpoints требуют аутентификации (проверка через `auth()`)
- Email и телефон проверяются на уникальность ДО привязки (предотвращение перехвата аккаунта)
- Привязка без верификации невозможна
- Redis-ключи разделены между auth и profile флоу

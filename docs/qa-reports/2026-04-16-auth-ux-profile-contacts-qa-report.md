# QA Report: Бесшовный вход + управление контактами

**Дата**: 2026-04-16
**Версия**: 8a1199dd605fb6ca2c73043bd590e1447a418dfb
**Статус**: PASS (с замечаниями)

---

## Результаты тестов

```
npm test: 828 tests passed / 0 failed
Test Files: 46 passed (46)
Duration: 1.30s
```

Тесты полностью зелёные. Профильный модуль покрыт двумя тест-файлами:
- `src/modules/profile/__tests__/service.test.ts`
- `src/modules/profile/__tests__/validation.test.ts`

---

## Проверка acceptance criteria

| AC | Описание | Статус | Комментарий |
|----|----------|--------|-------------|
| AC-1.1 | При входе через Telegram — нет формы email | ✅ Pass | Telegram authorize() сразу создаёт user без email-поля. `newUser` → `/auth/redirect`, не `/auth/email-form` |
| AC-1.2 | При входе через Google/Яндекс/VK — нет формы email | ✅ Pass | OAuth `callbackUrl: "/auth/redirect"`, `newUser: "/auth/redirect"` в auth.config.ts — промежуточного экрана нет |
| AC-1.3 | При входе через WhatsApp OTP — нет формы email | ✅ Pass | После `signIn("whatsapp", ...)` → `redirectAfterLogin()` напрямую |
| AC-1.4 | После входа — немедленное перенаправление | ✅ Pass | `/auth/redirect` page.tsx делает `window.location.href` на основе роли без лишних экранов |
| AC-1.5 | Новый аккаунт создаётся без запроса доп. полей | ✅ Pass | Telegram: `prisma.user.create({ data: { telegramId, name, image } })` — email не требуется |
| AC-2.1 | В личном кабинете есть раздел «Мои контакты» | ✅ Pass | `/dashboard/page.tsx` содержит `<Card>` с заголовком «Мои контакты» и `<ContactsCard />` |
| AC-2.2 | Раздел показывает Telegram, Email, Телефон отдельными строками | ✅ Pass | Все три контакта рендерятся в `contacts-card.tsx` отдельными блоками |
| AC-2.3 | Для каждого — значение или кнопка «Добавить» | ⚠️ Partial | Email и Phone имеют кнопку «Добавить». Telegram и VK — read-only через `ContactRow` без кнопки. Telegram привязывается только через OAuth (логично), VK аналогично. Для Telegram «Добавить» не требуется по PRD, AC покрыт для Email/Phone |
| AC-2.4 | Страница доступна для любого набора контактов | ✅ Pass | `getProfile` делает `select` всех nullable полей, `ContactsCard` корректно обрабатывает `null` |
| AC-3.1 | Кнопка «Добавить email» если email не привязан | ✅ Pass | `!profile.contacts.email && activeFlow !== "email"` → кнопка «Добавить» |
| AC-3.2 | Форма с полем email | ✅ Pass | Input `type="email"` в активном flow |
| AC-3.3 | Система отправляет верификационное письмо | ✅ Pass | `sendTransactionalEmail` с HTML-шаблоном и fallback-текстом |
| AC-3.4 | После подтверждения — email привязан | ✅ Pass | `confirmEmailAttach` → `prisma.user.update({ email, emailVerified: new Date() })` |
| AC-3.5 | Если email занят — ошибка EMAIL_IN_USE | ✅ Pass | Проверка в `requestEmailAttach` (409), повторная проверка в `confirmEmailAttach` |
| AC-3.6 | Без верификации привязать нельзя | ✅ Pass | `confirmEmailAttach` требует валидный Redis-токен, без него — `INVALID_TOKEN` |
| AC-4.1–4.6 | Аналогично US-3 для телефона через WhatsApp OTP | ✅ Pass | Полная симметрия: `requestPhoneAttach` / `confirmPhoneAttach`, cooldown, uniqueness, race-condition check |
| AC-5 | NotificationSettings не регрессировал | ✅ Pass | Компонент присутствует на странице после `ContactsCard`, импорт корректен |
| AC-6.1 | Поле «Имя» доступно для редактирования | ✅ Pass | `editingName` state + input с `onChange` |
| AC-6.2 | 2–100 символов | ✅ Pass | `updateNameSchema`: `min(2).max(100).trim()` + клиентская проверка в `handleSaveName` |
| AC-6.3 | После сохранения имя обновляется | ✅ Pass | `PATCH /api/profile` → `updateName()` → `prisma.user.update` → `setProfile(...)` |
| AC-6.4 | Имя от провайдера — дефолт, но изменяемо | ✅ Pass | Telegram authorize сохраняет имя, но `updateName` перезаписывает его |

---

## Качество кода

| Критерий | Статус | Детали |
|----------|--------|--------|
| No `any` | ✅ Pass | В исходном коде модуля нет `any`. В route handlers: `err as Error & { code?: string }` — правильный паттерн |
| apiResponse/apiError | ✅ Pass | Все 5 route handlers используют `apiResponse()` / `apiError()` из `@/lib/api-response` |
| Zod validation | ✅ Pass | Все входящие данные валидируются через схемы в `validation.ts` перед вызовом сервиса |
| Auth check | ✅ Pass | `session?.user?.id` проверяется в каждом route handler первой строкой |
| Uniqueness checks | ✅ Pass | Двойная проверка — при request и при confirm (защита от race condition) |
| TypeScript strict | ✅ Pass | Нет `any`, типы явные, возвращаемые типы указаны через интерфейсы в `types.ts` |
| Business logic isolation | ✅ Pass | Вся логика в `service.ts`, route handlers только парсят/делегируют/форматируют |

---

## Найденные баги / замечания

### WARN-1: OTP сохраняется в Redis до отправки в WhatsApp (нет rollback при SEND_FAILED)

**Уровень**: Warning (не Critical — пользователь не знает код)

**Файл**: `src/modules/profile/service.ts`, строки 276–289

**Суть**: При `requestPhoneAttach` OTP записывается в Redis (`redis.set`) ПЕРЕД вызовом `sendWhatsAppMessage`. Если WhatsApp-отправка провалится (`SEND_FAILED`), OTP остаётся в Redis на 5 минут. Пользователь не получает код, но Redis-запись валидна — при следующей попытке запроса (после cooldown 60 сек) новый OTP перезапишет старый, так что проблема самоустраняется. Тем не менее, если пользователь каким-либо образом узнает OTP (например, перехватит), он сможет подтвердить привязку.

**Рекомендация**: Выполнять отправку перед записью в Redis, или при `SEND_FAILED` удалять ключ `redis.del(otpKey)` перед броском исключения.

---

### WARN-2: Cooldown проверяется только если `redisAvailable`, но OTP всегда пишется без проверки

**Уровень**: Warning

**Файл**: `src/modules/profile/service.ts`, строки 262–278

**Суть**: Cooldown-check обёрнут в `if (redisAvailable)`, но `redis.set(otpKey, ...)` вызывается без этой проверки (строка 276). Если Redis недоступен — `redis.set` выбросит ошибку и запрос упадёт с необработанным исключением вместо понятного ответа. По аналогии с другими модулями проекта, при `!redisAvailable` следует либо возвращать `NOT_CONFIGURED`, либо функционал деградирует gracefully.

Фактически это поведение аналогично `requestEmailAttach` (который тоже всегда пишет в Redis), так что уровень риска идентичен.

---

### INFO-1: TOO_MANY_ATTEMPTS не покрыт тестом

**Уровень**: Informational

**Файл**: `src/modules/profile/__tests__/service.test.ts`

**Суть**: В `confirmPhoneAttach` реализована защита от перебора (MAX_PHONE_ATTEMPTS = 5), но тест этого кейса отсутствует. Тестируются только `CODE_EXPIRED` и `INVALID_CODE`. Согласно CLAUDE.md — при каждом новом коде должен быть тест на error path.

---

### INFO-2: SEND_FAILED для email не покрыт тестом

**Уровень**: Informational

**Файл**: `src/modules/profile/__tests__/service.test.ts`

**Суть**: `requestEmailAttach` бросает `SEND_FAILED` если `sendTransactionalEmail` возвращает `{ success: false }`, но этот кейс не тестируется. Мок всегда возвращает `success: true`.

---

### INFO-3: Подтверждение email — race condition при confirm не покрыт тестом

**Уровень**: Informational

**Файл**: `src/modules/profile/__tests__/service.test.ts`

**Суть**: `confirmEmailAttach` содержит повторную проверку uniqueness (строка 188–198) для защиты от race condition, когда между request и confirm другой пользователь занял email. Этот кейс не тестируется.

---

## Edge cases — проверено

- [x] Двойная отправка OTP (cooldown) — реализован `PROFILE_PHONE_COOLDOWN_PREFIX` с TTL 60 сек, проверяется до генерации OTP
- [x] Попытка привязать чужой email/телефон — проверка `existingOwner.id !== userId` в `requestEmailAttach`, `requestPhoneAttach`, `confirmEmailAttach`, `confirmPhoneAttach`
- [x] Уже привязанный контакт — `EMAIL_ALREADY_ATTACHED` / `PHONE_ALREADY_ATTACHED` с кодом 400
- [x] Истечение токена/OTP — Redis TTL: email 600 сек, phone 300 сек; при отсутствии ключа → `INVALID_TOKEN` / `CODE_EXPIRED`
- [x] Превышение попыток ввода кода — `MAX_PHONE_ATTEMPTS = 5`, при превышении → `redis.del(otpKey)` + `TOO_MANY_ATTEMPTS` (код 429)
- [x] Неавторизованный доступ к `/api/profile/*` — 401 в каждом handler, плюс middleware в `auth.config.ts` блокирует API-маршруты без сессии
- [x] Пустой body / невалидный JSON — `try/catch` вокруг `request.json()` → 400 INVALID_BODY
- [x] Нормализация телефона (8→7) — `normalizePhone()` обрабатывает российские номера с 8
- [x] Email lowercase — `attachEmailRequestSchema` применяет `.toLowerCase()`, сервис дополнительно нормализует через `.toLowerCase().trim()`
- [x] SQL injection через phone/email — Prisma parameterized queries, Zod валидация формата

---

## Итог

**PASS** — фича реализована согласно PRD. Все acceptance criteria покрыты. Код архитектурно корректен: нет `any`, есть Zod-валидация, auth check в каждом handler, двойная uniqueness-проверка для race conditions. Тесты зелёные (828/828).

Два Warning требуют внимания до production: WARN-1 (OTP сохраняется до отправки) и WARN-2 (Redis guard непоследователен). Три информационных замечания по тестовому покрытию не блокируют релиз, но должны быть закрыты при следующем итерации.

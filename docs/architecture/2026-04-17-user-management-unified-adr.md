# ADR: Unified User Management

## Статус
Предложено

## Контекст

### Текущее состояние

Платформа "Деловой" имеет три отдельных раздела в админке для управления людьми:

1. **Пользователи** (`/admin/users`) -- таблица всех пользователей (все роли), компонент `UsersList`. API: `GET/POST /api/users`, `PATCH/DELETE /api/users/:id`. Функции: изменение роли, сброс пароля, управление правами (`PermissionsModal`), toggle release-уведомлений, удаление пользователя. Без пагинации -- все пользователи грузятся одним запросом.

2. **Клиенты** (`/admin/clients`) -- таблица пользователей с ролью USER, обогащенная данными активности. API: `GET /api/admin/clients` (с пагинацией, фильтрами, сортировкой), `GET /api/admin/clients/stats`, `GET /api/admin/clients/:id` (детальный профиль). Компонент `ClientsPageContent` с пагинацией по 25 записей. Детальная страница `/admin/clients/:id` -- `ClientProfile` с timeline, бронированиями, заказами, тратами по месяцам. Здесь же спрятана кнопка "Объединить" и `MergeDialog`.

3. **Telegram** (`/admin/telegram`) -- `NotificationFlowMap` (карта уведомлений) и `TelegramSettings` (Chat ID, токен бота, список пользователей с Telegram). API: `GET/POST /api/admin/telegram`, `GET /api/admin/telegram/users`, `POST /api/admin/telegram/test`, `POST /api/admin/telegram/test-owner`.

Все три раздела зарегистрированы в сайдбаре (`sidebar.tsx`, массив `ALL_NAVIGATION`) и в реестре прав (`permissions.ts`, массив `ADMIN_SECTIONS`).

### Страница входа

Файл `src/app/auth/signin/page.tsx` ��одержит:
- Telegram Login Widget с `data-request-access=write` (строка 38)
- Кнопку Google (строки 268-275) -- провайдер не работает в prod
- Кнопку Yandex (строки 277-284) -- работает
- Кнопку VK (строки 286-293) -- провайдер не работает в prod
- WhatsApp и Email -- спрятаны как мелкие ссылки внизу (строки 297-309)

В `auth.ts` зарегистрированы провайдеры: credentials, telegram, whatsapp, magic-link, Google, Yandex, VK.

### Личный кабинет

Файл `src/app/(public)/dashboard/page.tsx` содержит компоненты:
- Бронирования, заказы, обращения
- `ContactsCard` -- блок "Мои контакты"
- `NotificationSettings` -- настройки уведомлений

Компонент `ContactsCard` (`src/components/public/profile/contacts-card.tsx`):
- Показывает Telegram (только отображение, без кнопки отвязки/привязки)
- Показывает VK (только отображение)
- Email -- с флоу привязки через verification token
- Телефон (WhatsApp) -- с флоу привязки через OTP
- Нет отображения Яндекс-аккаунта
- Нет кнопки "Отвязать" ни для одного канала

Сервис `src/modules/profile/service.ts` -- `getProfile()` возвращает `contacts: { telegram, email, phone, vk }`. Нет данных об Account (Yandex/Google). Тип `ProfileContacts` в `types.ts` не включает `yandex`.

### Схема данных

- `User`: поля `telegramId`, `vkId`, `email`, `phone` -- прямые контакты
- `Account`: таблица NextAuth, поле `provider` = "yandex" | "google" | "vk" -- OAuth-связи
- `TelegramLinkToken`: токены для привязки Telegram через бота (TTL, usedAt)
- `NotificationPreference`: `preferredChannel` enum включает VK
- `NotificationChannel` enum: AUTO, TELEGRAM, WHATSAPP, EMAIL, VK

## Варианты

### Вариант A: Инкрементальный рефакторинг UI без изменения API

Переиспользуем оба существующих API (`/api/users` и `/api/admin/clients`) как есть. На фронте создаем новый компонент-оболочку `UnifiedUsersPage` с вкладками, который внутри рендерит существующие `UsersList` и `ClientsPageContent`. Merge-кнопку добавляем прямо в таблицу клиентов. Новых API-эндпоинтов не создаем.

- Плюсы: минимальный объем изменений, нет новых API-контрактов, быстрая реализация
- Минусы: два раздельных API с разной структурой данных под одним UI -- непоследовательно; нет единого поиска по всем вкладкам; `UsersList` не имеет пагинации (проблема при 500+ пользователях)

### Вариант B: Единый компонент с композицией существующих API + новый endpoint для отвязки

Объединяем UI под одним компонентом с вкладками. Для вкладки "Все" создаем легковесный API-прокси или используем `/api/admin/clients` с расширением (параметр `includeTeam=true`). Добавляем один новый endpoint для отвязки каналов (`DELETE /api/profile/contacts/:channel`). Для привязки Yandex используем существующий OAuth-флоу NextAuth.

- Плюсы: единый поиск, пагинация на всех вкладках, чистая архитектура; минимальные изменения бэкенда; максимальное переиспользование кода
- Минусы: небольшое расширение API клиентов; нужно аккуратно поддержать backward compatibility

## Решение

Выбран **Вариант B** -- единый компонент с композицией API + новый endpoint для отвязки.

Обоснование:
1. Вариант A создает хрупкий UI, собирающий данные из двух несовместимых источников. При 500+ пользователях отсутствие пагинации в `/api/users` станет узким местом.
2. Вариант B позволяет использовать пагинированный `/api/admin/clients` как основу для вкладки "Все" (убрав фильтр `role: USER`), а для вкладки "Команда" -- существующий `/api/users` с добавлением пагинации.
3. Один новы�� endpoint (`DELETE /api/profile/contacts/:channel`) -- единственное добавление к бэкенду для всех четырех US.

## Последствия

### Изменения в схеме БД

**Нет изменений в Prisma-схеме.** Все необходимые модели уже существуют:
- `User` с полями `telegramId`, `vkId`, `email`, `phone`
- `Account` с полем `provider` для OAuth-связей
- `TelegramLinkToken` для привязки Telegram
- `NotificationPreference` и `NotificationChannel`

Поле `vkId` в модели `User` и значение `VK` в enum `NotificationChannel` **не удаляются в этой итерации**. Удаление enum-значения требует миграции данных и не блокирует ни одну US. Это запланировано на следующий релиз (сначала add/hide, потом remove).

### Миграция данных

Миграция не требуется. Перед деплоем необходимо выполнить проверку:

```sql
SELECT COUNT(*) FROM "Account" WHERE provider IN ('google', 'vk');
SELECT COUNT(*) FROM "User" WHERE "vkId" IS NOT NULL;
```

Если результат > 0 -- уведомить затронутых пользователей перед удалением кнопок входа (AC PO п.3).

### Новые API endpoints

Один новый endpoint:

```
DELETE /api/profile/contacts/:channel
```

### Изменения существующих API

1. `GET /api/users` -- добавить параметры `limit` и `offset` для пагинации
2. `GET /api/profile` -- расширить ответ полем `yandex` (из таблицы `Account`)
3. `GET /api/notifications/preferences` -- убрать VK из `availableChannels`

### Влияние на существующие модули

| Модуль | Изменение |
|--------|-----------|
| `src/modules/profile/` | Добавить `detachChannel()` в service.ts, расширить `getProfile()`, добавить `yandex` в types.ts |
| `src/modules/users/` | Добавить пагинацию в `listUsers()` |
| `src/modules/clients/` | Без изменений |
| `src/lib/permissions.ts` | Удалить секции `clients` и `telegram` из `ADMIN_SECTIONS` |
| `src/lib/auth.ts` | Без изменений кода (провайдеры Google/VK остаются для обратной совместимости) |

---

## Implementation Plan

### Порядок реализации

1. **US-3** (страница входа) -- Must Have, zero-dependency, самый быстрый фикс
2. **US-4** (профиль ЛК) -- новый API endpoint, независим от US-1
3. **US-1** (единый реестр) -- основной рефакторинг UI админки
4. **US-2** (merge из реестра) -- зависит от US-1

---

### US-3: Чистая страница входа

#### Шаг 3.1: Удалить кнопки Google и VK со страницы входа

**Файл**: `src/app/auth/signin/page.tsx`

Действия:
- Удалить блок кнопки Google (строки 268-275)
- Удалить блок кнопки VK (строки 286-293)
- Удалить компоненты `GoogleIcon` и `VKIcon`
- Удалить функцию `handleOAuthLogin` для "google" и "vk" (оставить для "yandex")

#### Шаг 3.2: Переставить порядок кнопок входа

**Файл**: `src/app/auth/signin/page.tsx`

Новый порядок блока `view === "main"`:
1. Telegram Login Widget (уже первый) -- без изменений
2. Разделитель "или"
3. Яндекс -- полноразмерная кнопка OAuth (уже есть, оставить)
4. WhatsApp -- полноразмерная кнопка (сейчас мелкая ссылка внизу -- вынести на уровень Яндекса)
5. Email -- полноразмерная кнопка (сейчас мелкая ссылка -- вынести)

Конкретно:
- Убрать секцию "Secondary links" (строки 297-309)
- Добавить WhatsApp как кнопку того же размера, что и Яндекс, с иконкой `WhatsAppIcon` и текстом "Войти через WhatsApp"
- Добавить Email как кнопку с иконкой `MailIcon` и текстом "Войти по email"

#### Шаг 3.3: Убрать data-request-access=write у Telegram-виджета

**Файл**: `src/app/auth/signin/page.tsx`

Действие: удалить строку `script.setAttribute("data-request-access", "write");` (строка 38).

#### Шаг 3.4: Убедиться в заглушке при отсутствии TELEGRAM_BOT_NAME

**Файл**: `src/app/auth/signin/page.tsx`

Текущий код уже обрабатывает `!botName` (строки 47-53), но текст "скоро будет доступен" не соответствует AC-3.5. Заменить на: "Telegram-вход временно недоступен".

---

### US-4: Полный профиль с управлением привязанными аккаунтами

#### Шаг 4.1: Расширить profile service -- добавить поле yandex

**Файл**: `src/modules/profile/types.ts`

Добавить поле `yandex` в `ProfileContacts`:
```typescript
export interface ProfileContacts {
  telegram: string | null;
  yandex: { email: string; name: string | null } | null; // NEW
  email: string | null;
  phone: string | null;
  vk: string | null; // deprecated, будет удалено в следующей итерации
}
```

**Файл**: `src/modules/profile/service.ts`

В функции `getProfile()`:
- Добавить в `select` запрос к `accounts: { where: { provider: "yandex" }, select: { providerAccountId: true } }`
- Заполнить `contacts.yandex` на основе найденного Account

Запрос с join:
```typescript
const user = await prisma.user.findUniqueOrThrow({
  where: { id: userId },
  select: {
    id: true,
    name: true,
    image: true,
    email: true,
    phone: true,
    telegramId: true,
    vkId: true,
    accounts: {
      where: { provider: "yandex" },
      select: { providerAccountId: true },
      take: 1,
    },
  },
});
```

Маппинг:
```typescript
contacts: {
  telegram: user.telegramId,
  yandex: user.accounts.length > 0
    ? { email: user.email ?? "yandex", name: user.name }
    : null,
  email: user.email,
  phone: user.phone,
  vk: user.vkId,
}
```

Примечание: Яндекс-аккаунт связан через таблицу `Account` (provider = "yandex"). Если `Account` найден -- пользователь привязал Яндекс. Дополнительно можно хранить Yandex login в Account metadata, но для MVP достаточно факта наличия записи.

#### Шаг 4.2: Добавить endpoint отвязки каналов

**Новый файл**: `src/app/api/profile/contacts/[channel]/detach/route.ts`

**RBAC**: Доступен любому авторизованному пользователю (USER, MANAGER, SUPERADMIN) -- пользователь управляет своим профилем.

**Rate limiting**: 10 запросов/минуту на пользователя (sliding window, Redis).

**Поддерживаемые каналы**: `telegram`, `email`, `phone`, `yandex`

**API-контракт**:

```
DELETE /api/profile/contacts/{channel}/detach

Headers: Cookie (NextAuth session)

Response (success):
{
  "success": true,
  "data": { "detached": "telegram" }
}

Response (error - last channel):
{
  "success": false,
  "error": {
    "code": "LAST_AUTH_METHOD",
    "message": "Это единственный способ входа. Привяжите другой канал перед отвязкой."
  }
}

Response (error - not attached):
{
  "success": false,
  "error": {
    "code": "NOT_ATTACHED",
    "message": "Этот канал не привязан к вашему аккаунту"
  }
}
```

**Бизнес-логика** (новая функция в `src/modules/profile/service.ts`):

```typescript
export async function detachChannel(
  userId: string,
  channel: "telegram" | "email" | "phone" | "yandex"
): Promise<{ detached: string }>
```

Алгоритм:
1. Загрузить пользователя с полями `telegramId`, `email`, `phone`, `vkId` и связанные `Account` записи.
2. Подсчитать количество активных каналов аутентификации:
   - `telegramId` не null = +1
   - `email` не null = +1
   - `phone` не null = +1
   - Account с provider "yandex" = +1
   - Account с provider "google" = +1
   - `passwordHash` не null = +1 (можно войти по email+пароль)
3. Если количество <= 1 -- вернуть ошибку `LAST_AUTH_METHOD`.
4. Если канал не привязан -- вернуть ошибку `NOT_ATTACHED`.
5. Выполнить отвязку:
   - `telegram`: `UPDATE User SET telegramId = NULL`
   - `email`: `UPDATE User SET email = NULL, emailVerified = NULL`
   - `phone`: `UPDATE User SET phone = NULL`
   - `yandex`: `DELETE FROM Account WHERE userId = X AND provider = 'yandex'`
6. Записать в `AuditLog`: action = "profile.detach", entity = "User", entityId = userId, metadata = { channel }.

**Zod-схема** (добавить в `src/modules/profile/validation.ts`):

```typescript
export const detachChannelSchema = z.object({
  channel: z.enum(["telegram", "email", "phone", "yandex"]),
});
```

**Валидируемые поля и формат ошибок**:
- `channel` (path param): enum ["telegram", "email", "phone", "yandex"]. Ошибка 400: `{ code: "VALIDATION_ERROR", message: "Неподдерживаемый канал" }`
- Ошибка 400: `{ code: "LAST_AUTH_METHOD", message: "..." }`
- Ошибка 400: `{ code: "NOT_ATTACHED", message: "..." }`

#### Шаг 4.3: Обновить ContactsCard -- добавить Яндекс, отвязку, убрать VK

**Файл**: `src/components/public/profile/contacts-card.tsx`

Изменения:
1. **Убрать VK-строку полностью** -- удалить `<ContactRow label="VK" ... />` (AC-4.2)
2. **Добавить строку Яндекс** между Telegram и Email:
   - Если `contacts.yandex` != null: показать "Яндекс" с email, статус "Подключен"
   - Если null: кнопка "Привязать Яндекс" -- запускает OAuth-флоу через `signIn("yandex", { callbackUrl: "/dashboard" })`
3. **Добавить кнопку "Отвязать"** для каждого подключенного канала (Telegram, Яндекс, email, телефон):
   - При клике: модальное подтверждение "Вы уверены? Вы не сможете войти через этот канал"
   - После подтверждения: `DELETE /api/profile/contacts/{channel}/detach`
   - При ошибке LAST_AUTH_METHOD: показать сообщение из ответа
   - После успеха: обновить профиль (`fetchProfile()`)
4. **Привязка Telegram** -- если не привязан, показать кнопку "Привязать Telegram":
   - При клике: вызов `POST /api/profile/telegram/generate-link` (уже существует)
   - Показать QR-код и deep-link `t.me/BotName?start=link_TOKEN`
   - Текущий `TelegramLinkToken` уже имеет TTL 15 минут (AC-4.5)

**Обновить интерфейс** `Contacts`:
```typescript
interface Contacts {
  telegram: string | null;
  yandex: { email: string; name: string | null } | null;
  email: string | null;
  phone: string | null;
}
```

#### Шаг 4.4: Обновить NotificationSettings -- убрать VK, фильтровать каналы

**Файл**: `src/components/public/notifications/notification-settings.tsx`

Изменения:
- Убрать `VK: "VK Мессенджер"` из `channelLabels`
- Выпадающий список "Предпочтительный канал" показывает только `AUTO` + каналы из `availableChannels` (уже реализовано через API)

**Файл**: `src/app/api/notifications/preferences/route.ts`

Изменения в GET:
- Убрать строку `if (user?.vkId) availableChannels.push("VK");` (строка 39)

---

### US-1: Единый реестр пользователей в админке

#### Шаг 1.1: Обновить ADMIN_SECTIONS -- убрать clients и telegram

**Файл**: `src/lib/permissions.ts`

Удалить из массива `ADMIN_SECTIONS`:
```
{ slug: "clients", label: "Клиенты", icon: "👤" },
{ slug: "telegram", label: "Telegram", icon: "📨" },
```

Важно: при удалении секций из реестра, записи `AdminPermission` с `section = "clients"` или `section = "telegram"` станут "мертвыми" (не будут влиять на доступ). Это безопасно -- они не нарушают логику, просто перестают отображаться в UI прав.

#### Шаг 1.2: Обновить сайдбар -- убрать "Клиенты" и "Telegram"

**Файл**: `src/components/admin/sidebar.tsx`

Удалить из массива `ALL_NAVIGATION`:
```
{ label: "Клиенты", href: "/admin/clients", icon: "👤", section: "clients" },
{ label: "Telegram", href: "/admin/telegram", icon: "📨", section: "telegram" },
```

#### Шаг 1.3: Добавить пагинацию в API /api/users

**Файл**: `src/modules/users/service.ts`

В функцию `listUsers()` добавить параметры `limit` (default 50) и `offset` (default 0). Возвращать `{ users, total }`.

**Файл**: `src/modules/users/validation.ts`

Добавить:
```typescript
export const listUsersSchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
```

**Файл**: `src/app/api/users/route.ts`

Обновить GET-handler: парсить `limit` и `offset` из searchParams через `listUsersSchema`, передать в `listUsers()`. Ответ: `apiResponse(users, { total })`.

#### Шаг 1.4: Создать компонент UnifiedUsersPage с вкладками

**Новый файл**: `src/components/admin/users/unified-users-page.tsx`

Компонент с тремя вкладками:
- **"Все"** -- полный реестр (все роли). Данные из `/api/admin/clients` с расширенным фильтром (убрать ограничение `role: USER`). Или -- простая комбинация: показывать всех из `/api/users` с базовой информацией.
- **"Команда"** (SUPERADMIN + MANAGER) -- данные из `/api/users` с пагинацией. Рендерит обновленный `UsersList`. Колонки: имя, контакты, привязанные аккаунты (значки), роль, регистрация, действия (роль, права, пароль, удаление).
- **"Клиенты"** (USER с активностью) -- данные из `/api/admin/clients`. Рендерит обновленный `ClientsPageContent`. Колонки: имя, контакты, модули, траты, активность, регистрация.

URL-параметр `?tab=team|clients|all` для deep linking. По умолчанию -- "Все".

Поиск -- единый input вверху, работает по текущей вкладке. Для "Команда" -- `/api/users?search=...`. Для "Клиенты" -- `/api/admin/clients?search=...`.

Для вкладки "Все": самый простой подход -- показывать данные из `/api/users` (все роли), добавив в ответ API поле `authProviders` (список провайдеров из Account). Это дает единый поиск по имени, email, телефону.

#### Шаг 1.5: Обновить UsersList -- добавить значки аккаунтов и пагинацию

**Файл**: `src/components/admin/users/users-list.tsx`

Изменения:
- Добавить пагинацию (limit/offset), аналогично `ClientsPageContent`
- В колонке "Вход через" показывать значки всех привязанных аккаунтов (Telegram, Yandex, Email, WhatsApp), а не только один
- Для этого потребуется расширить ответ `/api/users` -- добавить поле `authProviders: string[]`

**Файл**: `src/modules/users/service.ts`

В `listUsers()` добавить:
```typescript
include: {
  accounts: { select: { provider: true } },
}
```

Маппинг `authProviders` аналогично `src/modules/clients/service.ts` функция `getAuthProviders()`.

#### Шаг 1.6: Добавить кнопку "Объединить" в карточку пользователя (вкладка "Клиенты")

Подробнее в US-2.

#### Шаг 1.7: Обновить страницу /admin/users

**Файл**: `src/app/admin/users/page.tsx`

Заменить рендер `UsersList` на `UnifiedUsersPage`.

#### Шаг 1.8: Добавить редиректы со старых URL

**Новый файл**: `src/app/admin/clients/page.tsx` (перезаписать)

```typescript
import { redirect } from "next/navigation";
export default function ClientsRedirect() {
  redirect("/admin/users?tab=clients");
}
```

**Файл**: `src/app/admin/clients/[id]/page.tsx`

Оставить как есть -- детальная страница клиента продолжает работать. Обновить back-link с "Все клиенты" на `/admin/users?tab=clients`.

**Файл**: `src/app/admin/telegram/page.tsx` (перезаписать)

```typescript
import { redirect } from "next/navigation";
export default function TelegramRedirect() {
  redirect("/admin/monitoring?tab=system");
}
```

#### Шаг 1.9: Перенести Telegram-настройки в Мониторинг

**Файл**: `src/app/admin/monitoring/page.tsx`

Добавить вкладку "Система" или отдельную секцию внизу страницы, включающую:
- `NotificationFlowMap` (карта уведомлений)
- `TelegramSettings` (настройки бота)

Компоненты уже существуют (`src/components/admin/telegram/telegram-settings.tsx`, `src/components/admin/notifications/NotificationFlowMap.tsx`) -- просто перенести импорт.

API-эндпоинты `/api/admin/telegram/*` остаются без изменений.

#### Шаг 1.10: AuditLog для изменений ролей

Существующий `PATCH /api/users/:id` уже обрабатывает изменение роли. Нужно убедиться, что каждое изменение роли логируется в `AuditLog`. Если не логируется -- добавить в сервис `updateUser()`:

```typescript
await prisma.auditLog.create({
  data: {
    userId: performedByUserId,
    action: "user.role.change",
    entity: "User",
    entityId: targetUserId,
    metadata: { oldRole, newRole },
  },
});
```

---

### US-2: Слияние дублирующих аккаунтов из единого реестра

#### Шаг 2.1: Добавить кнопку "Объединить" в таблицу клиентов

**Файл**: `src/components/admin/users/unified-users-page.tsx` (или обновленный `clients-page-content.tsx`)

Изменения:
- В каждой строке таблицы клиентов добавить колонку "Действия" с кнопкой "Объединить"
- Кнопка видима только для пользователей с `session.user.role === "SUPERADMIN"` (проверка на клиенте)
- При клике открывается `MergeDialog` с `primaryId` = id текущего пользователя

Для проверки роли на клиенте: использовать `useSession()` из `next-auth/react`.

#### Шаг 2.2: Переиспользовать MergeDialog без изменений

**Файл**: `src/components/admin/clients/merge-dialog.tsx`

Компонент уже полностью реализован:
- Поиск второго аккаунта через `/api/admin/clients?search=...`
- Preview через `GET /api/admin/clients/merge/preview?primaryId=...&secondaryId=...`
- Подтверждение через ввод "ОБЪЕДИНИТЬ"
- Merge через `POST /api/admin/clients/merge`
- Запрет объединения с самим собой (проверка в preview API, AC-2.8)

Единственное изменение: перенести импорт `MergeDialog` из `clients/merge-dialog` в новый компонент реестра. Компонент не привязан к конкретной странице.

#### Шаг 2.3: Верифицировать RBAC на API merge

Существующие endpoints уже защищены:
- `GET /api/admin/clients/merge/preview` -- проверка `session.user.role !== "SUPERADMIN"` (строка 13 preview/route.ts)
- `POST /api/admin/clients/merge` -- проверка `session.user.role !== "SUPERADMIN"` (строка 14 merge/route.ts)
- AuditLog записывается в `mergeClients()` service (нужно верифицировать при review)

Никаких изменений в API merge не требуется.

---

## RBAC Summary

| Endpoint | Роль | hasModuleAccess | Rate Limiting |
|----------|------|-----------------|---------------|
| `DELETE /api/profile/contacts/:channel/detach` | USER, MANAGER, SUPERADMIN (свой профиль) | Нет (публичный для авторизованных) | 10 req/min на userId |
| `GET /api/users` (обновленный) | SUPERADMIN | Нет | Без лимита (админский) |
| `GET /api/admin/clients` (без изменений) | SUPERADMIN, MANAGER с секцией "clients"->переходит в "users" | requireAdminSection("users") | Без лимита |
| `GET /api/admin/clients/merge/preview` (без изменений) | SUPERADMIN | Нет | Без лимита |
| `POST /api/admin/clients/merge` (без изменений) | SUPERADMIN | Нет | Без лимита |
| `GET /api/profile` (обновленный) | USER, MANAGER, SUPERADMIN | Нет | 60 req/min на userId |
| `GET /api/notifications/preferences` (обновленный) | USER, MANAGER, SUPERADMIN | Нет | 60 req/min на userId |

Примечание: при удалении секций "clients" и "telegram" из `ADMIN_SECTIONS`, MANAGER-ы, у которых были права на эти секции, получат доступ через секцию "users" (если она им назначена). Необходимо проверить существующие `AdminPermission` записи и при необходимости обновить.

---

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Удаление кнопок Google/VK блокирует вход существующим пользователям | Низкая | Высокий | SQL-проверка `Account` перед деплоем. Провайдеры остаются в `auth.ts` -- существующие сессии продолжают работать. Убираются только кнопки на UI. |
| Отвязка последнего канала блокирует пользователя | Без защиты -- высокая | Высокий | API `detachChannel()` считает все активные методы входа и блокирует операцию при count <= 1 (AC-4.4) |
| Удаление секций clients/telegram из ADMIN_SECTIONS ломает доступ менеджеров | Средняя | Средний | Менеджеры с permission "clients" должны получить permission "users". Миграция прав: `UPDATE AdminPermission SET section = 'users' WHERE section = 'clients'`. Для "telegram" -- менеджеру дается доступ к "monitoring". |
| Ломаются закладки `/admin/clients` и `/admin/telegram` | Средняя | Низкий | Страницы заменены на redirect (шаг 1.8) |
| Производительность вкладки "Все" при 500+ пользователях | Средняя | Средний | Пагинация по 50 записей, debounced search (300ms), индексы уже есть |
| Яндекс OAuth привязка из профиля конфликтует с existing email | Низкая | Средний | NextAuth `allowDangerousEmailAccountLinking: true` для Yandex-провайдера уже установлен через PrismaAdapter. OAuth flow возвращает на `/dashboard` -- стандартное поведение. |

---

## Zod-схемы (полный перечень изменений)

### Новые

`src/modules/profile/validation.ts`:
```typescript
export const detachChannelSchema = z.object({
  channel: z.enum(["telegram", "email", "phone", "yandex"], {
    errorMap: () => ({ message: "Неподдерживаемый канал" }),
  }),
});
```

`src/modules/users/validation.ts`:
```typescript
export const listUsersSchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
```

### Существующие (без изменений)

- `mergeClientsSchema` -- уже включает refine для self-merge
- `clientFilterSchema` -- уже поддерживает search, limit, offset
- `updateNameSchema`, `attachEmailRequestSchema`, `attachEmailConfirmSchema`, `attachPhoneRequestSchema`, `attachPhoneConfirmSchema` -- без изменений

---

## Чеклист перед передачей Developer

- [x] ADR написан и зафиксирован
- [x] Схема данных описана (нет изменений Prisma -- документировано)
- [x] API-контракты определены (1 новый endpoint, 3 обновленных)
- [x] Zod-схемы описаны (2 новые)
- [x] Влияние на существующие модули оценено (6 модулей)
- [x] Миграция данных описана (SQL-проверка перед деплоем, AdminPermission migration)
- [x] RBAC для каждого endpoint определен
- [x] Rate limiting определен
- [x] Валидируемые поля и формат ошибок описаны

---

## File Change Summary

### Новые файлы

| Файл | Описание |
|------|----------|
| `src/app/api/profile/contacts/[channel]/detach/route.ts` | API отвязки каналов |
| `src/components/admin/users/unified-users-page.tsx` | Компонент единого реестра с вкладками |

### Изменяемые файлы

| Файл | Описание изменений |
|------|-------------------|
| `src/app/auth/signin/page.tsx` | Удалить Google/VK кнопки, переставить порядок, убрать data-request-access=write, обновить заглушку |
| `src/modules/profile/service.ts` | Добавить `detachChannel()`, расширить `getProfile()` полем yandex |
| `src/modules/profile/types.ts` | Добавить `yandex` в `ProfileContacts` |
| `src/modules/profile/validation.ts` | Добавить `detachChannelSchema` |
| `src/modules/users/service.ts` | Добавить пагинацию в `listUsers()`, добавить `authProviders` |
| `src/modules/users/validation.ts` | Добавить `listUsersSchema` |
| `src/app/api/users/route.ts` | Парсить limit/offset, вернуть total в meta |
| `src/app/api/profile/route.ts` | Без изменений (сервис расширен) |
| `src/app/api/notifications/preferences/route.ts` | Убрать VK из availableChannels |
| `src/components/public/profile/contacts-card.tsx` | Добавить Яндекс, кнопки отвязки, убрать VK, привязка Telegram |
| `src/components/public/notifications/notification-settings.tsx` | Убрать VK из channelLabels |
| `src/components/admin/users/users-list.tsx` | Добавить пагинацию, значки аккаунтов |
| `src/components/admin/clients/clients-page-content.tsx` | Добавить колонку действий с merge-кнопкой |
| `src/components/admin/sidebar.tsx` | Удалить "Клиенты" и "Telegram" из ALL_NAVIGATION |
| `src/lib/permissions.ts` | Удалить "clients" и "telegram" из ADMIN_SECTIONS |
| `src/app/admin/users/page.tsx` | Рендерить UnifiedUsersPage вместо UsersList |
| `src/app/admin/clients/page.tsx` | Заменить на redirect `/admin/users?tab=clients` |
| `src/app/admin/telegram/page.tsx` | Заменить на redirect `/admin/monitoring?tab=system` |
| `src/app/admin/clients/[id]/page.tsx` | Обновить back-link на `/admin/users?tab=clients` |
| `src/app/admin/monitoring/page.tsx` | Добавить секцию с TelegramSettings и NotificationFlowMap |
| `src/components/admin/clients/client-profile.tsx` | Обновить back-link |

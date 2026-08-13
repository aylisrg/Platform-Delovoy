# ADR: Ролевой ребилд Telegram Mini App «Деловой»

**Дата:** 2026-08-13
**RUN_ID:** `2026-08-13-miniapp-role-rebuild`
**Статус:** Принято (готово к передаче Developer)
**Автор:** System Architect
**Вход:** PRD `docs/requirements/2026-08-13-miniapp-role-rebuild-prd.md`, контекст-лог `docs/context/2026-08-13-miniapp-role-rebuild-context.md`

---

## Контекст

Три боли владельца: (1) Mini App одинаков для гостя и сотрудника, роль доезжает в JWT, но не используется; (2) на один деплой владелец получает несколько по-разному сформулированных сообщений; (3) UI не привязан к теме Telegram.

Границы зафиксированы PRD и обязательны: новых модулей в `src/modules/` нет; `gazebos`/`ps-park`/`cafe` — только через существующие публичные интерфейсы (их `service.ts`/`validation.ts` не редактируем, только импортируем); миграции только аддитивные; затронутые поверхности — `notifications`, `src/app/webapp/`, `src/app/api/webapp/`, `bot/handlers/team-settings.ts`, `.github/workflows/deploy.yml`.

Все решения ниже проверены чтением кода: `events.ts`, `routing-categories.ts`, `dispatch/{dispatcher,dedup,preferences,preferences-service,types}.ts`, `service.ts` (`notifyAdmin`), `recipients.ts`, `cohorts/{broadcast,segments}.ts`, `release-notify.ts`, `src/lib/{permissions,rate-limit,webapp-auth,telegram-webapp,api-response}.ts`, `src/app/api/webapp/**`, `src/components/webapp/{TelegramProvider,TabBar}.tsx`, `src/app/webapp/layout.tsx`, `src/app/layout.tsx`, `deploy.yml`, `bot/handlers/team-settings.ts`, `prisma/schema.prisma`.

---

## Сводка решений

| # | Решение |
|---|---|
| 1 | `capabilities` возвращает `POST /api/webapp/auth` (один round-trip, нет мигания). Чувствительные роуты перепроверяют роль и секции из БД на каждый запрос. |
| 2 | Единый helper подписи/проверки JWT в `src/lib/webapp-auth.ts`; отказ 503 при отсутствии `NEXTAUTH_SECRET`; `rateLimit(public)` на `/api/webapp/auth`; `timingSafeEqual` в `validateInitData`. |
| 3 | Новые роуты: `GET/POST /api/webapp/feed(/read)`, `POST /api/webapp/cafe/checkout`, `GET /api/webapp/cafe/orders`, `GET/PUT /api/webapp/notification-center`. Меню кафе читается напрямую из публичного `GET /api/cafe` — обёртка не нужна. |
| 4 | Курируемый каталог управляемых типов — `src/modules/notifications/catalog.ts`; вводим только `system.release` (без `system.deploy`); CRITICAL-алерты в каталог не входят вовсе. |
| 5 | Автопровижининг `UserNotificationChannel(TELEGRAM)` при первом входе в Центр (и в миграции для легаси-подписчиков релизов). |
| 6 | Серверная идемпотентность релиза — новая таблица `ReleaseAnnouncement` (PK = `version`), claim через `create` + P2002; fail-open при иной ошибке; `dispatch()` вместо прямой отправки; групповое «Deploy OK» становится fallback'ом. |
| 7 | Дедуп по `(userId|eventType|entityId)` — только для allowlist-префиксов событий-состояний; для `messenger.*`/`task.*` поведение сохраняется (иначе регресс). |
| 8 | Мост themeParams → CSS-переменные в `TelegramProvider`; набор из 14 токенов; вложенные `<html>/<body>` чиним сейчас минимальным способом. |
| 9 | Миграции: `OutgoingNotification.readAt`, `NotificationGlobalPreference.feedSeenAt`, таблица `ReleaseAnnouncement` + бэкфилл-INSERT'ы. Всё аддитивно. |

---

## 1. Ролевой bootstrap (US-1)

### Варианты

**A. Расширить ответ `/api/webapp/auth` полем `capabilities`.** Один round-trip: к моменту `ready === true` навигация уже знает состав разделов (AC-1.6 бесплатно). Минус — снимок прав фиксируется на момент логина; при понижении роли внутри сессии таб-бар останется прежним до перезапуска Mini App.

**B. Отдельный `GET /api/webapp/me`.** Всегда свежие права, но это второй последовательный запрос после auth: навигация не может отрисоваться до его ответа → либо мигание, либо лишние ~200–400 мс белого экрана на мобильной сети РФ (риск №5 PRD).

**C. Гибрид: A для рендера + серверный ре-чек из БД на каждом чувствительном запросе.**

### Решение — вариант C

`POST /api/webapp/auth` возвращает `capabilities` (рендер), а **каждый staff-роут заново вычисляет права из БД** (`getUserAdminSections`), не доверяя ни одному claim'у токена, кроме `sub`. Понижение роли лишает доступа немедленно: `GET /api/webapp/notification-center` вернёт `403`, экран покажет «Доступ отозван» — AC-1.5/AC-5.8 закрыты. Отдельный `/api/webapp/me` не заводим: единственная staff-поверхность — Центр уведомлений, и его `GET` сам по себе является авторитетным «me» (возвращает актуальный набор категорий).

Токен по-прежнему содержит только `sub`, `telegramId`, `role`; `role` — исключительно для оптимистичного рендера.

```jsonc
// POST /api/webapp/auth → 200
{ "success": true, "data": {
  "token": "<JWT 24h>",
  "user": { "id": "...", "name": "...", "role": "ADMIN", "image": null, "telegramId": "123" },
  "needsLinking": false,
  "capabilities": {
    "isStaff": true,
    "staffSections": ["gazebos", "inventory", "monitoring"],
    "notificationCategories": ["bookings", "inventory", "system"],
    "canNotificationCenter": true
  }
}}
```

Вычисление — новый серверный модуль `src/lib/webapp/capabilities.ts`:

```ts
export async function getWebAppCapabilities(user: { id: string; role: Role }): Promise<WebAppCapabilities>;
// role === "USER" → { isStaff:false, staffSections:[], notificationCategories:[], canNotificationCenter:false } без запросов в БД
// иначе: sections = await getUserAdminSections(user.id)  ← уже учитывает STRICT_ACCESS_MODULES
//        notificationCategories = визуальный фильтр каталога (§4) по sections + роли
```

**STRICT_ACCESS_MODULES.** Никакой отдельной обработки `nedelovoy` не пишем и писать нельзя: `getUserAdminSections` уже отдаёт SUPERADMIN все нестрогие секции плюс строгие только при явном `AdminPermission`. Каталог (§4) сопоставляет категорию с `AdminSection`, поэтому строгий доступ наследуется автоматически — в том числе для будущей категории `nedelovoy`. Тест на это обязателен (§11, Track A).

### Навигация по роли

Единственный источник состава навигации — чистая функция `src/lib/webapp/navigation.ts` (без БД, импортируется и клиентом, и тестами):

```ts
buildNavigation(caps: WebAppCapabilities): {
  tabs: Array<{ href: string; label: string; icon: IconName }>;
  profileEntries: Array<{ href: string; label: string; icon: IconName; badge?: "dot" }>;
}
```

| Роль | Табы | Профиль |
|---|---|---|
| USER | Главная, Кафе, Барбекю Парк, Плей Парк, Мои брони, Профиль | Контакты, уведомления гостя (`/webapp/settings`), лояльность-заглушка |
| MANAGER / ADMIN / SUPERADMIN | те же 6 табов | то же **плюс** «🔔 Центр уведомлений» → `/webapp/notifications` |

- Таб «Чаты» удаляется из состава (AC-1.4). Страницы `/webapp/messenger/**` остаются в коде и доступны по прямой ссылке — их удаление в скоуп не входит.
- Табов остаётся 6, как сегодня: минус «Чаты», плюс «Кафе». Отдельный хаб «Услуги» не заводим — это лишняя страница и лишний тап.
- Вход в Центр — в Профиле, а не седьмым табом: так требует AC-1.3, и так таб-бар не разъезжается на узких экранах.
- AC-1.1 («состав определяется ролью») выполняется тем, что состав целиком строится `buildNavigation(caps)`; для сотрудника результат строго шире, чем для USER (`profileEntries` содержит Центр). Одинаковый taб-бар — следствие AC-1.3, а не отсутствия ветвления.
- AC-1.6: `TabBar` и Профиль рендерят навигацию только при `ready === true`; до этого — скелет-таббар без подписей (Track B). Так как `capabilities` приходят тем же ответом, что и токен, второй фазы «доехали права → перерисовали» не существует.

---

## 2. Безопасность аутентификации (US-1, AC-1.7…1.9)

### Единый helper вместо копипасты в 3 файлах

Сегодня `new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "webapp-secret")` продублирован в `src/lib/webapp-auth.ts`, `src/app/api/webapp/auth/route.ts`, `src/app/api/webapp/link/confirm/route.ts`. Публично известный fallback-секрет означает, что при незаданном `NEXTAUTH_SECRET` кто угодно подпишет токен с `role: "SUPERADMIN"`.

Расширяем **существующий** `src/lib/webapp-auth.ts` (новый файл не заводим — так все три импортёра меняются на одну строку):

```ts
export class WebAppAuthConfigError extends Error {}

/** Ленивая (не module-load) резолюция секрета: бросает WebAppAuthConfigError,
 *  если NEXTAUTH_SECRET пуст или короче 16 символов. Никаких fallback-значений. */
function getWebAppJwtSecret(): Uint8Array;

export async function signWebAppToken(p: { sub: string; telegramId: string; role: string }): Promise<string>;
export async function verifyWebAppToken(request: NextRequest): Promise<WebAppUser | null>;

/** Ре-чек прав из БД для staff-роутов (AC-1.5/5.8). */
export async function loadWebAppStaff(request: NextRequest):
  Promise<{ ok: true; staff: { id: string; role: Role; sections: string[] } }
         | { ok: false; status: 401 | 403 }>;
```

- Ленивая резолюция (внутри функции, не на верхнем уровне модуля) — чтобы сборка и юнит-тесты без секрета не падали на импорте.
- Роут ловит `WebAppAuthConfigError` → `apiError("NOT_CONFIGURED", "Аутентификация Mini App не настроена", 503)`. Явный отказ вместо тихой работы на известном секрете — AC-1.8.
- `loadWebAppStaff` = `verifyWebAppToken` → `prisma.user.findUnique({ select: { role } })` → `getUserAdminSections`. `401` — токен невалиден/просрочен; `403` — пользователь есть, но `role === "USER"` (или удалён). Роль из токена в решении не участвует.

### Rate limit (AC-1.7)

В начало `POST /api/webapp/auth`: `const limited = await rateLimit(request, "public"); if (limited) return limited;` — тот же публичный тир (180/мин на доверенный IP, `X-Real-IP` от nginx), что у прочих публичных ручек. Ключ по IP, не по telegramId: до валидации initData личность не установлена. Один холодный старт Mini App = 1 запрос, поэтому CGNAT-риск ничтожен.

Все новые `/api/webapp/*` роуты — `rateLimit(request, "authenticated", user.id)` **после** верификации токена (240/мин на пользователя).

### timingSafeEqual (AC-1.9)

В `src/lib/telegram-webapp.ts` заменить `computedHash !== hash`:

```ts
if (!/^[0-9a-f]{64}$/i.test(hash)) return null;               // защита от Buffer.from мусора
const a = Buffer.from(computedHash, "hex");
const b = Buffer.from(hash, "hex");
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
```

Проверка `auth_date` (1 час) остаётся. Формат ответа не меняется — по коду ошибки нельзя отличить «нет пользователя» от «плохая подпись» (оба `401 UNAUTHORIZED`).

---

## 3. API-поверхность `/api/webapp/*`

Общие правила для всех новых роутов: `verifyWebAppToken`/`loadWebAppStaff` → `rateLimit("authenticated", userId)` → Zod → сервис → `apiResponse`/`apiError`. Логика — в сервисах (`src/modules/notifications/*`), роут только парсит и возвращает.

### 3.1 Лента — `GET /api/webapp/feed`, `POST /api/webapp/feed/read`

**Проблема слияния.** Персональные копии рассылок уже лежат в `OutgoingNotification` с `entityType="BroadcastCampaign"` и `entityId=<campaignId>` (`cohorts/broadcast.ts:44`). Но `dispatch()` создаёт запись только если у пользователя есть верифицированный канал (`pickChannel` → `no available channel` → запись не создаётся). У обычного гостя Mini App канала нет — значит **чтение только `OutgoingNotification` даёт пустую ленту для почти всех USER** и убивает US-2.

Второй нюанс: `attemptFallback` создаёт вторую запись с тем же `dedupKey` — без схлопывания лента покажет дубль.

Третий: ни один сегмент рассылок не является «всем» — `all_verified_users` = `role: USER` + verified email, остальные три сегмента таргетированы (арендаторы, гости PS-парка, гости беседок). Показывать арендаторскую рассылку случайному гостю нельзя.

**Правило источников (принимается):**

| Тип записи | Источник | Условие |
|---|---|---|
| Персональные уведомления (`kind: "personal"`) | `OutgoingNotification` где `userId = me`, `entityType != "BroadcastCampaign"` | схлопывание по `dedupKey` — берём самую свежую строку |
| Рассылка, реально доставленная мне (`kind: "news"`) | `OutgoingNotification` где `entityType = "BroadcastCampaign"` | те же правила схлопывания |
| Новости парка, которых у меня нет персонально (`kind: "news"`) | `BroadcastCampaign` | `segmentKey = "all_verified_users"` **и** `status in ("running","completed")` **и** `id ∉` множества `entityId` моих строк за то же окно |

`all_verified_users` трактуем как «новости парка для всех» — это самый широкий существующий сегмент, новый инструмент авторства не появляется (AC-2.2). Таргетированные кампании видны только тем, кому реально ушли. Если позже понадобится явный флаг публичности — аддитивное `BroadcastCampaign.isPublic`; сейчас не вводим.

**Контракт.**

```
GET /api/webapp/feed?limit=20&cursor=2026-08-13T09:00:00.000Z
Auth: Bearer <webapp JWT>   Roles: любая (USER включительно)

200 { "success": true, "data": {
  "items": [{
    "id": "on:clx123" | "bc:clx999",
    "kind": "personal" | "news",
    "eventType": "booking.created" | "BROADCAST",
    "title": "Бронь подтверждена",
    "body": "Беседка №3, 14 августа 14:00–18:00",
    "actions": [{ "label": "Открыть", "url": "/webapp/bookings" }],
    "createdAt": "2026-08-13T09:00:00.000Z",
    "readAt": null,
    "moduleSlug": "gazebos"
  }],
  "nextCursor": "2026-08-01T10:00:00.000Z",
  "unreadCount": 3
}}
```

- Пагинация — keyset по `createdAt` (`< cursor`), `limit` 1..50 (default 20). Каждый из двух источников запрашивается на `limit + 1`, результаты сливаются, сортируются `createdAt desc`, обрезаются до `limit`; `nextCursor` = `createdAt` последнего отданного элемента.
- Санитизация `actions[].url`: пропускаем только `https:` и относительные пути с `/`; всё остальное (`javascript:`, `tg://`, `data:`) вырезаем. Контент авторит SUPERADMIN, но лента открывается в WebView — защита от XSS/овнёрства при компрометации админ-аккаунта обязательна.
- `POST /api/webapp/feed/read` body `{ "ids": ["on:clx123"] }` или `{ "upTo": "2026-08-13T09:00:00.000Z" }` → проставляет `readAt` персональным записям пользователя **и** двигает watermark `NotificationGlobalPreference.feedSeenAt` (см. §9, зачем нужны оба).
- `unreadCount` = (персональные записи с `readAt IS NULL`) + (кампании-новости с `createdAt > feedSeenAt`, не доставленные персонально). Это же число рисует точку на табе «Главная».
- Пустое состояние (AC-2.3) — клиентское: карточка «О парке» + быстрые ссылки. Сервер отдаёт пустой `items`, не ошибку.

Сервис: `src/modules/notifications/feed.ts` — `getWebappFeed(userId, { cursor, limit })`, `markFeedRead(userId, { ids?, upTo? })`.

### 3.2 Кафе — тонкие JWT-обёртки (AC-3.3, AC-3.4)

**Вариант A (гостевой чекаут как есть).** Клиент Mini App зовёт публичный `POST /api/cafe/checkout`. Ноль нового кода. Но `userId` определяется только по NextAuth-cookie (`route.ts:27`), которой у Mini App нет: **каждый заказ из Mini App становится гостевым** — не попадает в «Мои заказы», не участвует в `resolvePaymentEmail(userId)`, не пишется в `AuditLog`, а `GET /api/cafe/orders` (только NextAuth) для Mini App вообще недоступен. Пункт «путь к заказу через существующий сценарий» формально выполнен, но пользователь после оплаты не видит свой заказ.

**Вариант B (тонкие обёртки над готовыми сервисами).** Два роута по 25 строк, которые не содержат бизнес-логики: парсят тем же `checkoutSchema` из `@/modules/cafe/validation` и зовут `createCheckout(user.id, input)` / `listOrders({ userId: user.id })`. Сервисы кафе не меняются ни на строку — правило PRD соблюдено буквально.

**Решение — вариант B.** Атрибуция заказа пользователю и есть «понятный путь к заказу»; механизм заказа и оплаты (ЮKassa, 54-ФЗ чеки, `PaymentSubjectType.ORDER`) не создаётся заново, а переиспользуется как есть.

```
POST /api/webapp/cafe/checkout            Roles: любая аутентифицированная
Body (checkoutSchema из cafe/validation, импорт без изменений):
  { items: [{ menuItemId, quantity }], deliveryTo?, comment?, customerEmail? }
201 { success, data: { id, totalAmount, status, items[], payment: { id, confirmationUrl } | null } }
4xx: 422 VALIDATION_ERROR | 400 <OrderError.code> | 422 PAYMENT_CONTACT_REQUIRED | 401 UNAUTHORIZED | 429

GET /api/webapp/cafe/orders?limit=20      Roles: любая аутентифицированная
200 { success, data: { orders: [{ id, orderNumber, status, totalAmount, paidAt, createdAt,
                                  items: [{ name, quantity, price }] }] } }
```

- Меню — клиент читает публичный `GET /api/cafe` напрямую (без токена, `price` — строка → `Number()`, `imageUrl` — same-origin путь, plain `<img>`). Обёртку не заводим: лишний прокси без единой новой проверки.
- `GET /api/webapp/cafe/orders` возвращает **только** заказы вызывающего (`listOrders` фильтрует по `userId`), и роут отбрасывает вложенный `user { name, email }` — DTO собирается явно, «не возвращаем внутренние id/чужие данные».
- `payment.confirmationUrl` открывается через `Telegram.WebApp.openLink(url)`; `payment === null` → экран «оплата на кассе» + номер заказа `id.slice(-6).toUpperCase()`. Никаких изменений в `payments`/`yookassa`.
- `logAudit(userId, "order.create", "Order", id, { source: "webapp" })` в роуте чекаута.

### 3.3 Центр уведомлений — `GET/PUT /api/webapp/notification-center`

```
GET /api/webapp/notification-center        Roles: MANAGER | ADMIN | SUPERADMIN (ре-чек из БД)
200 { success, data: {
  "role": "ADMIN",
  "channel": { "kind": "TELEGRAM", "status": "active" | "inactive", "provisionedNow": true },
  "categories": [{
     "key": "bookings", "label": "Бронирования", "description": "Барбекю Парк и Плей Парк",
     "icon": "calendar",
     "delivery": "personal" | "group",
     "events": [{ "eventType": "booking.created", "label": "Новая бронь",
                  "description": "Когда гость создал бронь",
                  "enabled": true, "source": "explicit" | "default" }]
  }],
  "protected": [{ "label": "Критические алерты инфраструктуры",
                  "note": "Приходят всегда и не отключаются" }]
}}
401 UNAUTHORIZED — нет/битый токен
403 FORBIDDEN     — role === USER или пользователь удалён (ре-чек из БД)

PUT /api/webapp/notification-center        Roles: те же + доступ к секции события
Body: { "eventType": "booking.created", "enabled": false }
200 { success, data: { "eventType": "booking.created", "enabled": false } }
422 VALIDATION_ERROR — eventType вне каталога (закрытый z.enum) или enabled не boolean
403 FORBIDDEN        — нет доступа к секции категории этого события
```

- `delivery` — честная подсказка: `"personal"` если userId присутствует в `Module.config.notificationRecipients` соответствующего модуля (путь 2 в `notifyAdmin`) **или** есть явная строка-подписка (см. ниже); иначе `"group"` и UI показывает пояснение, что события сейчас уходят в общий чат раздела.
- Каждый `PUT` → `logAudit(userId, "notification.preference.update", "NotificationEventPreference", eventType, { enabled, source: "webapp" })`.
- Опора на готовые `getPreferences(userId)` / `upsertEventPreference(userId, eventType, { enabled })` из `dispatch/preferences-service.ts` — свой CRUD не пишем. Исключение — `system.release`, см. §6 (пишется через `setReleaseSubscription`, чтобы легаси-колонка не разъезжалась).
- Сервис — `src/modules/notifications/webapp-center.ts`: `getNotificationCenter(staff)`, `setEventPreference(staff, eventType, enabled)`, `ensureTelegramChannel(userId, telegramId)`.

**Явная подписка как принцип.** `mergePreferences` считает отсутствие строки как `enabled: true`. Для событий, которые адресуются лично субъекту (бронь гостя, сообщение в мессенджере, задача), это правильно и не меняется. Но для **staff-фанаута** это дало бы «включено по умолчанию для всех» — нежелательный шум. Поэтому вводится правило, используемое и в §4, и в §6:

> Строка `NotificationEventPreference(userId, eventType, enabled=true)` = **явная персональная подписка сотрудника**. Отсутствие строки = подписки нет. Резолверы аудитории staff-событий читают только явные строки, дефолт `enabled: true` в `dispatch()` при этом не трогается.

Из этого следует нужное (`notifyAdmin`, путь 2b): в `src/modules/notifications/service.ts` к существующим получателям добавляются «самоподписанные» — пользователи с явной строкой `enabled=true` по этому `eventType`, имеющие доступ к секции категории. Условия путей 1/3 остаются на `getExplicitRecipientUserIds` **без изменений** (иначе включение подписки одним человеком выключило бы групповой чат для всех — регресс). Дубль с уже перечисленным получателем невозможен: `dispatch()` схлопнет по одинаковому `dedupKey`. Без этого шага тумблеры Центра были бы декоративными для всех, кого нет в `Module.config.notificationRecipients` (включая SUPERADMIN — путь 2 использует именно *explicit* список).

---

## 4. Каталог управляемых типов событий

**Где живёт.** Новый leaf-модуль `src/modules/notifications/catalog.ts` — как `routing-categories.ts`: без импортов БД и роутов, чтобы его можно было импортировать и на клиенте, и в тестах.

```ts
export type ManagedEvent = { eventType: string; label: string; description: string };
export type ManagedCategory = {
  key: string;                 // ключ категории Центра
  label: string; description: string; icon: IconName;
  /** Доступ: хотя бы одна из секций (ADMIN_SECTIONS) */
  sections: AdminSection[];
  /** true → плюс к секциям пускает роль SUPERADMIN */
  superadminAlways?: boolean;
  events: ManagedEvent[];
};
export const NOTIFICATION_CATALOG: ManagedCategory[];
export const MANAGED_EVENT_TYPES: [string, ...string[]];      // для закрытого z.enum
export function categoryForEvent(eventType: string): ManagedCategory | undefined;
```

**Состав (иначе Центр обещает то, чего не существует):**

| Категория | `sections` | События | Комментарий |
|---|---|---|---|
| `bookings` «Бронирования» | `gazebos`, `ps-park` | `booking.created`, `booking.cancelled` | одна категория на два парка — см. ниже |
| `cafe` «Кафе» | `cafe` | `order.placed`, `order.cancelled` | |
| `rental` «Аренда» | `rental` | `contract.created`, `contract.expiring`, `inquiry.created` | |
| `payments` «Платежи» | `analytics`, `monitoring` | `payment.succeeded`, `payment.refund.succeeded` | |
| `feedback` «Обратная связь» | `feedback`* | `avito.lead.new` только при секции `avito` | *если секции нет в `ADMIN_SECTIONS` — категория не включается |
| `system` «Системные» | `monitoring`, `superadminAlways: true` | `system.release` | AC-5.3 |

**Почему `gazebos` и `ps-park` объединены в одну категорию (осознанное отступление от формулировки AC-5.1).** Ключ предпочтения — `(userId, eventType)`; `booking.created` физически один и тот же тип для обоих парков (модуль различается только в `entityType`, `notifyAdmin` путь 2). Показать два раздельных тумблера, за которыми стоит одна строка БД, — обмануть пользователя: выключив «Барбекю Парк → новая бронь», он выключит и Плей Парк. Объединённая категория (видна при доступе к `gazebos` **или** `ps-park`) — единственный честный вариант без изменения контрактов событий в модулях бронирования, что PRD запрещает. Гранулярность внутри категории (новая бронь ≠ отмена) сохранена — это и есть суть AC-5.2. Follow-up (вне скоупа): модуль-скоупные типы `gazebos:booking.created`.

**Инвентарь/склад в каталоге нет** — событий `inventory.*` в `EVENT_ROUTING` не существует, низкие остатки шлются ad-hoc (пункт 6 «Вне скоупа»). Обещать тумблер, за которым ничего нет, нельзя.

**Новые типы событий.** В `src/modules/notifications/events.ts` добавляется **только**:

```ts
// Dispatch-only: маршрутизируется через dispatch()/NotificationEventPreference,
// legacy notify() для него не используется (оба флага false — как у booking.paid).
"system.release": { client: false, admin: false },
```

`system.deploy` **не вводится сознательно**: «сообщение на каждый деплой» — ровно тот шум, на который жалуется владелец (US-6). Событие релиза одно, и оно привязано к версии.

**Маппинг на секции и `hasAdminSectionAccess`.** Категория показывается, если `category.sections.some(s => userSections.includes(s))` или (`superadminAlways && role === "SUPERADMIN"`). `userSections` берётся из `getUserAdminSections(userId)` в момент запроса (ре-чек, AC-5.8), а не из токена. `ADMIN` проходит по тем же правилам, что MANAGER и SUPERADMIN — никакого исключения по роли (AC-5.4); баг `getTeamUser()` в боте лечится продуктово (§6.4), а не аллоулистом.

**Grandfather-правило для `system`.** Миграция (§6) переносит легаси-подписчиков `notifyReleases` 1:1, включая MANAGER без секции `monitoring`. Чтобы такой человек не оказался в ловушке «получаю, но не могу отключить», категория `system` показывается также если у пользователя уже есть **любая явная строка** `NotificationEventPreference` по событию из этой категории. Это осознанное согласование AC-5.3 (кому категория доступна) и AC-6.5 (никто не теряет подписку): новых подписчиков правило не создаёт, только даёт унаследованным доступ к собственному тумблеру.

**Гарантия AC-5.7 (CRITICAL не отключается) — двухслойная:**
1. Инфраструктурные алерты (`src/lib/telegram-alert.ts`, watchdog'и, curl из CI, `/api/health`) вообще не проходят через `dispatch()`/`NotificationEventPreference` — им нечего читать, никакой тумблер на них не влияет физически.
2. `PUT` валидирует `eventType` закрытым `z.enum(MANAGED_EVENT_TYPES)` — записать предпочтение по неуправляемому типу через Mini App невозможно в принципе (в том числе по угаданному имени).
   В UI категория «Системные» дополнительно показывает неинтерактивную строку-пояснение из `protected[]`.

---

## 5. Автопровижининг Telegram-канала (AC-5.6, риск №1 PRD)

**Обоснование безопасности.** `initData` подписан HMAC-SHA256 с ключом, производным от `TELEGRAM_BOT_TOKEN`, который знают только Telegram и наш сервер; подпись покрывает поле `user.id` и `auth_date` (окно 1 час), сравнение — timing-safe (§2). Пройденная проверка означает: этот запрос породил Telegram для конкретного `telegram_id`, и пользователь физически находится в аккаунте. Это **строго сильнее** OTP-цикла, который мы им заменяем: OTP доказывает доступ к чату с ботом одноразовым кодом, а initData — криптографически доказывает владение аккаунтом на каждом запуске. Адрес канала (`telegramId`) не приходит от клиента как данные — он извлекается из подписанной структуры на сервере.

**Поведение `ensureTelegramChannel(userId, telegramId)`** (вызывается из `GET /api/webapp/notification-center`, ровно один upsert):

| Состояние | Действие |
|---|---|
| Строки `(userId, TELEGRAM, telegramId)` нет | `create { kind: TELEGRAM, address: telegramId, label: "Telegram", priority: 10, isActive: true, verifiedAt: now() }` |
| Строка есть, `verifiedAt = null` | `update { verifiedAt: now() }` — доказательство владения получено |
| Строка есть, `verifiedAt != null`, `isActive = true` | ничего не делаем (идемпотентность) |
| Строка есть, но `isActive = false` | **не реактивируем**: деактивация — явное решение пользователя/админа. Возвращаем `channel.status: "inactive"` и UI просит включить канал осознанно |
| Есть TELEGRAM-канал с *другим* address (старый telegramId) | создаём новую строку под текущий адрес (уникальность — `(userId, kind, address)`), старую не трогаем |

`priority: 10` (меньше дефолтных 100) — Telegram становится основным каналом для Mini App-сотрудника, что соответствует ожиданию «уведомления приходят в Telegram».

**Радиус поражения (фиксируем осознанно).** Появление верифицированного канала делает пользователя достижимым для всех событий `dispatch()` — рассылки, `messenger.message.received`, задачи. Затрагивает единицы людей (сотрудники, открывшие Центр) и направлено верно: это ровно те уведомления, которые адресованы лично им. QA обязан проверить, что после первого открытия Центра поток сообщений не взрывается.

---

## 6. Идемпотентность релиз-анонсов (US-6)

### 6.1 Где хранится состояние «версия анонсирована»

**Вариант A — Redis `SETNX release:announced:<v>` + TTL.** Быстро, без миграции. Но Redis у нас уже флашили, а `redisAvailable` fail-open по проектному решению: пустой Redis = «версия не анонсирована» = дубль ровно того сорта, от которого избавляемся. Для факта, который должен помниться месяцами, кэш — неверное хранилище.

**Вариант B — новая таблица `ReleaseAnnouncement` (PK = `version`).** Переживает флаш Redis, рестарты и передеплои; уникальный ключ даёт **атомарный claim**: два параллельных прогона деплоя гонятся на `INSERT`, один выигрывает, второй получает `P2002` и молча выходит (AC-6.2 закрывается без блокировок и без учёта того, сколько раз запустился workflow). Плюс бесплатно получаем долговечный архив release-notes, который git-архив из `deploy.yml` никогда не создавал.

**Вариант C — `SystemEvent` как реестр.** Запрос по JSON-полю, нет уникального индекса → гонка не решается. Отклонено.

**Решение — B.** `OutgoingNotification.dedupKey` остаётся вторым эшелоном (5-минутное окно, на уровне получателя) — от двух прогонов в пределах минут; долговременная идемпотентность — таблица.

```ts
async function announceRelease(info: ReleaseInfo): Promise<
  { status: "announced"; queued: number } | { status: "skipped"; reason: "already-announced" }
> {
  // 1) claim
  try {
    await prisma.releaseAnnouncement.create({ data: {
      version: info.version, commitSha: info.commitSha,
      releaseNotes: info.releaseNotes, announcedAt: new Date(), source: "deploy",
    }});
  } catch (e) {
    if (isUniqueViolation(e /* P2002 */)) {
      await log.info("release-notify",
        `Релиз v${info.version} уже анонсирован — повторная отправка заблокирована`,
        { version: info.version, commitSha: info.commitSha });     // AC-6.7
      return { status: "skipped", reason: "already-announced" };
    }
    await log.warn("release-notify",
      `Проверка идемпотентности релиза v${info.version} не выполнена — отправляем (fail-open)`,
      { version: info.version, error: String(e) });                 // AC-6.6
    // проваливаемся дальше и всё равно отправляем
  }
  // 2) аудитория + dispatch
}
```

- **Ключ:** `version` (`@id`). Один и тот же номер версии не анонсируется дважды никогда — независимо от `commitSha` и от того, попал ли архивный коммит в защищённую ветку (AC-6.1).
- **AC-6.6 (fail-open):** молчание о реальном релизе хуже редкого дубля — при любой ошибке, кроме нарушения уникальности, отправляем и оставляем WARNING.
- **AC-6.7:** каждое блокирование пишет `SystemEvent` (`source: "release-notify"`, level `INFO` для дубля, `WARNING` для fail-open) — видно, что сработал дедуп, а не потеря.

### 6.2 Отправка через `dispatch()` и аудитория

`sendReleaseNotification()` (прямой `telegramAdapter.send` по `user.telegramId`) заменяется на `announceRelease()` поверх `dispatch()` — получаем очередь, ретраи, fallback-канал, `OutgoingNotification`-след и quiet hours бесплатно.

```ts
dispatch({
  userId,
  eventType: "system.release",
  entityType: "Release",
  entityId: info.version,          // ← даёт entity-scoped dedupKey (§7)
  payload: { title: `🚀 Релиз v${info.version}`, body: formatReleaseBody(info),
             actions: [{ label: "Changelog", url: `${APP_URL}/admin/monitoring` }] },
});
```

Аудитория — только явные подписки (принцип §3.3):

```ts
prisma.notificationEventPreference.findMany({
  where: { eventType: "system.release", enabled: true, user: { role: { not: "USER" } } },
  select: { userId: true },
});
```

Фильтр по роли — чтобы разжалованный сотрудник перестал получать релизы немедленно, не дожидаясь чистки строк.

### 6.3 Миграция состояния 1:1 (AC-6.5)

**Где выполняется — в SQL самой аддитивной миграции**, не в сидере и не в разовом скрипте: сидеры гоняются на каждый деплой (легко затереть/переоткрыть чужую отписку), разовый скрипт требует ручного шага на проде и легко забывается. Миграция выполняется ровно один раз, детерминированно, в том же PR, и её видно ревьюеру.

```sql
-- 1) подписки 1:1 из legacy-колонки (COALESCE — колонка default true, строки может не быть)
INSERT INTO "NotificationEventPreference"
  ("id","userId","eventType","enabled","channelKinds","quietWeekdaysOnly","timezone","createdAt","updatedAt")
SELECT gen_random_uuid()::text, u."id", 'system.release',
       COALESCE(np."notifyReleases", true), ARRAY[]::"NotificationChannelKind"[],
       false, 'Europe/Moscow', NOW(), NOW()
FROM "User" u
LEFT JOIN "NotificationPreference" np ON np."userId" = u."id"
WHERE u."role" IN ('SUPERADMIN','MANAGER')          -- ровно легаси-аудитория release-notify.ts
ON CONFLICT ("userId","eventType") DO NOTHING;

-- 2) канал доставки для тех, кто раньше получал напрямую по telegramId
INSERT INTO "UserNotificationChannel"
  ("id","userId","kind","address","label","priority","isActive","verifiedAt","createdAt","updatedAt")
SELECT gen_random_uuid()::text, u."id", 'TELEGRAM', u."telegramId", 'Telegram',
       10, true, NOW(), NOW(), NOW()
FROM "User" u
LEFT JOIN "NotificationPreference" np ON np."userId" = u."id"
WHERE u."role" IN ('SUPERADMIN','MANAGER')
  AND u."telegramId" IS NOT NULL
  AND COALESCE(np."notifyReleases", true) = true
ON CONFLICT ("userId","kind","address") DO NOTHING;
```

Шаг 2 обязателен: без `UserNotificationChannel` `dispatch()` вернёт `no available channel`, и подписчик молча перестанет получать релизы — прямое нарушение AC-6.5. Радиус поражения тот же, что в §5, и такой же осознанный.

`ADMIN` строк не получает (легаси им не слал) — «никто, кто не получал, не начинает» соблюдено; подписаться они могут сами через Центр (AC-5.4).

### 6.4 Единственное место настройки (AC-6.4)

- `setReleaseNotifyPreference(userId, enabled)` в `release-notify.ts` переименовывается по смыслу в `setReleaseSubscription(userId, enabled)` и пишет **обе** записи: `NotificationEventPreference(system.release)` (источник правды для доставки) и легаси `NotificationPreference.notifyReleases` (зеркало для существующего списка в `/admin/users`, который читает колонку напрямую). Одна функция — один путь записи, дрейфа нет; ни один файл в `users`/админке менять не нужно.
- Центр уведомлений при `eventType === "system.release"` зовёт `setReleaseSubscription`, для остальных — `upsertEventPreference`.
- `ensureManagerNotifyDefaults(userId)` (вызывается при создании/повышении пользователя) дополнительно create-only заводит строку `system.release, enabled=true` и канал Telegram при наличии `telegramId` — чтобы будущие повышения вели себя как до миграции.
- `getReleaseSubscribers()` читает `NotificationEventPreference`.
- **Бот `/settings`** (`bot/handlers/team-settings.ts`, минимальная правка):
  - `getTeamUser()` пускает любого `role !== "USER"` (попутно закрывает баг «ADMIN — невидимка»);
  - тумблер «🚀 Релизы ВКЛ/ВЫКЛ» удаляется; сообщение содержит текст «Настройки уведомлений переехали в Центр уведомлений» и inline-кнопку `web_app` → `${APP_URL}/webapp/notifications`;
  - обработчик `settings:releases:(on|off)` **остаётся**, но больше ничего не пишет: отвечает «Настройка переехала» и тем же deep-link'ом (в чатах у людей висят старые клавиатуры; молчаливая кнопка хуже, чем перенаправление).
- Колонка `notifyReleases` не удаляется (запрет деструктивных миграций) — становится зеркалом.

### 6.5 Одно сообщение на получателя (AC-6.3) и `deploy.yml`

**Групповое «✅ Deploy OK» → fallback.** Владелец состоит и в админ-группе, и в персональных подписчиках; два независимых анонсера дают два разных текста об одном событии по построению. Решение:

1. Шаг «Generate release notes & notify subscribers» переносится **выше** шага уведомления об успехе и получает `id: release`; он выставляет output `notified=true`, если API ответил `success:true` и `announced:true`.
2. Шаг «Notify on success» (групповое сообщение) получает условие `if: success() && steps.release.outputs.notified != 'true'` — группа получает подтверждение деплоя только тогда, когда персонального анонса не было (нет `RELEASE_NOTIFY_SECRET`, сеть/сервер не ответили, или версия уже анонсирована ранее). В нормальном сценарии релиза получатель получает ровно одно сообщение; в сценарии сбоя канал не молчит (AC-6.6 на уровне пайплайна).
3. Мёртвый guard `ls docs/releases/${VERSION}-*.md` (строка ~703) **удаляется** — идемпотентность теперь серверная и не зависит от пуша в защищённую ветку.
4. Шаг 4 «Archive release notes» (`git add/commit/push origin HEAD || true`) **удаляется целиком** — он никогда не срабатывал (защищённая ветка), а роль архива берёт на себя `ReleaseAnnouncement` (`version`, `releaseNotes`, `commitSha`, `announcedAt`). Генерация notes (ручные `current.md` → Gemini → git log) сохраняется без изменений.
5. Шаг `🚨 Deploy FAILED` остаётся как есть — это другое событие и единственный канал о провале.

**Двойной триггер (`workflow_run` + `push`).** `concurrency.group` уже одинаков для обоих (по SHA), но `cancel-in-progress: false` означает не «пропустить», а «поставить в очередь» — второй прогон дожидается первого и выполняется. Отменять прогон деплоя нельзя (правильное решение, не трогаем). Точечная правка:

```yaml
jobs:
  guard:
    name: Skip duplicate trigger
    runs-on: ubuntu-latest
    permissions: { actions: read }
    outputs:
      skip: ${{ steps.check.outputs.skip }}
    steps:
      - id: check
        if: github.event_name == 'push'
        env: { GH_TOKEN: ${{ github.token }} }
        run: |
          DONE=$(gh api "repos/${{ github.repository }}/actions/workflows/deploy.yml/runs?head_sha=${{ github.sha }}&status=success&per_page=20" \
                 --jq "[.workflow_runs[] | select(.id != ${{ github.run_id }})] | length")
          [ "${DONE:-0}" -gt 0 ] && echo "skip=true" >> "$GITHUB_OUTPUT" || echo "skip=false" >> "$GITHUB_OUTPUT"

  build-and-push:
    needs: guard
    if: >
      needs.guard.outputs.skip != 'true' && (
        github.event_name == 'workflow_dispatch' ||
        github.event_name == 'push' ||
        github.event.workflow_run.conclusion == 'success' )
```

Так как concurrency сериализует прогоны по SHA, push-прогон стартует уже после завершения `workflow_run`-прогона и видит его успешный статус → выходит за ~10 секунд. Fallback-назначение push-триггера сохраняется: если `workflow_run` не сработал, успешных прогонов нет и деплой идёт. `deploy`-джоб получает `needs: [guard, build-and-push]`. Никаких PAT не требуется — хватает `github.token` с `actions: read`.

---

## 7. Body-insensitive дедуп (`dispatch/dedup.ts`)

**Вариант A — сплошное правило: если `entityId` задан, payload-хэш не участвует.** Ровно то, что просит проблема D5. Но проверено по коду: `messenger/service.ts:609` шлёт `messenger.message.received` с `entityId = chatId`, а `tasks/notify.ts:93` — с `entityId = taskId`. Сплошное правило схлопнет **два разных сообщения в одном чате внутри 5 минут** в одно уведомление и два разных комментария к задаче — прямой регресс мессенджера и задач.

**Вариант B — allowlist префиксов событий-состояний.** `entityId` для них означает «состояние сущности», а не «поток сообщений о сущности».

**Решение — B:**

```ts
const ENTITY_SCOPED_PREFIXES = ["booking.", "order.", "payment.", "contract.", "inquiry.", "system."];
const ENTITY_SCOPED_EXACT = ["BROADCAST"];

export function computeDedupKey(input): string {
  const entityScoped = Boolean(input.entityId) && isEntityScoped(input.eventType);
  const raw = entityScoped
    ? [input.userId, input.eventType, input.entityId].join("|")
    : [input.userId, input.eventType, input.entityId ?? "", payloadHash(input.payload)].join("|");
  return sha256(raw);
}
```

**Влияние на существующие события:**

| Событие | Было | Стало | Оценка |
|---|---|---|---|
| `booking.created/cancelled` (entityId = bookingId) | разные формулировки → 2 сообщения | одно сообщение за 5 мин | целевое поведение |
| `order.*` (entityId = orderId) | то же | то же | целевое |
| `payment.succeeded` / `payment.refund.succeeded` | то же | то же | целевое; повторные webhook-и ЮKassa перестают дублировать |
| `BROADCAST` (entityId = campaignId) | 1 запись на кампанию | без изменений (payload одинаков) | нейтрально |
| `system.release` (entityId = version) | — | второй прогон в пределах окна схлопывается | второй эшелон к §6 |
| `messenger.message.received` | по тексту | **без изменений** | регресс предотвращён |
| `task.*` | по тексту | **без изменений** | регресс предотвращён |

Окно (`DEDUP_WINDOW_MINUTES = 5`) не меняется. Легитимный повтор состояния позже 5 минут (бронь создана → отменена → создана снова) по-прежнему проходит.

---

## 8. Дизайн-система (US-7)

### 8.1 Мост темы

Место — эффект в `TelegramProvider` (уже есть частичный на 7 переменных; расширяется). `themeParams` читается через `useSyncExternalStore` с подпиской на `themeChanged` — живое переключение темы (AC-7.1) обеспечено уже сегодня, надо лишь прокинуть полный набор.

```
bg_color                  → --tg-bg
secondary_bg_color        → --tg-secondary-bg
section_bg_color          → --tg-section-bg           (fallback: --tg-bg)
section_header_text_color → --tg-section-header-text  (fallback: --tg-hint)
section_separator_color   → --tg-separator            (fallback: rgba из colorScheme)
text_color                → --tg-text
subtitle_text_color       → --tg-subtitle             (fallback: --tg-hint)
hint_color                → --tg-hint
link_color                → --tg-link
button_color              → --tg-button
button_text_color         → --tg-button-text
accent_text_color         → --tg-accent               (fallback: --tg-button)
destructive_text_color    → --tg-destructive          (fallback: #e53935)
header_bg_color           → --tg-header-bg            (fallback: --tg-bg)
bottom_bar_bg_color       → --tg-bottom-bar-bg        (fallback: --tg-bg)
```

- Пишем в `document.documentElement.style` (как сейчас), плюс `root.dataset.tgScheme = colorScheme`.
- Класс `dark` вешаем **на обёртку `.webapp-root`**, а не на `<html>`: класс на `<html>` может зацепить Tailwind `dark:`-варианты остального приложения. Единственное существующее правило `.dark .webapp-tabbar` в `webapp.css` переписывается на `.webapp-root.dark .webapp-tabbar`.
- Захардкоженные `rgba(0,0,0,0.06|0.08)` в разделителях `webapp.css` заменяются на `var(--tg-separator)`.
- **Вне Telegram** (dev, браузер, SDK не подгрузился): `themeParams` пуст → действуют light-дефолты из `:root` в `webapp.css`, приложение выглядит корректно (AC-7.1 «светлая/тёмная без пересборки» сохраняется).
- Полировка (по желанию Developer, риска нет): `webapp.setHeaderColor("bg_color")`, `setBackgroundColor`, `setBottomBarColor` при изменении темы.
- Safe area (AC-7.4) — существующие `env(safe-area-inset-bottom)` в `.webapp-tabbar`/`.webapp-content` сохраняются; haptics берутся из уже существующего `haptic` в контексте, обязательны для: выбор слота, отправка брони/заказа, переключение тумблера в Центре, отмена брони, ошибка.

### 8.2 Инвентарь компонентов — `src/components/webapp/ui/`

| Компонент | Назначение |
|---|---|
| `Card.tsx` | контейнер `.tg-card` на `--tg-section-bg`, без градиентов (AC-7.2) |
| `ListItem.tsx` | строка списка: иконка, заголовок, подпись, `right` (chevron/значение/`Toggle`) |
| `SectionHeader.tsx` | заголовок группы в стиле нативного Telegram |
| `Icon.tsx` + `icons.tsx` | **единственный** источник иконографии: `<Icon name="home" />` из закрытого union'а имён, `currentColor`; эмодзи в UI не используются (AC-7.3). Эмодзи из `ROUTING_CATEGORIES`/`ADMIN_SECTIONS` в Mini App не рендерим — маппим ключ → `IconName` |
| `Badge.tsx` | статусы броней/заказов, счётчик непрочитанного |
| `Skeleton.tsx` | загрузка (`.tg-skeleton`), обязателен на ленте, меню кафе, Центре |
| `EmptyState.tsx` | иконка + заголовок + подсказка + опциональное действие (AC-2.3, AC-3.5) |
| `Toggle.tsx` | переключатель для Центра, оптимистичное состояние + откат при ошибке |
| `Button.tsx` | обёртка `.tg-button` (primary/secondary/destructive через токены) |
| `TabBar.tsx` (существующий, переезжает на `buildNavigation`) | динамический состав по роли, иконки из `Icon` |

### 8.3 Вложенные `<html>/<body>` — чиним сейчас

`src/app/webapp/layout.tsx` рендерит `<html><body>` внутри корневого layout'а. Браузер выбрасывает вложенные теги при парсинге, содержимое всплывает в корневой `<body>` — разметка невалидна, гидрация получает mismatch, отсюда «гонка bootstrap» из разведки.

**Вариант A — вынести `/webapp` в собственный root layout через route-группы** (`src/app/(site)/…`, `src/app/(webapp)/…`). Архитектурно правильно, но требует переезда **всех** публичных и админских маршрутов в группу — огромный диф, высокий риск регресса SEO/метаданных при задаче про Mini App. Отклонено.

**Вариант B — nested layout без `html/body`.** `webapp/layout.tsx` рендерит `<div className="webapp-root">…</div>`; `viewport`/`metadata` экспорты остаются (Next поддерживает их во вложенных layout'ах и они переопределяют корневые для этих маршрутов); SDK Telegram подключается обычным `<script async src="https://telegram.org/js/telegram-web-app.js" />` в этом же layout'е.

**Решение — B, в Track B, с явной оценкой риска.** Единственный риск — `next/script strategy="beforeInteractive"` официально поддерживается только в корневом layout'е, поэтому SDK может подгрузиться чуть позже. Он уже нейтрализован: `waitForWebApp` (`src/components/webapp/telegram-bootstrap.ts`) специально написан под позднее появление SDK на iOS/Telegram WebView, а `TelegramProvider` при неудаче деградирует в гостевой режим. QA-проверка обязательна: холодный старт на реальных iOS и Android — авторизация завершается, роль определена.

Вес Mini App при этом **не растёт**: корневой layout (SessionProvider, Метрика, beacon) и сегодня выполняется для `/webapp` — вложенные `html/body` ничего не отсекали.

**AC-7.1 не зависит от исхода этого решения** — мост темы пишет в `document.documentElement`, который существует в любом варианте. Если на приёмке вскроется проблема с загрузкой SDK, откат к нынешней разметке — одна ревертнутая правка в одном файле.

---

## 9. Миграции Prisma (только аддитивные)

```prisma
model OutgoingNotification {
  // …существующие поля…
  readAt DateTime?            // NEW — персональная отметка прочтения (лента)

  @@index([userId, readAt])   // NEW — счётчик непрочитанного
}

model NotificationGlobalPreference {
  // …существующие поля…
  feedSeenAt DateTime?        // NEW — watermark для новостей без персональной строки
}

/// Реестр анонсированных релизов — серверная идемпотентность US-6
/// и одновременно долговечный архив release-notes (git-архив в deploy.yml
/// никогда не работал: пуш в защищённый main всегда отваливался).
model ReleaseAnnouncement {
  version        String   @id           // "2.11.0" — ключ идемпотентности
  commitSha      String
  releaseNotes   String   @db.Text
  announcedAt    DateTime @default(now())
  recipientCount Int      @default(0)
  source         String   @default("deploy")   // deploy | manual
  createdAt      DateTime @default(now())

  @@index([announcedAt])
}
```

**Зачем и `readAt`, и `feedSeenAt` (проверка прогноза из задания).** `readAt` покрывает только персональные строки. Новости парка, которые пользователь видит как `BroadcastCampaign` (потому что персональной копии у него нет — не было канала в момент рассылки), собственной строки не имеют, и без watermark'а остались бы «непрочитанными» навсегда — бейдж не гас бы никогда. `feedSeenAt` на `NotificationGlobalPreference` (таблица принадлежит `notifications`, PK = `userId`, upsert уже есть в `preferences-service.ts`) закрывает это одной колонкой, не трогая `User`.

**Файлы миграций** (две отдельные — чтобы треки B и D шли параллельно и не конфликтовали):

1. `prisma/migrations/20260813120000_webapp_feed_read_state/migration.sql` — 2 × `ADD COLUMN` + 1 × `CREATE INDEX`.
2. `prisma/migrations/20260813130000_release_announcement/migration.sql` — `CREATE TABLE` + два бэкфилл-`INSERT … ON CONFLICT DO NOTHING` из §6.3.

Ни одного `DROP`/`TRUNCATE`/`DELETE FROM`/`ALTER TYPE`/`SET NOT NULL` — авто-мерж-гейт не блокирует. `gen_random_uuid()` доступен в PostgreSQL ≥ 13 без расширений (у нас ≥ 16); при желании — `md5(random()::text || clock_timestamp()::text)`.

---

## 10. Файловый план по трекам

Треки A–D независимы по коду, кроме явно отмеченных точек координации. Порядок старта: **A и D — сразу; B — сразу (начинать с 10.2.1 дизайн-системы); C — после того как A отдаст `loadWebAppStaff`, а B — `ui/`.**

### Точки координации (файлы в двух и более треках)

| Файл | Треки | Правило |
|---|---|---|
| `src/components/webapp/TelegramProvider.tsx` | A (`capabilities` в контексте), B (мост темы) | A первым добавляет поле в интерфейс контекста, B правит только эффект темы. Разные участки файла |
| `src/components/webapp/TabBar.tsx` | A (`buildNavigation`), B (`Icon`, стили) | A меняет источник состава, B — рендер. Мержить A → B |
| `src/app/webapp/profile/page.tsx` | B (редизайн), C (вход в Центр) | B делает редизайн и оставляет слот `profileEntries.map(...)`; C только наполняет |
| `src/modules/notifications/validation.ts` | B (feed-схемы не сюда — см. ниже), C (схема Центра) | Конфликта нет: feed-схемы живут в `src/lib/webapp/validation.ts` |
| `prisma/schema.prisma` | B (`readAt`, `feedSeenAt`), D (`ReleaseAnnouncement`) | Разные модели, разные файлы миграций; конфликт только текстовый |
| `src/modules/notifications/service.ts` | C (путь 2b) | Единственный трек, трогающий файл |
| `src/modules/notifications/events.ts` | D (`system.release`) | Единственный трек |

### 10.1 Track A — auth/безопасность + ролевой bootstrap

| Действие | Файл |
|---|---|
| MOD | `src/lib/webapp-auth.ts` — `getWebAppJwtSecret` (throws), `signWebAppToken`, `loadWebAppStaff`, `WebAppAuthConfigError` |
| MOD | `src/lib/telegram-webapp.ts` — `timingSafeEqual` + проверка формата хэша |
| MOD | `src/app/api/webapp/auth/route.ts` — rate limit, helper подписи, `capabilities` в ответе, 503 при отсутствии секрета |
| MOD | `src/app/api/webapp/link/confirm/route.ts` — убрать локальный `JWT_SECRET`, импорт helper'а |
| NEW | `src/lib/webapp/capabilities.ts` — `getWebAppCapabilities` |
| NEW | `src/lib/webapp/navigation.ts` — `buildNavigation` (чистая функция) |
| NEW | `src/lib/webapp/validation.ts` — `initDataAuthSchema`, `feedQuerySchema`, `feedReadSchema`, `webappOrdersQuerySchema` |
| MOD | `src/components/webapp/TelegramProvider.tsx` — `capabilities` в контексте (координация) |
| MOD | `src/components/webapp/TabBar.tsx` — состав из `buildNavigation`, «Чаты» убран (координация) |
| NEW | тесты: см. §11 |

### 10.2 Track B — дизайн-система + экраны USER (лента, кафе, редизайн)

**10.2.1 Дизайн-система (делать первой — от неё зависят B-экраны и C-UI)**

| Действие | Файл |
|---|---|
| NEW | `src/components/webapp/ui/{Card,ListItem,SectionHeader,Icon,Badge,Skeleton,EmptyState,Toggle,Button}.tsx`, `src/components/webapp/ui/icons.tsx`, `src/components/webapp/ui/index.ts` |
| MOD | `src/components/webapp/TelegramProvider.tsx` — полный мост themeParams → CSS-переменные, класс `dark` на `.webapp-root` (координация) |
| MOD | `src/app/webapp/webapp.css` — 14 токенов + fallback'и, разделители через `var(--tg-separator)`, `.webapp-root.dark …` |
| MOD | `src/app/webapp/layout.tsx` — убрать `<html>/<body>`, обёртка `.webapp-root`, `<script async>` SDK |

**10.2.2 Лента (US-2)**

| Действие | Файл |
|---|---|
| NEW | `src/modules/notifications/feed.ts` — `getWebappFeed`, `markFeedRead`, санитизация URL |
| NEW | `src/app/api/webapp/feed/route.ts` (GET) |
| NEW | `src/app/api/webapp/feed/read/route.ts` (POST) |
| MOD | `prisma/schema.prisma` + `prisma/migrations/20260813120000_webapp_feed_read_state/migration.sql` |
| MOD | `src/app/webapp/page.tsx` — лента + быстрые ссылки (AC-2.5), пустое состояние, никаких карточек без доступа (AC-2.6) |

**10.2.3 Кафе (US-3)**

| Действие | Файл |
|---|---|
| NEW | `src/app/api/webapp/cafe/checkout/route.ts` |
| NEW | `src/app/api/webapp/cafe/orders/route.ts` |
| NEW | `src/app/webapp/cafe/page.tsx` (меню + корзина), `src/app/webapp/cafe/orders/page.tsx` |

**10.2.4 Редизайн существующих экранов (US-4)**

| Действие | Файл |
|---|---|
| MOD | `src/app/webapp/gazebos/page.tsx`, `src/app/webapp/gazebos/[id]/page.tsx` |
| MOD | `src/app/webapp/ps-park/page.tsx`, `src/app/webapp/ps-park/[id]/page.tsx` |
| MOD | `src/app/webapp/bookings/page.tsx` — плюс обработка `402 PENALTY_CONFIRMATION_REQUIRED`: диалог с суммой штрафа → повтор `DELETE` с `confirmPenalty: true` (AC-4.3) |
| MOD | `src/app/webapp/profile/page.tsx`, `src/app/webapp/settings/page.tsx` |
| MOD | `src/components/webapp/{BookingCard,BookingConfirm,ResourceCard,SlotPicker,SuccessScreen}.tsx` — перевод на `ui/`, снятие градиентов |

### 10.3 Track C — Центр уведомлений (API + UI)

| Действие | Файл |
|---|---|
| NEW | `src/modules/notifications/catalog.ts` |
| NEW | `src/modules/notifications/webapp-center.ts` — `getNotificationCenter`, `setEventPreference`, `ensureTelegramChannel` |
| NEW | `src/modules/notifications/subscribers.ts` — `getSelfSubscribedUserIds(eventType, sections)` (общий с §6 резолвер явных подписок) |
| MOD | `src/modules/notifications/validation.ts` — `notificationCenterUpdateSchema` (закрытый `z.enum(MANAGED_EVENT_TYPES)`) |
| MOD | `src/modules/notifications/service.ts` — путь 2b в `notifyAdmin` (пути 1/3 не трогаем) |
| NEW | `src/app/api/webapp/notification-center/route.ts` (GET/PUT) |
| NEW | `src/app/webapp/notifications/page.tsx` — экран Центра |
| MOD | `src/app/webapp/profile/page.tsx` — вход в Центр (координация с B) |

### 10.4 Track D — дедуп релизов + deploy.yml + бот

| Действие | Файл |
|---|---|
| MOD | `src/modules/notifications/release-notify.ts` — `announceRelease`, `resolveReleaseAudience`, `setReleaseSubscription`, `ensureManagerNotifyDefaults`, `getReleaseSubscribers` на новом источнике |
| MOD | `src/modules/notifications/events.ts` — `system.release` |
| MOD | `src/modules/notifications/dispatch/dedup.ts` — entity-scoped allowlist |
| MOD | `src/app/api/admin/release-notify/route.ts` — ответ `{ announced, queued, skippedReason? }` |
| MOD | `prisma/schema.prisma` + `prisma/migrations/20260813130000_release_announcement/migration.sql` (таблица + бэкфилл) |
| MOD | `.github/workflows/deploy.yml` — job `guard`, порядок шагов, `notified`-output, удаление мёртвого guard'а и архивного пуша |
| MOD | `bot/handlers/team-settings.ts` — доступ всем `role !== USER`, тумблер → deep-link в Центр |

### 10.5 Мёртвый код

**Не удаляем** (раздувает диф, PWA явно вне скоупа): `WebappPushOptIn.tsx`, `PWAInstallBanner.tsx`, `bot/handlers/alerts.ts`, `bot/keyboards/gazebos.ts`, страницы `/webapp/messenger/**`, колонка `notifyReleases`.
**Удаляем ровно то, что мешает выполнению AC:** таб «Чаты» из состава навигации (AC-1.4), тумблер релизов в боте (AC-6.4), мёртвый git-guard и архивный пуш в `deploy.yml` (AC-6.1).

### 10.6 Синк документации

В том же PR: строка `notifications` в таблице модулей `CLAUDE.md` дополняется упоминанием Центра уведомлений в Mini App и события `system.release` (правило #4 «CLAUDE.md syncs in the same PR»). Новых модулей нет — таблица модулей иначе не меняется.

---

## 11. Тест-план (Vitest, `vi.mock("@/lib/db")`)

### Track A

**`src/lib/__tests__/webapp-auth.test.ts` (новый)**
- `signWebAppToken` бросает `WebAppAuthConfigError` при пустом/коротком `NEXTAUTH_SECRET`; при валидном — round-trip `sign → verify` возвращает `{ id, telegramId, role }`.
- `verifyWebAppToken`: нет заголовка / не `Bearer` / подменённая подпись / истёкший `exp` → `null`.
- `loadWebAppStaff`: токен валиден, но в БД `role: "USER"` → `{ ok: false, status: 403 }`; пользователь удалён → `403`; битый токен → `401`; MANAGER → `{ ok: true, sections: [...] }` (роль берётся из БД, а не из токена — тест на понижение: в токене `SUPERADMIN`, в БД `USER` → `403`).

**`src/lib/__tests__/telegram-webapp.test.ts` (новый или дополнение)**
- Валидный initData (хэш вычислен тестом от фиктивного `TELEGRAM_BOT_TOKEN`) → распарсен.
- Хэш неверной длины / не hex → `null`, без исключения из `timingSafeEqual`.
- `auth_date` старше часа → `null`. Нет `TELEGRAM_BOT_TOKEN` → `null`.

**`src/app/api/webapp/auth/__tests__/route.test.ts` (новый)**
- `rateLimit` вернул ответ → 429, `validateInitData` не вызывался.
- Нет `NEXTAUTH_SECRET` → 503 `NOT_CONFIGURED`.
- Невалидный initData → 401. Валидный + новый пользователь → 200, `capabilities.isStaff === false`, пустые массивы.
- ADMIN с секциями → `capabilities.staffSections` и `notificationCategories` непустые, `canNotificationCenter === true`.
- SUPERADMIN без `AdminPermission("nedelovoy")` → `nedelovoy` отсутствует в `staffSections` (STRICT_ACCESS).

**`src/lib/webapp/__tests__/navigation.test.ts` (новый)**
- USER: ровно `["/webapp","/webapp/cafe","/webapp/gazebos","/webapp/ps-park","/webapp/bookings","/webapp/profile"]`, `/webapp/messenger` отсутствует.
- MANAGER/ADMIN/SUPERADMIN: тот же список табов + `profileEntries` содержит `/webapp/notifications`.
- `canNotificationCenter === false` (сотрудник без подходящих секций) → входа в Центр нет.

**`src/lib/webapp/__tests__/capabilities.test.ts` (новый)** — USER не делает запросов в БД; MANAGER получает только выданные секции; категории каталога фильтруются по секциям.

### Track B

**`src/modules/notifications/__tests__/feed.test.ts` (новый)**
- Слияние и сортировка по `createdAt desc` из двух источников.
- Две строки `OutgoingNotification` с одинаковым `dedupKey` (fallback-цепочка) → один элемент ленты.
- Кампания, доставленная персонально, не дублируется записью `bc:` .
- Кампания с `segmentKey: "active_office_tenants"` не показывается пользователю без персональной копии; `all_verified_users` — показывается.
- `unreadCount`: персональные с `readAt = null` + кампании новее `feedSeenAt`.
- Пагинация: `cursor` отсекает более старые, `nextCursor` = `createdAt` последнего.
- Санитизация: `javascript:alert(1)` и `tg://` в `actions[].url` вырезаны, `https://` и `/webapp/...` сохранены.
- `markFeedRead({ upTo })` проставляет `readAt` только своим строкам и двигает `feedSeenAt`.

**`src/app/api/webapp/feed/__tests__/route.test.ts` (новый)** — 401 без токена; 200 happy path; `limit=0`/`limit=500` → 422; POST `/read` с чужим `id` не меняет чужие строки.

**`src/app/api/webapp/cafe/__tests__/route.test.ts` (новый)**
- checkout: 401 без токена; 422 на пустых `items`; 201 и `createCheckout` вызван **с `user.id`** (не `null`); `OrderError` → 400 с кодом; `PAYMENT_CONTACT_REQUIRED` → 422.
- orders: 401 без токена; `listOrders` вызван с `{ userId: user.id }`; в ответе нет полей `user.email`/`user.name`.
- Оба — с `vi.mock("@/modules/cafe/service")`: сервисы кафе не меняются и в тестах не исполняются.

### Track C

**`src/modules/notifications/__tests__/catalog.test.ts` (новый)**
- Все `eventType` каталога присутствуют в `EVENT_ROUTING` (защита от опечатки и «мёртвых» тумблеров).
- Все `sections` категорий — валидные `ADMIN_SECTION_SLUGS`.
- В каталоге нет ни одного инфраструктурного/CRITICAL-типа (`health.*`, `site.down`, `system.critical`) — AC-5.7.
- `MANAGED_EVENT_TYPES` без дублей; `categoryForEvent` находит категорию для каждого.

**`src/modules/notifications/__tests__/webapp-center.test.ts` (новый)**
- `role: USER` → отказ. MANAGER с `["gazebos"]` → только категория `bookings`.
- ADMIN и MANAGER с идентичным набором секций получают идентичный результат (AC-5.4).
- Категория `system`: видна SUPERADMIN; видна при секции `monitoring`; не видна MANAGER без неё; **видна** MANAGER без `monitoring`, у которого есть унаследованная строка `system.release` (grandfather).
- SUPERADMIN без гранта `nedelovoy` не видит строго-доступные категории.
- `ensureTelegramChannel`: создаёт при отсутствии; идемпотентен при повторном вызове; проставляет `verifiedAt` при `verifiedAt = null`; **не** реактивирует `isActive = false`; при другом адресе создаёт вторую строку.
- `setEventPreference`: отказ на `eventType` вне каталога; отказ при отсутствии доступа к секции; `system.release` идёт через `setReleaseSubscription`, остальные — через `upsertEventPreference`.

**`src/app/api/webapp/notification-center/__tests__/route.test.ts` (новый)** — GET 401/403/200; PUT 422 (левый `eventType`), 403 (нет секции), 200 + вызов `logAudit`.

**`src/modules/notifications/__tests__/service.test.ts` (дополнение)** — путь 2b: пользователь с явной подпиской и доступом к секции получает `dispatch`; при пустом `notificationRecipients` и настроенном `telegramAdminChatId` групповая отправка (путь 1) сохраняется; без явных строк поведение не изменилось (регресс-тест существующих кейсов).

### Track D

**`src/modules/notifications/__tests__/release-notify.test.ts` (переписать существующий)**
- Первый вызов: создаётся `ReleaseAnnouncement`, `dispatch` вызван по числу подписчиков с `eventType: "system.release"`, `entityId: version`.
- Повтор той же версии: `create` бросает P2002 → `dispatch` **не** вызывается, статус `skipped`, записан `SystemEvent` (AC-6.1/6.2/6.7).
- Ошибка БД, не P2002 → `dispatch` вызван (fail-open), записан `WARNING` (AC-6.6).
- Аудитория: строки `enabled: false` исключены; пользователи `role: USER` исключены; отсутствие строки ≠ подписка.
- `setReleaseSubscription` пишет и `NotificationEventPreference`, и зеркальную `notifyReleases`.
- `ensureManagerNotifyDefaults` не затирает существующую отписку.

**`src/modules/notifications/dispatch/__tests__/dedup.test.ts` (новый или дополнение)**
- `booking.created` + один `entityId`, два разных `body` → одинаковый ключ.
- `messenger.message.received` + один `chatId`, два разных `body` → **разные** ключи (регресс-защита).
- `task.commented` — так же разные.
- Нет `entityId` → поведение как раньше (ключ зависит от payload).
- `system.release` + одна версия → одинаковый ключ.

**`src/app/api/admin/release-notify/__tests__/route.test.ts` (дополнение)** — неверный секрет → 401; успех → `announced: true`; дубль → 200 с `announced: false` (пайплайн должен уметь отличить, чтобы решить про fallback-сообщение).

**`bot/handlers/__tests__/team-settings.test.ts` (дополнение)** — `getTeamUser` пускает ADMIN и MANAGER и SUPERADMIN, отклоняет USER; `/settings` отвечает текстом со ссылкой на Центр; legacy-callback `settings:releases:on` не вызывает запись предпочтения.

**`deploy.yml`** — юнит-тестами не покрывается; QA проверяет на дружественном прогоне: (1) обычный деплой без бампа версии не шлёт анонс повторно; (2) при двойном триггере второй прогон завершается на job `guard`; (3) при отключённом `RELEASE_NOTIFY_SECRET` приходит групповое «Deploy OK».

---

## 12. RBAC и безопасность новых endpoint'ов (сводка)

| Endpoint | Метод | Роли | Проверки | Rate limit | Валидация | Аудит |
|---|---|---|---|---|---|---|
| `/api/webapp/auth` | POST | публичный | HMAC initData (timing-safe), `auth_date` ≤ 1 ч, наличие `NEXTAUTH_SECRET` | `public` (180/мин на IP) | `initDataAuthSchema` | — |
| `/api/webapp/feed` | GET | USER+ (любая) | `verifyWebAppToken`, выборка строго по `userId` | `authenticated` (240/мин на пользователя) | `feedQuerySchema` | — |
| `/api/webapp/feed/read` | POST | USER+ | то же; `updateMany` с `where.userId` | `authenticated` | `feedReadSchema` | — |
| `/api/webapp/cafe/checkout` | POST | USER+ | `verifyWebAppToken` | `authenticated` | `checkoutSchema` (импорт из `cafe/validation`) | `order.create` |
| `/api/webapp/cafe/orders` | GET | USER+ | `verifyWebAppToken`, `listOrders({ userId })` | `authenticated` | `webappOrdersQuerySchema` | — |
| `/api/webapp/notification-center` | GET | MANAGER/ADMIN/SUPERADMIN | `loadWebAppStaff` (роль **из БД**) + `getUserAdminSections` | `authenticated` | — | — |
| `/api/webapp/notification-center` | PUT | те же + доступ к секции категории события | `loadWebAppStaff` + `hasAdminSectionAccess`-эквивалент по каталогу | `authenticated` | `notificationCenterUpdateSchema` (закрытый enum) | `notification.preference.update` |
| `/api/admin/release-notify` | POST | CI по `RELEASE_NOTIFY_SECRET` | без изменений | — | существующая схема | `SystemEvent` |

Формат ошибок — единый: `{ success: false, error: { code, message } }`; коды `UNAUTHORIZED` (401), `FORBIDDEN` (403), `VALIDATION_ERROR` (422), `NOT_FOUND` (404), `RATE_LIMIT_EXCEEDED` (429), `NOT_CONFIGURED` (503), `INTERNAL_ERROR` (500). Ни один новый endpoint не возвращает пароли, токены, внешние id и данные других пользователей. Новых npm-зависимостей и внешних API нет. URL из пользовательского контента (`actions[].url`) санитизируются по протоколу — единственное место, где в Mini App попадает внешний URL.

---

## 13. Последствия и риски

1. **Радиус поражения автопровижининга каналов** (§5, §6.3). Сотрудники получают верифицированный Telegram-канал → становятся достижимы для всех событий `dispatch()`. Затрагивает единицы человек, направление верное; QA следит за объёмом сообщений в первые сутки.
2. **Путь 2b в `notifyAdmin`** — единственное изменение поведения существующей отправки. Защита: пути 1/3 и их условия не тронуты; включается только явной строкой-подпиской, которых в проде сейчас ноль → до первого тумблера поведение идентично сегодняшнему.
3. **Категория «Бронирования» объединяет два парка** — осознанное отступление от формулировки AC-5.1 в пользу честности модели данных (§4). Требует явного «ок» на приёмке.
4. **Grandfather-правило для категории `system`** — согласование AC-5.3 и AC-6.5 (§4). Новых подписчиков не создаёт.
5. **`deploy.yml`** — сценарий «полное молчание о релизе» закрыт трижды: fail-open идемпотентности, fallback-сообщение в группу при неудаче персонального анонса, сохранённый алерт о провале деплоя. Обязателен дружественный прогон до мержа (риск №6 PRD).
6. **Убранный таб «Чаты»** (AC-1.4) — требует подтверждения владельца (риск №4 PRD); код мессенджера остаётся, возврат = одна строка в `navigation.ts`.
7. **Вложенные `html/body`** — чиним (§8.3), риск локализован в одном файле, откат тривиален.
8. **Вес Mini App** (риск №5 PRD): новых зависимостей нет, `ui/`-компоненты бездекорационные, иконки — инлайновые SVG из одного файла; лента и меню грузятся страницами по 20 элементов с keyset-пагинацией.
9. **Отклонено сознательно:** `system.deploy` как отдельный тип, модуль-скоупные `eventType`, флаг `BroadcastCampaign.isPublic`, route-группы для `/webapp`, отдельный `/api/webapp/me`, обёртка над меню кафе — каждое либо расширяет скоуп, либо решает несуществующую проблему.

---

## 14. Чеклист передачи Developer

- [x] ADR зафиксирован; выбраны варианты по каждому спорному пункту с обоснованием
- [x] Схема данных описана (3 аддитивных изменения, 2 файла миграций, SQL бэкфилла приведён)
- [x] API-контракты определены (7 endpoint'ов: request/response/коды ошибок)
- [x] Zod-схемы размечены (`initDataAuthSchema`, `feedQuerySchema`, `feedReadSchema`, `webappOrdersQuerySchema`, `notificationCenterUpdateSchema`, переиспользуемый `checkoutSchema`)
- [x] RBAC расписан по каждому endpoint'у (роли, ре-чек из БД, rate limit, аудит)
- [x] Влияние на существующие модули оценено (`notifications`: `service.ts`, `dedup.ts`, `events.ts`, `release-notify.ts`; `cafe`/`gazebos`/`ps-park` — только чтение публичных интерфейсов)
- [x] Миграция данных описана (`notifyReleases` → `NotificationEventPreference` + каналы, 1:1, в SQL миграции)
- [x] Тест-план по трекам и файлам
- [x] Границы PRD соблюдены: новых модулей нет, `service.ts`/`validation.ts` кафе и парков не редактируются, миграции аддитивные

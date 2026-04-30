# ADR 2026-04-30 — Reverse Telegram deep-link login (bot → web)

- **Status:** Accepted
- **Date:** 2026-04-30
- **Owners:** System Architect, Auth module
- **Related:** ADR 2026-04-27 (web → bot deep-link, Wave 2), `src/modules/auth/telegram-deep-link.ts`, `bot/handlers/auth-deeplink.ts`, `src/lib/auth.ts` (`telegram-token` credentials provider)

---

## 1. Context

Сегодня в платформе работает **симметричный** flow «web → bot»:

1. Пользователь на сайте жмёт «Войти через Telegram».
2. `/api/auth/telegram/start` минтит токен, сохраняет в Redis (PENDING), отдаёт ссылку `t.me/<bot>?start=auth_<token>`.
3. Пользователь в боте делится контактом → бот находит/создаёт `User`, привязывает `UserNotificationChannel(TELEGRAM)`, флипает токен в CONFIRMED.
4. Фронт поллит `/api/auth/telegram/status`, получает one-time JWT и сайнинится через `signIn("telegram-token", ...)`.

**Чего не хватает.** Returning-юзер уже имеет `User.telegramId` в БД. Когда он пишет боту `/start` (без deep-link), у него нет UX-маршрута «открыть сайт и оказаться залогиненным». Сейчас бот в ответ на `/start` шлёт обычную ссылку на `APP_URL`, где юзер либо видит публичную страницу, либо обязан повторно пройти flow (включая повторное `requestContact`). Это лишнее трение, особенно для ежедневных сценариев (заказ кофе, бронь беседки).

**Цель.** Дать уже существующему (telegramId-bound) юзеру кнопку «🌐 Открыть сайт» в ответе бота, по которой он попадает на сайт **уже в активной NextAuth-сессии**, без request_contact и без ввода email.

**Вне scope.**
- Auto-onboard нового юзера через `/start` без deep-link — отдельный PRD.
- Mini App auto-login — уже работает через `/api/webapp/auth` (initData-based).

---

## 2. Decision

### 2.1 Выбранный механизм защиты: **internal endpoint + shared secret (`BOT_INTERNAL_SECRET`)**

Из двух предложенных вариантов выбран **shared-secret вариант**, не подписанный JWT.

**Обоснование.**

| Критерий | Shared secret (выбран) | Bot-signed JWT |
|----------|------------------------|----------------|
| Trust boundary | Бот = доверенный клиент сервера. Один secret в env. | Тот же — secret = bot token. Никакого выигрыша в trust. |
| Сложность | `Authorization: Bearer $BOT_INTERNAL_SECRET` + constant-time compare. | HMAC sign/verify, JWT parsing, edge cases с clock skew. |
| Rotation | Заменить env-переменную в двух процессах (web + bot). | То же. |
| Тестируемость | Stub fetch / inject secret. | Нужно мокать crypto. |
| Соответствие коду | Бот уже шарит DB и Redis с web — ещё один env-secret консистентен. | Усложняет архитектуру без эквивалентного выигрыша. |

Бот и Next.js крутятся в одном `docker-compose`, в одной trust-boundary; внешним миром этот endpoint не доступен (см. §6 — `internal` mount path + IP allow-list на nginx). JWT-подпись была бы оправдана, если бы бот хостился отдельно за публичной сетью, — это не наш случай.

### 2.2 High-level flow

```
[bot] /start  (без deep-link)
   │
   │ ctx.from.id = 12345
   ├─► prisma.user.findUnique({ telegramId: "12345", mergedIntoUserId: null })
   │      └── если нет — обычный APP_URL (out of scope)
   │
   ├─► POST /api/internal/auth/bot-login-token
   │      Authorization: Bearer $BOT_INTERNAL_SECRET
   │      body: { telegramId: "12345", chatId: "12345" }
   │      ◄── { token, expiresAt }
   │
   └─► reply: InlineKeyboard().url("🌐 Открыть сайт",
                  `${APP_URL}/auth/tg-callback?token=${token}`)

[browser] клик по URL-кнопке
   │
   ├─► GET /auth/tg-callback?token=…
   │      page.tsx (server component) → POST /api/auth/telegram/bot-callback
   │      ◄── one-time JWT (тот же формат, что у Wave 2 status endpoint)
   │
   ├─► client-side signIn("telegram-token", { oneTimeCode: jwt, redirect: false })
   │
   └─► redirect → /profile (или ?next=… если был валидный возврат)
```

Ключевая идея: переиспользуем уже существующий `telegram-token` Credentials provider (`src/lib/auth.ts:253`). Никаких новых auth-провайдеров, никаких новых модулей.

---

## 3. API contract

### 3.1 `POST /api/internal/auth/bot-login-token` (новый)

**Назначение.** Бот просит сервер сминтить bot→web login token для уже идентифицированного юзера.

**Доступ.**
- НЕ публичный. Mounted под `/api/internal/*` — nginx режет по IP allow-list (loopback + docker network).
- RBAC: специальный path-prefix middleware проверяет `Authorization: Bearer ${BOT_INTERNAL_SECRET}` через `crypto.timingSafeEqual`. Никакая роль User/Manager/Superadmin не имеет доступа — это server-to-server.
- Не имеет ничего общего с `hasModuleAccess(...)` — это не модульный API.

**Rate limit.**
- Sliding window в Redis: `auth:tg:botlogin:rl:<telegramId>` — **10 req / 60s** на telegramId.
- Глобальный fuse: `auth:tg:botlogin:rl:global` — **600 req / 60s** (защита от стампида при компрометации secret).
- Превышение → `429 RATE_LIMITED` с `retryAfterSec`.

**Request:**
```json
{
  "telegramId": "12345",
  "chatId": "12345"
}
```
Валидация (Zod):
- `telegramId`: `string().regex(/^\d{5,15}$/)`
- `chatId`: `string().regex(/^-?\d{5,15}$/)`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "token": "Hs7…22 chars base64url",
    "expiresAt": "2026-04-30T12:05:00.000Z",
    "callbackUrl": "https://delovoy-park.ru/auth/tg-callback?token=Hs7…"
  }
}
```

**Errors:**
| HTTP | Code | When |
|------|------|------|
| 401 | `UNAUTHORIZED` | Missing/incorrect Bearer secret. Тело: `{ error: { code, message } }`. |
| 400 | `VALIDATION_ERROR` | telegramId/chatId не прошли регекс. |
| 404 | `USER_NOT_FOUND` | Нет `User` с таким `telegramId` (или он `mergedIntoUserId != null`). Бот этот код интерпретирует как «отдай обычный APP_URL без auto-login». |
| 403 | `ADMIN_NO_BOT_LOGIN` | Совпавший пользователь имеет `role !== "USER"` — админ через бот логиниться не может (уже action-paritет с web→bot flow, см. `auth-deeplink.ts:203`). |
| 429 | `RATE_LIMITED` | Per-tg или global rate limit. |
| 503 | `REDIS_UNAVAILABLE` | Без Redis нельзя гарантировать одноразовость. Fail closed. |

**НЕ логируем:** raw `chatId`, raw `telegramId` в `metadata`. Используем `maskChatId` (уже есть в `src/lib/audit.ts`).

**Логируем (`AuditLog`):**
- `auth.bot_login.token_minted` — `{ provider: "telegram-token", method: "bot-deeplink", chatIdMasked, ipHash: null }`
- `auth.bot_login.admin_blocked` — для попыток с `role !== "USER"`
- `auth.bot_login.user_not_found` — только в SystemEvent (INFO), не в AuditLog (некому привязать).

### 3.2 `GET /auth/tg-callback?token=…` (новая страница)

**Файл:** `src/app/auth/tg-callback/page.tsx` (Server Component) + клиентский child для `signIn`.

**Поведение.**
1. Получает `token` из query.
2. Server-side вызывает internal-helper `consumeBotLoginToken(token)` (см. §4) — флипает PENDING → CONSUMED, возвращает `{ userId }`.
3. Если токен невалиден/expired/уже consumed → `redirect("/auth/signin?error=tg_link_expired")`.
4. Серверно минтит one-time JWT (так же, как делает `/api/auth/telegram/status` — переиспользуем helper).
5. Передаёт JWT в child-client component, который вызывает `signIn("telegram-token", { oneTimeCode: jwt, redirect: false })` и далее `router.push(next ?? "/profile")`.

**Edge: уже залогинен под другим аккаунтом.**
- Сервер на этапе page получает текущую `auth()`-сессию.
- Если `session.user.id !== tokenEntry.userId` — НЕ выполняем silent re-login. Рендерим Confirmation UI: «Вы вошли как X. Продолжить как Y?» с двумя кнопками:
  - «Продолжить как Y» → POST `/api/auth/signout` (без redirect) → signIn(...).
  - «Остаться как X» → консумим токен (он одноразовый) и редирект в `/profile`.
- Если `session.user.id === tokenEntry.userId` — токен консумим, редирект в `/profile`. Никаких лишних JWT.

**Edge: токен кликнут дважды.**
- Первый клик: PENDING → CONSUMED. Второй клик: `consumeBotLoginToken` вернёт null → редирект на `/auth/signin?error=tg_link_used`.
- Двойной клик в одной вкладке (refresh) тоже отрабатывает корректно: после `signIn` редирект уводит, refresh старого URL уже падает в `?error=tg_link_used`.

---

## 4. Storage schema (Redis)

Расширяем `src/modules/auth/telegram-deep-link.ts` — без нового модуля.

### 4.1 Новые ключи

| Key | Value (JSON) | TTL | Purpose |
|-----|--------------|-----|---------|
| `auth:tg:bot-login:<token>` | `{ status: "PENDING"\|"CONSUMED", createdAt, userId, telegramIdHash, consumedAt? }` | 300s (PENDING) / 60s (CONSUMED) | Bot-minted reverse login token. |
| `auth:tg:botlogin:rl:<telegramId>` | counter | 60s | Per-tg rate limit. |
| `auth:tg:botlogin:rl:global` | counter | 60s | Global stampede fuse. |

**Discriminator:** ключи начинаются с `auth:tg:bot-login:`, что отличает их от `auth:tg:token:` (web→bot). Это критично — путать namespace нельзя, иначе атакующий может попытаться сконсумить чужой токен через противоположный endpoint.

### 4.2 Новые функции в `telegram-deep-link.ts`

```ts
// Все три — продолжение существующих паттернов файла.

export const BOT_LOGIN_TOKEN_PREFIX = "auth:tg:bot-login:";
export const BOT_LOGIN_TTL_SECONDS = 300;
export const BOT_LOGIN_CONSUMED_TTL_SECONDS = 60;

export type BotLoginTokenEntry = {
  status: "PENDING" | "CONSUMED";
  createdAt: string;
  userId: string;
  telegramIdHash: string;     // SHA256(telegramId) — для аудита без PII
  consumedAt?: string;
};

export async function createBotLoginToken(args: {
  userId: string;
  telegramId: string;
}): Promise<{ token: string; expiresAt: string }>;

export async function readBotLoginToken(
  token: string
): Promise<BotLoginTokenEntry | null>;

export async function consumeBotLoginToken(
  token: string
): Promise<{ userId: string } | null>;
```

`consumeBotLoginToken` — атомарная операция: read → check status === "PENDING" → write CONSUMED. Гонка возможна (два параллельных клика), парируется тем же приёмом, что в `consumeConfirmedToken`: статус-машина строго монотонна, повторный вход в `consume` вернёт null. Это слабее, чем Lua-script, но достаточно — и совпадает со стилем существующего кода.

### 4.3 Reuse: one-time JWT minting

Не дублируем код. Вынесем существующий блок «mint one-time JWT» из `/api/auth/telegram/status` в `src/modules/auth/telegram-deep-link.ts` как `mintOneTimeJwt(userId)`. После этого:
- Status endpoint вызывает `mintOneTimeJwt`.
- tg-callback вызывает `mintOneTimeJwt`.
- `JTI_PREFIX` дедупликация — в одном месте.

---

## 5. Файлы: что трогаем, что создаём

### Новые файлы
- `src/app/api/internal/auth/bot-login-token/route.ts` — POST handler (§3.1).
- `src/app/auth/tg-callback/page.tsx` — server component (§3.2).
- `src/app/auth/tg-callback/CallbackClient.tsx` — клиентский `signIn` wrapper.
- `src/modules/auth/__tests__/bot-login-token.test.ts` — unit-тесты helpers.
- `src/app/api/internal/auth/bot-login-token/__tests__/route.test.ts` — integration tests.
- `src/app/auth/tg-callback/__tests__/page.test.tsx` — render + redirect tests.

### Расширяемые файлы
- `src/modules/auth/telegram-deep-link.ts` — функции `createBotLoginToken`, `readBotLoginToken`, `consumeBotLoginToken`, `mintOneTimeJwt`. Никакие существующие функции не меняют сигнатуры — чисто аддитивно.
- `bot/handlers/start.ts` (или существующий `/start` без deep-link handler) — после resolving `User` по `ctx.from.id` зовём internal endpoint и формируем `InlineKeyboard().url(...)`.
- `src/lib/audit.ts` — добавить новые action constants `auth.bot_login.token_minted`, `auth.bot_login.consumed`, `auth.bot_login.admin_blocked`, `auth.bot_login.session_conflict`.
- `.env.example` — добавить `BOT_INTERNAL_SECRET=` (с комментарием «32+ random bytes, must match across web and bot containers»).

### НЕ создаём
- `src/modules/bot-login/`, `src/modules/auth-bot/` — scope guard (CLAUDE.md). Это естественное расширение `auth`.
- Новой записи в таблице `Module` — фича не имеет UI-панели менеджера.
- Новых Prisma-моделей — всё помещается в Redis + `AuditLog`.

---

## 6. Безопасность

### 6.1 Trust model

Атакующий A с украденным `BOT_INTERNAL_SECRET` + знанием чьего-то `telegramId` может сминтить токен и зайти как этот юзер. Это **известный риск** shared-secret подхода и **тот же риск**, что был бы у JWT-варианта (там secret = bot token, его компрометация даёт ту же возможность). Mitigations:

1. **Network isolation.** Endpoint смонтирован на `/api/internal/*`. nginx-конфиг режет по source IP — допускается только loopback + docker bridge subnet. Внешний запрос к `/api/internal/auth/bot-login-token` получит 404 от nginx, не достигнув Next.js.
2. **Rate limit** (см. §3.1): per-telegramId 10/min блокирует массовый перебор; global 600/min ограничивает blast radius при leak'е secret'а.
3. **AuditLog.** Каждый минт пишется в `AuditLog` с `chatIdMasked`. Аномалия (тот же telegramId 10 раз за минуту, разные telegramId 100 раз за минуту) детектится как отклонение от baseline → Telegram-алерт SUPERADMIN'у. Конкретные пороги — в Phase 5.3 (дашборд владельца).
4. **Admin guard.** Бот→web login блокируется для `role !== "USER"` (паритет с существующим web→bot flow, см. `auth-deeplink.ts:203`). Администратор не может быть сайнин'нут через бот ни в одну сторону.
5. **Secret rotation.** При подозрении на компрометацию: сгенерировать новый `BOT_INTERNAL_SECRET`, обновить env в обоих контейнерах, `docker compose up -d`. Все in-flight токены работают (они не зависят от secret), новые requests отвергаются до синхронизации.
6. **One-time JWT TTL = 30s** — даже если callback URL украли (например, через Referer leak), окно атаки минимально.

### 6.2 CSRF / replay

- Токен одноразовый (PENDING → CONSUMED, монотонно).
- TTL 5 минут на PENDING.
- One-time JWT TTL 30s + jti dedup в Redis (`reserveJti`).
- Callback page использует `<a href>` / inline keyboard URL — это GET. CSRF неприменим: токен не несёт чьих-то prior-credentials (нет cookie-side-effect до `signIn`), а сам `signIn("telegram-token", ...)` идёт через NextAuth с встроенной CSRF-защитой.

### 6.3 Что НЕ логируем

- Raw `chatId`, raw `telegramId` — только `maskChatId(...)` и `sha256(telegramId).slice(0,8)`.
- Сам `token` (он = capability).
- Тело one-time JWT и его jti (логируем только факт `auth.signin.success` через стандартный pipeline NextAuth).

### 6.4 Validated fields / error format

Все 4xx ответы соответствуют общему контракту (`apiError`):
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "telegramId must be 5-15 digits" } }
```

---

## 7. Migrations

Никаких Prisma-миграций. `AuditLog` уже существует, `SystemEvent` уже существует. Все runtime-изменения — Redis-only.

Деплой:
1. Сгенерировать `BOT_INTERNAL_SECRET` (32 bytes hex).
2. Прописать в `.env` web и bot контейнеров (одинаковое значение).
3. Обновить nginx-конфиг (allow-list для `/api/internal/`).
4. `docker compose up -d`.

---

## 8. Test plan

### 8.1 Unit (`src/modules/auth/__tests__/bot-login-token.test.ts`)
- `createBotLoginToken` пишет PENDING с правильным TTL.
- `readBotLoginToken` корректно парсит и возвращает null при corrupted JSON.
- `consumeBotLoginToken`: PENDING → CONSUMED → второй вызов возвращает null.
- `consumeBotLoginToken` для несуществующего токена → null.
- TTL после consume — 60s, не 300s.
- `mintOneTimeJwt` — единый helper, тот же jti dedup.

### 8.2 Integration (`/api/internal/auth/bot-login-token/__tests__`)
- 401 без `Authorization` header.
- 401 с неверным secret (timing-safe).
- 400 при невалидном `telegramId` (буквы, слишком длинный).
- 404 для несуществующего telegramId.
- 404 для merged юзера (`mergedIntoUserId != null`).
- 403 для MANAGER/SUPERADMIN.
- 200 happy path: токен в Redis, AuditLog создан, response shape корректен.
- 429 при превышении 10/min на один telegramId.
- 429 при превышении 600/min global.
- 503 при недоступном Redis.

### 8.3 Page (`/auth/tg-callback/__tests__/page.test.tsx`)
- Redirect в `/auth/signin?error=tg_link_expired` для невалидного токена.
- Redirect в `/auth/signin?error=tg_link_used` для уже consumed токена.
- Happy path: рендер CallbackClient с JWT, signIn → redirect в `/profile`.
- Session-conflict: текущая сессия принадлежит другому userId → рендер Confirmation UI, не silent re-login.
- AuditLog `auth.bot_login.consumed` записан.

### 8.4 Bot handler
- Юзер с `User.telegramId` совпадающим — бот зовёт internal API, формирует InlineKeyboard.url.
- Юзер без записи в БД — бот шлёт обычный APP_URL без токена (in-band fallback).
- Internal API недоступен (network) — graceful degradation: APP_URL без токена + SystemEvent WARNING.

### 8.5 E2E (manual smoke на staging)
1. Залогиниться через web→bot flow (Wave 2), создать сессию.
2. Logout с web.
3. Написать боту `/start` → нажать «🌐 Открыть сайт» → сразу попасть в `/profile`.
4. Кликнуть тот же URL ещё раз → увидеть `tg_link_used`.
5. Залогиниться под другим юзером в браузере → кликнуть кнопку из бота юзера-1 → увидеть Confirmation UI.

---

## 9. Rollout

**Feature flag не требуется.** Фича аддитивна:
- Новый internal endpoint никем не вызывается до изменения бота.
- Новая страница `/auth/tg-callback` не достижима без токена.
- Изменение `bot/handlers/start.ts` — единственная точка переключения. Можно выкатывать прогрессивно: сначала backend (PR 1), потом bot-side (PR 2). После PR 1 фича spi-доступна вручную (devs); пользовательский UX появляется только с PR 2.

**Rollback:** revert PR 2 (bot-side). Backend остаётся, не вредит.

**Operational checklist:**
- [ ] `BOT_INTERNAL_SECRET` сгенерирован и проброшен в оба контейнера.
- [ ] nginx allow-list для `/api/internal/` обновлён.
- [ ] `npm test` зелёный.
- [ ] Smoke на staging пройден (см. §8.5).
- [ ] AuditLog dashboard показывает `auth.bot_login.token_minted` после первого реального клика.

---

## 10. Альтернативы (rejected)

### 10.1 Bot-signed JWT
HMAC от bot token + telegramId + nonce + exp, верификация на web-side. Отвергнут: не даёт большего trust (secret = bot token, его утечка эквивалентна утечке `BOT_INTERNAL_SECRET`), но добавляет crypto boilerplate, complicating tests.

### 10.2 Telegram Login Widget redirect
Бот шлёт URL на login-widget callback. Отвергнут: widget — браузерный, требует interaction; ломает «один тап в боте → залогинен».

### 10.3 Mini App вместо callback page
Открыть Mini App, который через `initData` сразу логинит. Отвергнут: уже работает (`/api/webapp/auth`), это **другой канал** (Mini App ≠ web). Задача в этом ADR — именно открытие **внешнего браузера** с активной web-сессией, например, чтобы юзер мог пользоваться парой клавиатура+большой экран на компьютере.

---

## 11. References

- ADR 2026-04-27 §1 — симметричный web→bot flow (Wave 2). Этот ADR — зеркальная половина.
- `src/modules/auth/telegram-deep-link.ts` — паттерны Redis state machine, JTI dedup, rate limit.
- `bot/handlers/auth-deeplink.ts` — admin-block guard (`ADMIN_NO_BOT_LOGIN`), masked logging.
- `src/lib/auth.ts:253` — `telegram-token` Credentials provider, переиспользуется без изменений.
- `src/app/api/webapp/auth/route.ts` — Mini App `initData` flow (для контраста: тот канал не пересекается с этим).
- CLAUDE.md §«Scope guard» — обоснование, почему расширяем `auth`, а не создаём новый модуль.
- `agents/SECURITY.md` — RBAC + audit logging baseline.

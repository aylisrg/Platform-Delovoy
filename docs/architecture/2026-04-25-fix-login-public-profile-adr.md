# ADR: Fix-login + cabinet visibility

**ADR-ID:** 2026-04-25-fix-login-public-profile
**RUN_ID:** 2026-04-25-fix-login-public-profile
**Дата:** 2026-04-25
**Автор:** CTO (system-architect subagent упал по timeout, ADR пишет координатор)
**Статус:** Принят, передаётся Senior Dev

---

## 1. Контекст

См. PRD `docs/requirements/2026-04-25-fix-login-public-profile-prd.md`.

Две проблемы:

1. **Magic-link принимает userId без верификации одноразового токена** (`src/lib/auth.ts:314-329`).
2. **Личный кабинет `/dashboard` существует, но USER туда не попадает** — `redirectAfterLogin` ведёт на `/`, и публичной ссылки нет.

## 2. Решение US-1: магическая ссылка через одноразовый Redis-nonce

### 2.1 Новый поток

```
1. POST /api/auth/email/send → создаёт VerificationToken (15 мин TTL) + email — без изменений.
2. GET /api/auth/verify-email?token=&email= → старая логика VerificationToken, но
   ВМЕСТО редиректа на ?magic=<userId> теперь:
     a) generateAndStoreSignInNonce(userId): nonce = randomBytes(32).hex(),
        Redis SET "magic-link:signin:<nonce>" = userId, EX 300 (5 минут).
     b) redirect to /auth/signin?magic=<nonce>
3. /auth/signin?magic=<nonce> → клиент вызывает signIn("magic-link", { nonce }).
4. Credentials("magic-link").authorize({ nonce }):
     a) Если Redis недоступен → return null (fail-closed).
     b) GETDEL "magic-link:signin:<nonce>" — атомарно прочитать-и-удалить.
     c) Если нет значения — return null (токен невалиден или уже использован).
     d) findUnique({ id: userId }), вернуть user или null.
```

### 2.2 Файлы и изменения

#### `src/modules/auth/email-magic-link.service.ts`

Добавить:

```ts
const MAGIC_LINK_SIGNIN_PREFIX = "magic-link:signin:";
const SIGNIN_NONCE_TTL_SECONDS = 5 * 60;

/**
 * Generate one-time signin nonce, store userId under it in Redis.
 * Throws Error("REDIS_UNAVAILABLE") if Redis is down — fail-closed.
 */
export async function generateSignInNonce(userId: string): Promise<string> {
  if (!redisAvailable) throw new Error("REDIS_UNAVAILABLE");
  const nonce = crypto.randomBytes(32).toString("hex");
  await redis.set(MAGIC_LINK_SIGNIN_PREFIX + nonce, userId, "EX", SIGNIN_NONCE_TTL_SECONDS);
  return nonce;
}

/**
 * Atomically consume a signin nonce. Returns userId on success, null otherwise.
 * Returns null when Redis is unavailable (fail-closed).
 */
export async function consumeSignInNonce(nonce: string): Promise<string | null> {
  if (!redisAvailable) return null;
  // ioredis exposes GETDEL via .getdel
  const userId = await redis.getdel(MAGIC_LINK_SIGNIN_PREFIX + nonce);
  return userId ?? null;
}
```

`verifyMagicLink` остаётся без изменений (всё ещё инвалидирует VerificationToken). Добавляется новый возврат не требуется — caller сам вызовет `generateSignInNonce`.

#### `src/app/api/auth/verify-email/route.ts`

Заменить:

```ts
const { userId } = await verifyMagicLink(token, email);
return NextResponse.redirect(`${appUrl}/auth/signin?magic=${encodeURIComponent(userId)}`);
```

На:

```ts
const { userId } = await verifyMagicLink(token, email);
let nonce: string;
try {
  nonce = await generateSignInNonce(userId);
} catch {
  // Redis down — user must retry. Surface a recognisable error.
  return NextResponse.redirect(`${appUrl}/auth/signin?error=link-expired`);
}
return NextResponse.redirect(`${appUrl}/auth/signin?magic=${encodeURIComponent(nonce)}`);
```

#### `src/lib/auth.ts:314-329` — Credentials("magic-link")

Заменить полностью:

```ts
Credentials({
  id: "magic-link",
  name: "Magic Link",
  credentials: {
    nonce: { type: "text" },
  },
  async authorize(credentials) {
    if (!credentials?.nonce || typeof credentials.nonce !== "string") return null;
    const userId = await consumeSignInNonce(credentials.nonce);
    if (!userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user;
  },
}),
```

Импорт `consumeSignInNonce` из `@/modules/auth/email-magic-link.service`.

#### `src/app/auth/signin/page.tsx:95-113`

Заменить параметр в `signIn`:

```ts
// Было: signIn("magic-link", { userId: magicUserId, redirect: false })
// Станет:
signIn("magic-link", { nonce: magicNonce, redirect: false }).then(...)
```

Соответственно — переименовать локальную переменную с `magicUserId` на `magicNonce` для ясности.

### 2.3 Fail-closed обоснование

При `REDIS_UNAVAILABLE` любой magic-link перестаёт работать. Это приемлемо: остальные провайдеры (telegram, yandex, google, vk, password) работают независимо от Redis. Безопасность важнее аптайма одного канала входа.

### 2.4 Обратная совместимость

- JWT-сессии (`session: { strategy: "jwt" }`) не зависят от формата magic-link → активные сессии не ломаются.
- Старые письма с `?token=...` продолжают работать: `verify-email` route обрабатывает их как раньше, только редирект теперь содержит nonce, а не userId.

## 3. Решение US-2: видимость существующего `/dashboard`

### 3.1 `src/app/auth/signin/page.tsx:78-87` — `redirectAfterLogin`

Изменить one line:

```ts
// Было: } else { window.location.href = "/"; }
// Станет: } else { window.location.href = "/dashboard"; }
```

USER теперь оказывается на `/dashboard` после любого успешного логина (включая magic-link, который вызывает `redirectAfterLogin` после `signIn` ok).

### 3.2 Главная страница — ссылка на кабинет

В `src/app/(public)/page.tsx` (или существующий header-компонент в публичной части) добавить server-side проверку сессии и условный рендер:

- Гость → "Войти" → `/auth/signin`
- Авторизованный USER → "Личный кабинет" → `/dashboard`
- Авторизованный SUPERADMIN/ADMIN/MANAGER → "Админка" → `/admin/dashboard`

Минимально-инвазивно: если на главной нет header'a — добавить точечно. Если есть — модифицировать существующий блок auth-кнопок. Senior Dev пусть выберет менее затратный путь.

### 3.3 ContactsCard.tsx и yandex callbackUrl

В `src/components/public/profile/contacts-card.tsx:357` уже стоит `signIn("yandex", { callbackUrl: "/dashboard" })` — менять не нужно.

## 4. Тесты (обязательны вместе с кодом)

| Файл | Что проверяет |
|------|---------------|
| `src/modules/auth/__tests__/email-magic-link.service.test.ts` | (новый блок) `generateSignInNonce` создаёт ключ с TTL; `consumeSignInNonce` возвращает userId и удаляет ключ; повторный consume → null; nonce неизвестного формата → null; Redis недоступен → `consumeSignInNonce` возвращает null. |
| `src/lib/__tests__/auth.test.ts` (новый файл, если нет) | `Credentials("magic-link").authorize`: без nonce → null; невалидный nonce → null; валидный nonce → user; повторный вызов с тем же nonce → null. |
| `src/app/api/auth/verify-email/__tests__/route.test.ts` (новый, если нет) | Happy path: token валиден → редирект на `/auth/signin?magic=<X>`, где X **не** userId (по длине ≥ 64 hex). Token невалиден → редирект с `?error=invalid-link`. Token истёк → `?error=link-expired`. Redis down → `?error=link-expired`. |
| Юнит-тест на `redirectAfterLogin` или e2e-снапшот | После `signIn` для USER role клиент идёт на `/dashboard`, для админа — на `/admin/dashboard`. |

Тесты пишутся **рядом с кодом** в том же коммите. Моки: `vi.mock('@/lib/db')`, `vi.mock('@/lib/redis')`.

## 5. Риски и обходные пути

| Риск | Mitigation |
|------|------------|
| Redis перезапустился между verify-email и signIn | Юзер видит `link-expired`, запрашивает новую ссылку. Документировано в UX. |
| Старая ссылка (с userId) в почте у юзера, подосланная до релиза | Verify-email route больше не возвращает userId-ссылку. Если юзер кликнет старую — путь по-прежнему через verify-email (не по signin?magic=userId напрямую), значит автоматически апгрейдится в новый формат. **Опасности нет**, поскольку поверхность атаки была именно в `?magic=<userId>` URL — туда теперь приходит nonce. |
| Одновременно открытые две вкладки с одним nonce | Кто первый сделал signIn — получит сессию, второй — `null` (атомарность через GETDEL). По UX: вторая вкладка покажет "Ссылка недействительна". Принимаем — это редкий edge case. |

## 6. Что НЕ делаем (фиксируем для Reviewer)

- Не трогаем `prisma/schema.prisma`.
- Не добавляем `src/middleware.ts`.
- Не создаём новый модуль в `src/modules/`.
- Не меняем формат `apiResponse`/`apiError`.
- Не трогаем `/webapp/profile`.
- Не трогаем других провайдеров (telegram, yandex, google, vk, credentials).
- Не добавляем новые npm-зависимости.
- Не создаём дублирующую страницу `/profile` — она была бы scope creep, см. CTO-revision в PRD.

## 7. Чеклист для Senior Dev (порядок реализации)

1. `src/modules/auth/email-magic-link.service.ts`: добавить `generateSignInNonce`, `consumeSignInNonce`, константы.
2. `src/modules/auth/__tests__/email-magic-link.service.test.ts`: тесты для новых функций.
3. `src/app/api/auth/verify-email/route.ts`: переключить redirect на nonce + обработка `REDIS_UNAVAILABLE`.
4. `src/app/api/auth/verify-email/__tests__/route.test.ts`: тесты (если файла нет — создать).
5. `src/lib/auth.ts`: переписать `Credentials("magic-link")`.
6. `src/lib/__tests__/auth.test.ts`: тесты authorize() (если файла нет — создать).
7. `src/app/auth/signin/page.tsx`: переименовать локально `magicUserId` → `magicNonce`, поменять `redirectAfterLogin` для USER на `/dashboard`.
8. `src/app/(public)/page.tsx` (или header-компонент): server-side `auth()` + условная кнопка "Личный кабинет".
9. `npm test` — должно остаться зелёное (1611+ тестов).
10. `npm run lint` — без новых проблем.
11. `npx tsc --noEmit` — без ошибок.

После каждого шага — **коммит**. Conventional commits:
- `fix(auth): magic-link signin nonce instead of bare userId redirect (security)`
- `feat(public): show "Личный кабинет" link for authenticated USER`
- `fix(auth): redirect USER to /dashboard after sign-in`

Reviewer и QA в финале — после всех коммитов.

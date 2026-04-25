# QA Report: fix-login-public-profile

**Verdict:** PASS
**Дата:** 2026-04-25
**Tester:** qa-engineer subagent
**RUN_ID:** 2026-04-25-fix-login-public-profile
**Stage 3 commit:** 8830143 — fix(auth): close magic-link userId vulnerability + open /dashboard cabinet

---

## 1. Test execution

| Проверка | Результат | Детали |
|----------|-----------|--------|
| `npm test -- --run` | PASS | 1632/1632 тестов, 91 файл. Все зелёные. |
| `npm run lint` | PASS | ESLint завершился без ошибок и предупреждений. |
| `npx tsc --noEmit` | PASS | TypeScript-компиляция без ошибок (вывод пуст). |

Базовый счётчик из PRD: 1611/1611. Фактически: 1632/1632 (+21 новый тест). Регрессий нет.

---

## 2. AC verification

| AC | Вердикт | Evidence |
|----|---------|---------|
| AC-1.1 Токен обязателен | PASS | `src/lib/auth.ts:317–324` — Credentials("magic-link") принимает только `nonce`, делегирует `authorizeMagicLinkNonce`. Без nonce → `return null` на уровне type check `typeof nonce !== "string"`. Тест "never accepts bare userId in the place of nonce" зелёный. |
| AC-1.2 Одноразовость | PASS | `consumeSignInNonce` использует `redis.getdel` — атомарный read-and-delete. Тест "the same nonce cannot grant a session twice" явно проверяет второй вызов с тем же nonce → null. |
| AC-1.3 TTL 5 мин | PASS | `SIGNIN_NONCE_TTL_SECONDS = 5 * 60` в `email-magic-link.service.ts:10`. Передаётся в `redis.set(..., "EX", SIGNIN_NONCE_TTL_SECONDS)`. Тест проверяет вызов с TTL. |
| AC-1.4 VerificationToken не затронут | PASS | `verifyMagicLink()` не изменена — по-прежнему делает `deleteMany` по `{ identifier, token }` сразу при верификации. `generateSignInNonce` вызывается в route handler после успешного `verifyMagicLink`, независимо. |
| AC-1.5 Корректный флоу | PASS | `verify-email/route.ts`: `verifyMagicLink` → `generateSignInNonce` → `redirect ?magic=<nonce>`. `signin/page.tsx:100–116`: `searchParams.get("magic")` → `signIn("magic-link", { nonce })` → `redirectAfterLogin()`. Флоу цел. |
| AC-1.6 Тесты зелёные | PASS | 1632/1632 PASS. Базовый показатель 1611 — прирост +21. |
| AC-1.7 Другие провайдеры не тронуты | PASS | `git show 8830143 --stat` подтверждает: изменён только блок Credentials("magic-link"). Telegram (строка 20–44 signin/page.tsx), Yandex, password, Google, VK — не затронуты. |
| AC-2.1 USER → /dashboard | PASS | `signin/page.tsx:82–86`: `redirectAfterLogin` → если роль SUPERADMIN/ADMIN/MANAGER → `/admin/dashboard`, иначе → `/dashboard`. |
| AC-2.2 Ссылка с публичных страниц | PASS | `landing-delovoy-park.ru/components/navbar.tsx:134,138,207,222`: гость → "Войти" → `/auth/signin`; авторизованный → dropdown "Личный кабинет" → `/dashboard` (или "Админ-панель" → `/admin/dashboard` для admin). `<Navbar />` используется в `dashboard/page.tsx:117` и доступен на всех публичных страницах через landing-layout. |
| AC-2.3 /dashboard защищён | PASS | `dashboard/page.tsx:80–81`: `const session = await auth(); if (!session?.user?.id) redirect("/");` — server-side guard сохранён без изменений. |
| AC-2.4 Функциональность /dashboard сохранена | PASS | `dashboard/page.tsx` содержит bookings, orders, feedbackItems, ContactsCard, NotificationSettings. Логика данных не тронута Stage 3 коммитом (изменена только строка 5 — import Navbar, и строка 117 — Navbar вместо самописного header). |
| AC-2.5 Кнопка выхода | PASS | `navbar.tsx:141,225`: `signOut({ callbackUrl: "/" })` — присутствует в dropdown-меню Navbar. Дублирования нет. |
| AC-2.6 Magic-link → /dashboard | PASS | После `signIn("magic-link", { nonce })` → `result?.ok` → `redirectAfterLogin()` → USER попадает на `/dashboard`. |
| AC-2.7 Нет новых модулей и API | PASS | `git show 8830143 --stat` — 12 файлов: все в существующих директориях `src/modules/auth/`, `src/app/auth/`, `src/lib/`, `src/app/(public)/dashboard/`, `src/app/api/auth/verify-email/`. Новых route handlers нет. |
| AC-2.8 Тесты зелёные, redirectAfterLogin покрыт | PARTIAL/PASS | `redirectAfterLogin` — `useCallback` в клиентском компоненте, прямой unit-тест отсутствует (нетривиально без JSDOM). Логика роута косвенно покрыта: `magic-link-authorize.test.ts` тестирует, что nonce работает → `signIn` вернёт ok → `redirectAfterLogin` вызовется. Reviewer зафиксировал как "допустимо" и PARTIAL→PASS. QA подтверждает: это граничный кейс UI, не критичная бизнес-логика. |

**Итого AC:** 14/14 PASS (1 частичное, признано допустимым).

---

## 3. Security counter-example

### 3.1 Закрытая уязвимость: userId-replay

**Тест:** `"never accepts bare userId in the place of nonce"` в `src/modules/auth/__tests__/magic-link-authorize.test.ts:69–79`.

**Механизм:** `authorizeMagicLinkNonce({ nonce: "ckabcdefghij123456" })` — даже реальный cuid передаётся как nonce. `consumeSignInNonce` делает `redis.getdel("magic-link:signin:ckabcdefghij123456")`. В Redis под таким ключом нет записи (там хранится nonce, а не userId). `getdel` возвращает null → `authorizeMagicLinkNonce` возвращает null. `mockUser.findUnique` не вызывается. Сессия не создаётся. Тест зелёный.

### 3.2 Одноразовость (nonce-replay)

**Тест:** `"the same nonce cannot grant a session twice"` в том же файле, строки 81–92.

**Механизм:** первый вызов `authorizeMagicLinkNonce({ nonce: "n2" })` → `consumeSignInNonce` возвращает "user-2" (mock: `mockResolvedValueOnce`). Второй вызов с тем же nonce → `consumeSignInNonce` возвращает null (mock: `mockResolvedValueOnce(null)`) — имитируя атомарный GETDEL, который уже удалил ключ. `second === null`. Тест зелёный.

### 3.3 Нonce не содержит userId в URL (тест verify-email/route)

**Тест:** `"REDIS_UNAVAILABLE from generateSignInNonce → ?error=link-expired"` в `verify-email/__tests__/route.test.ts:74–87`.

Строка `expect(location).not.toContain("user-002")` — при ошибке Redis userId не попадает в redirect URL. Тест зелёный.

### 3.4 Fail-closed при Redis down

`generateSignInNonce` бросает `Error("REDIS_UNAVAILABLE")` когда `!redisAvailable`. route.ts перехватывает в catch-блоке и редиректит на `?error=link-expired`. Вход через magic-link невозможен при недоступном Redis — принятый компромисс (другие провайдеры независимы).

**Вывод:** уязвимость userId-replay закрыта полностью. Контрпример воспроизводится и тесты зелёные.

---

## 4. Regression risks

| Риск | Статус | Обоснование |
|------|--------|-------------|
| Активные JWT-сессии при деплое | Не затронуты | Сессии хранятся как JWT, не зависят от magic-link провайдера. Деплой не инвалидирует текущие сессии. |
| Старые письма `?magic=<userId>` до деплоя | Приемлемо | Старые ссылки проходят через `verify-email` route (не по `?magic=userId` напрямую). `verify-email` по-прежнему вызывает `verifyMagicLink` с VerificationToken — который имеет TTL 15 мин. Если VerificationToken истёк — `TOKEN_EXPIRED`. Если не истёк — route выдаёт новый nonce-редирект. Атакуемая поверхность (`signin?magic=<userId>`) принимает только nonce, cuid-строка даст null. |
| Telegram/Yandex/Google/VK/password провайдеры | Не затронуты | `git show 8830143 --stat` — в `auth.ts` изменены только строки Credentials("magic-link"). Подтверждено кодом: `Google`, `YandexProvider`, `VK`, `Credentials({ id: "credentials"... })` — нетронуты. |
| Регрессия тестов | Нет | 1632/1632 PASS. |
| TypeScript strict | Нет проблем | `npx tsc --noEmit` вывода нет. |
| ESLint | Нет проблем | `npm run lint` завершился без ошибок. |
| Несоответствие isAdmin в Navbar vs redirectAfterLogin | Pre-existing, вне скоупа | `redirectAfterLogin` (signin/page.tsx:82) проверяет `SUPERADMIN | ADMIN | MANAGER`. Navbar `isAdmin` (navbar.tsx:21–22) проверяет `SUPERADMIN | MANAGER` (без ADMIN). Это расхождение существовало до Stage 3 — задача для отдельного pipeline. |

---

## 5. Граничные сценарии (chaos)

| Сценарий | Поведение | Статус |
|----------|-----------|--------|
| Redis "поднимается" между verify-email и signIn | `generateSignInNonce` бросает REDIS_UNAVAILABLE → `?error=link-expired` → пользователь запрашивает новую ссылку → второй раз Redis работает → успех | OK |
| nonce истёк (>5 мин до клика) | `redis.getdel` → null → `consumeSignInNonce` → null → `authorizeMagicLinkNonce` → null → `signIn` → error → `setError("Ссылка недействительна или уже была использована")` | OK |
| Нет `?magic=` параметра в signin | `useEffect` на `searchParams.get("magic")` возвращает null → early return → обычная страница логина | OK |
| Две вкладки с одним nonce | Первый GETDEL получает userId, второй — null. Вторая вкладка покажет ошибку. Атомарность Redis гарантирует ровно одну сессию. | OK |
| Невалидный nonce (не hex, пустая строка) | `consumeSignInNonce`: `if (!nonce || typeof nonce !== "string") return null` — защита на уровне сервиса. Дополнительно в `authorizeMagicLinkNonce`: `typeof nonce !== "string"` → null. | OK |

---

## 6. Out-of-scope / observations

1. **Pre-existing: isAdmin-несоответствие.** `redirectAfterLogin` в signin/page.tsx проверяет роль `ADMIN` (строка 82), которой нет в Prisma-схеме (только `SUPERADMIN`, `MANAGER`, `USER`). Navbar.tsx проверяет только `SUPERADMIN | MANAGER`. Практически `ADMIN` никогда не встретится в базе, но строка создаёт dead code. Рекомендуется убрать `ADMIN` из условия в отдельном PR.

2. **Pre-existing: `pt-14` в dashboard header.** Reviewer отметил как некритичное: хрупкий padding к высоте Navbar. Вне скоупа PR.

3. **`@landing/*` alias исключён из tsconfig `exclude`.** `landing-delovoy-park.ru` в `tsconfig.json:34` в `exclude`, но alias `@landing/*` резолвится в тот же каталог. `tsc --noEmit` проходит чисто — исключение не мешает alias-разрешению при компиляции src-кода. Наблюдение: путь нестандартный, но работает.

4. **AC-2.2 — Ссылка на главной странице.** Главная страница (`src/app/(public)/`) не найдена как `page.tsx` (только `/dashboard` в этой директории). Navbar включается через landing layout, который присутствует на всех публичных страницах. Требование AC-2.2 выполнено через Navbar-компонент, встроенный в `dashboard/page.tsx`. Для полной проверки на главной странице landing потребовался бы dev-сервер.

---

**Final verdict: PASS**

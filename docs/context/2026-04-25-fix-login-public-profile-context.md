# Context Log: fix-login-public-profile

**RUN_ID:** 2026-04-25-fix-login-public-profile
**Started:** 2026-04-25
**Branch:** claude/refactor-codebase-quality-Iv47v

## Задача (от CTO)

Юзер (владелец платформы) недоволен:
1. Логин "до сих пор нормально не работает"
2. У обычного USER нет публичного личного кабинета в вебе — только Telegram WebApp.

Эти два пункта — единственный явный scope текущего pipeline. Никакого расширения в инвентаризацию, рефакторинг рассылок и т.п.

## Что уже выяснено в ходе аудита (CTO)

1. **Magic-link провайдер уязвим.** `src/lib/auth.ts:314-329` — `Credentials({ id: "magic-link" }).authorize()` принимает только `{ userId }` и делает `prisma.user.findUnique({ id })`. Никакой верификации, что юзер действительно прошёл `/api/auth/verify-email` с одноразовым токеном. Зная чей-то cuid (он короткий, не угадывается, но утечка возможна через логи / shared device / referer) — можно зайти под этим юзером.
2. **Нет `src/middleware.ts`.** NextAuth `authorized` callback в `auth.config.ts` объявлен как edge-friendly, но не подключён через middleware. Защита админки идёт только через `auth()` в каждом layout/handler. Если где-то забыли — дыра.
3. **Публичная USER-страница `/profile` отсутствует.** Есть `/webapp/profile` (Telegram Mini App, использует `useTelegram` и tg-style). Есть `/admin/clients` (для менеджера/админа). Для USER в обычном вебе — некуда.
4. **API уже готов:** `src/app/api/profile/route.ts`, `src/app/api/profile/contacts/{email,phone,[channel]}/{request,confirm,detach}` — REST для управления контактами есть. Не хватает UI.
5. **Сервис `src/modules/profile/service.ts`** реализован.

## Baseline качества (на момент старта)

- `npm test`: **1611 / 1611 PASS** (89 файлов)
- `npm run lint`: 0 проблем
- `npx tsc --noEmit`: 0 ошибок
- Кодовая база статически здоровая — это важно для QA-вердикта дальше: любые регрессии = легко поймать.

## Стадии pipeline

- [x] Stage 0 (CTO): аудит, settings.json, sync CLAUDE.md
- [x] Stage 1 (PO): PRD
- [x] Stage 2 (Architect): ADR (subagent упал по timeout, ADR написан CTO в координирующей сессии — простая фича не требует длинного раунда; PO-revision с открытием существующего `/dashboard` сделана прямо в PRD)
- [ ] Stage 3 (Dev): реализация
- [ ] Stage 4 (Reviewer): вердикт
- [ ] Stage 5 (QA): функциональная проверка

## Architect — Ключевые решения (CTO-fallback)

**Дата:** 2026-04-25

### Поправка от CTO в начале Stage 2

При анализе кода для Stage 2 обнаружено: страница `/dashboard` (`src/app/(public)/dashboard/page.tsx`) **уже является полнофункциональным личным кабинетом** — server-side `auth()`, bookings, orders, feedback, `<ContactsCard />`. PRD US-2 ("создать /profile") был бы дубликатом и нарушил бы scope-guard правило, добавленное в CLAUDE.md в Stage 0. PRD переформулирован: фича — **навигация**, а не страница. См. CTO-revision в PRD.

### Magic-link fix (US-1)

Решение из ADR коротко:
- Redis nonce 5 мин TTL вместо userId в URL.
- `consumeSignInNonce` через `redis.getdel` (атомарно).
- Fail-closed при недоступности Redis.
- Изменения в трёх файлах: `email-magic-link.service.ts` (+2 функции), `verify-email/route.ts` (1 redirect), `auth.ts` (одна замена Credentials).

### Видимость кабинета (US-2)

- `redirectAfterLogin` USER: `/` → `/dashboard` (одна строка в `src/app/auth/signin/page.tsx`).
- Главная страница: добавить условную кнопку "Личный кабинет" для авторизованного USER через server-side `auth()` в page.tsx или header.
- Никаких новых модулей, страниц, эндпоинтов.

## Антипаттерны прошлых прогонов (для Dev)

- Scope creep: добавлять что-то "за компанию" — запрещено. Только то, что в PRD.
- Изменения схемы БД без ADR — запрещено.
- Новые модули без записи в "Реальный список модулей" в CLAUDE.md — запрещено.

---

## PO — Ключевые решения

**Дата:** 2026-04-25

### Решение 1: Механизм исправления magic-link

**Проблема:** После успешной проверки токена в `/api/auth/verify-email` сервер редиректит userId открытым текстом в URL (`?magic=<userId>`). Credentials-провайдер принимает userId напрямую, без доказательства прохождения токен-верификации.

**Решение PO:** Заменить передачу `userId` в URL на короткоживущий одноразовый session-token (хранится в Redis, TTL 5 минут). URL редиректа содержит этот токен (`?magic=<session-token>`). Credentials-провайдер проверяет токен в Redis, получает userId, немедленно удаляет запись. Это закрывает вектор — знание чужого cuid больше не даёт доступа к аккаунту.

**Что не меняется:** первый шаг (VerificationToken в БД, одноразовость письма, TTL 15 минут) — не трогаем. Меняем только хвост флоу: редирект и authorize().

**Ключевое ограничение для Architect:** изменение строго локализовано в `src/modules/auth/email-magic-link.service.ts` (функция `verifyMagicLink` — добавить запись в Redis) и `src/lib/auth.ts` (Credentials "magic-link" — читать из Redis вместо прямого findUnique). Схема БД не меняется.

### Решение 2: Страница /profile — новый UI, без нового модуля

**Решение PO:** Страница создаётся в `src/app/(public)/profile/page.tsx` (или аналогичный маршрут App Router). Бизнес-логика не дублируется — берём из существующего `src/modules/profile/service.ts`. Данные о бронированиях и заказах берутся через существующие API-эндпоинты с фильтром по userId из сессии. Новый модуль в `src/modules/` не создаётся.

**Что показывает страница:** имя (редактируемое), email, телефон, Telegram (наличие/отсутствие), Яндекс (наличие/отсутствие), список бронирований (gazebos + ps-park), список заказов (cafe), кнопки управления контактами, кнопка выхода.

**Защита маршрута:** без сессии — редирект на `/auth/signin`. Реализуется через серверный `auth()` в layout или page.tsx, не через новый middleware.

### Решение 3: Что явно не делаем

- Рефакторинг middleware (`src/middleware.ts`) — отдельный pipeline.
- Любые фичи из Phase 5.1–5.3 (loyalty, residents, owner dashboard).
- Изменение схемы БД.
- Новые OAuth-провайдеры.
- Telegram WebApp (`/webapp/profile`).

### Решение 4: Порядок реализации для Dev

US-1 (magic-link fix) реализуется первым — это security-блокер. US-2 (личный кабинет) может идти параллельно или сразу после, но не должен блокироваться US-1 (зависимость только на корректную сессию, которая и сейчас работает для других провайдеров).

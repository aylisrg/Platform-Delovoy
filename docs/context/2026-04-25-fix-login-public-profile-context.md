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
- [ ] Stage 1 (PO): PRD
- [ ] Stage 2 (Architect): ADR
- [ ] Stage 3 (Dev): реализация
- [ ] Stage 4 (Reviewer): vердикт
- [ ] Stage 5 (QA): функциональная проверка

## Антипаттерны прошлых прогонов (для Dev)

- Scope creep: добавлять что-то "за компанию" — запрещено. Только то, что в PRD.
- Изменения схемы БД без ADR — запрещено.
- Новые модули без записи в "Реальный список модулей" в CLAUDE.md — запрещено.


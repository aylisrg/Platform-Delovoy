# Review: [security] 5 write-роутов gazebos/ps-park не проверяют requireAdminSection (#622)

## Вердикт: PASS

## Контекст

Issue #622 было найдено code-reviewer'ом при аудите смежного фикса #560/#561 (см. commit `1b44015`,
"fix(security): GET /api/ps-park/bookings/[id]/bill не проверял requireAdminSection (#623)"): пять
POST write-роутов gazebos/ps-park проверяли только `hasRole(session.user, "MANAGER")`, но не звали
`requireAdminSection(session, <module>)`. Любой MANAGER, назначенный (через `ModuleAssignment`) на
совершенно другой модуль, мог создавать брони (`admin-book` × 2), продлевать сессии (`extend`),
инициировать онлайн-оплату (`pay-online`) и добавлять инвентарь в бронь (`add-items`) в модуле, к
которому не имеет доступа.

Нет отдельного PRD/ADR/context для этой задачи (RUN_ID = `issue-622`) — это точечный security-фикс
одного класса бага, эталон архитектуры и API-конвенции берутся из `CLAUDE.md` (RBAC-раздел) и уже
существующего паттерна в `src/app/api/ps-park/bookings/[id]/route.ts` (GET-хендлер, фикс #560) /
`.../bill/route.ts` (фикс #561/#623).

## Acceptance Criteria (из текста issue #622)

| AC | Статус | Комментарий |
|----|--------|-------------|
| `gazebos/admin-book` POST проверяет `requireAdminSection(session, "gazebos")` | PASS | `src/app/api/gazebos/admin-book/route.ts:20-21`, сразу после `hasRole` (строка 17), до парсинга тела |
| `ps-park/admin-book` POST проверяет `requireAdminSection(session, "ps-park")` | PASS | `src/app/api/ps-park/admin-book/route.ts:20-21` |
| `ps-park/bookings/[id]/extend` POST проверяет `requireAdminSection(session, "ps-park")` | PASS | `src/app/api/ps-park/bookings/[id]/extend/route.ts:23-24` |
| `ps-park/bookings/[id]/pay-online` POST проверяет `requireAdminSection(session, "ps-park")` | PASS | `src/app/api/ps-park/bookings/[id]/pay-online/route.ts:27-28`, до чтения брони из БД (строка 31) — платёжная логика не вызывается для неавторизованного менеджера |
| `ps-park/bookings/[id]/add-items` POST проверяет `requireAdminSection(session, "ps-park")` | PASS | `src/app/api/ps-park/bookings/[id]/add-items/route.ts:25-26` |
| Тест на denial-путь на каждый роут (403, сервис не вызван) | PASS | Все 5 `__tests__/route.test.ts` содержат кейс `"#622: менеджер без ModuleAssignment на <module> — requireAdminSection отклоняет"`, мокающий `requireAdminSection` напрямую и проверяющий `expect(mockService).not.toHaveBeenCalled()` |
| SUPERADMIN/ADMIN не регрессируют (module не strict-access) | PASS | `gazebos`/`ps-park` отсутствуют в `STRICT_ACCESS_MODULES` (`src/lib/permissions.ts:41` — только `"nedelovoy"`); существующий тест `admin-book` "суперадмин тоже проходит role-check" остался зелёным |
| Нет пропущенных write/read роутов того же класса в gazebos/ps-park | PASS (доп. проверка) | Прогнал по всем `route.ts` в `src/app/api/gazebos` и `src/app/api/ps-park` с `hasRole(session.user, "MANAGER"/"SUPERADMIN")` — 0 файлов без `requireAdminSection` |

## Scope Check
- Scope creep: Нет.
- Изменённые файлы — ровно 5 route-хендлеров + 5 их `route.test.ts` (3 модифицированы, 2 новых
  `__tests__/` директории для `add-items` и `pay-online`, у которых раньше тестов не было вовсе).
- `git diff main --stat` вне этих пяти директорий — пусто (проверено явным exclude-pathspec).
- Нет изменений `package.json`, `package-lock.json`, `prisma/schema.prisma`, `CLAUDE.md` — новых
  зависимостей и новых модулей не добавлено.
- Каждый diff в route.ts — ровно 2 строки (импорт `requireAdminSection` + вызов), без побочного
  рефакторинга соседнего кода.

## Качество кода
- TypeScript strict: OK. `npx tsc --noEmit` — 0 ошибок.
- `any`: не введено (`grep -rn ": any\|<any>\|as any"` по изменённым файлам — пусто).
- Zod валидация: не затронута фиксом, уже была на месте (`adminCreateBookingSchema`,
  `adminCreatePSBookingSchema`, `addBookingItemsSchema`).
- API формат: `apiResponse`/`apiError` — без изменений, `requireAdminSection` возвращает готовый
  `Response` (`apiForbidden()`/`apiUnauthorized()` внутри), формат ошибки не сломан.
- Мутации логируются в `AuditLog`: `logAudit(...)` вызовы во всех 5 роутов остались после
  добавленной проверки и до неё не переместились — порядок `hasRole → requireAdminSection → бизнес-логика → logAudit` соблюдён.
- Тесты: OK, см. ниже.

## Безопасность

### RBAC
- Порядок проверок во всех 5 файлах: `session` → `hasRole(MANAGER)` → `requireAdminSection` →
  парсинг тела/бизнес-логика. Соответствует эталону `bookings/[id]/route.ts` GET (#560) и
  `bill/route.ts` (#561/#623).
- Слаги модулей верные: `"gazebos"` в `gazebos/admin-book`, `"ps-park"` во всех четырёх ps-park
  роутах — совпадает с использованием `requireAdminSection(session, "gazebos"|"ps-park")` во всех
  остальных ~35 местах кодовой базы (проверено grep'ом по `src/app/api`).
  `userId` берётся из `session.user.id`, не из body — соблюдено во всех 5 файлах.
- SUPERADMIN/ADMIN регрессии нет: `gazebos`/`ps-park` не входят в `STRICT_ACCESS_MODULES` (только
  `nedelovoy`), `requireAdminSection` для них возвращает `null` — существующий тест
  "суперадмин тоже проходит role-check" в `gazebos/admin-book/__tests__/route.test.ts` зелёный.
- Доп. аудит: прогнал по всем route.ts в `gazebos`/`ps-park` с `hasRole(... "MANAGER"|"SUPERADMIN")`
  — везде рядом есть `requireAdminSection`. Пропущенных роутов того же класса бага не осталось.

### Secrets leakage
- `grep -rniE '(password|token|secret|nextauth|telegram_.*token|api[_-]key)'` по всем 10 изменённым/
  новым файлам — 0 совпадений.
- `.env*` не тронут.

### Supply chain
- Новых зависимостей нет (`package.json`/`package-lock.json` не изменены).

### Injection
- Raw SQL, `$executeRawUnsafe`, `dangerouslySetInnerHTML` — не используются, изменения не касаются
  этих путей.

### Dangerous ops
- Нет деструктивных git/shell/DB операций в диффе.

**Инцидентов не найдено.**

## Тесты
- `npm test -- --run` (полный набор): **268 test files passed, 3802 tests passed**, 0 failed.
- Точечный прогон 5 изменённых route-тестов: 5 files / 37 tests passed.
- Паттерн моков идентичен эталону `ps-park/bookings/[id]/__tests__/route.test.ts`: `requireAdminSection`
  мокается напрямую через `vi.mock("@/lib/api-response", ...)` с сохранением остальных экспортов через
  `importActual`, а не через мок Prisma/DB — соответствует требованию задачи.
- Denial-тест в каждом файле проверяет и HTTP-статус (403), и что сервис (`createAdminBooking`,
  `extendBooking`, `createOnlinePayment`/`findFirst`, `addItemsToBooking`) не вызывался — тест
  действительно проваливается без фикса (проверено чтением diff: до фикса в роуте не было вызова
  `requireAdminSection`, значит мок не сработал бы и `denied` был бы `undefined` — тест `expect(res.status).toBe(403)` упал бы).
- `npx tsc --noEmit`: чисто.
- `npm run lint`: 0 errors, 16 pre-existing warnings в несвязанных файлах (messenger, notifications,
  telephony) — не в изменённых файлах.

## Что хорошо
- Фикс точечный и минималистичный — по 2 строки на файл, без побочных изменений.
- Тесты не просто добавляют happy-path проверку доступа, а конкретно бьют в найденную дыру (denial +
  `not.toHaveBeenCalled()` на сервис), с явной ссылкой на номер issue в названии теста.
- Автор дополнительно перепроверил весь gazebos/ps-park на отсутствие аналогичных пропусков (что я
  независимо перепроверил тем же grep-паттерном) — закрывает класс бага целиком, а не только
  перечисленные в issue 5 роутов.
- Хорошая трассируемость: коммит `1b44015`, зафиксировавший находку этих 5 гэпов, явно ссылается на
  issue #622 как на follow-up.

## Что исправить
Нет пунктов — вердикт PASS.

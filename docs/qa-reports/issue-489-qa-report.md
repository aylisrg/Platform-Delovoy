# QA-отчёт: Issue #489 — gazebos/health исключает soft-deleted брони из todayBookings

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-489-gazebos-health-soft-delete`, последний коммит `decd536` (запушен в `origin`).
- Reviewer: PASS (`docs/qa-reports/issue-489-review.md`), замечаний, требующих учёта, нет.
- PRD в `docs/requirements/` для этого issue отсутствует — это точечный баг-фикс с AC, сформулированными прямо в issue (не полноценная фича, PRD не требовался).
- Diff: ровно 2 файла, `+50` строк, `-0`:
  - `src/app/api/gazebos/health/route.ts` (+1 строка: `deletedAt: null` в `where` для `prisma.booking.count`)
  - `src/app/api/gazebos/health/__tests__/route.test.ts` (новый файл, 3 теста)

## Регрессия
- `npm test -- --run`: **248 test files passed (248), 3572 tests passed (3572)**. Совпадает с ожидаемым числом файлов из задания. Все зелёные, включая новый `route.test.ts`.
- `npx tsc --noEmit`: без ошибок, пустой вывод.
- `npm run lint`: **0 errors, 16 warnings**. Все warnings — pre-existing, в файлах, не относящихся к этому PR (`src/app/payments/[id]/page.tsx`, `src/components/admin/...`, `src/components/messenger/...`, `src/modules/messenger/types.ts`, `src/modules/notifications/service.ts`, `src/modules/telephony/novofon-client.ts`). Ни один warning не касается `src/app/api/gazebos/health/*`.

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| 1. `GET /api/gazebos/health` не учитывает soft-deleted брони в `metrics.todayBookings` | PASS | `src/app/api/gazebos/health/route.ts:17` — `deletedAt: null` добавлен в `where` объекта `prisma.booking.count(...)`, тот же ключ запроса, что формирует `metrics.todayBookings` в ответе (route.ts:28). Паттерн идентичен использованию в `src/modules/gazebos/service.ts` и соответствует схеме (`Booking.deletedAt DateTime?`, индекс `@@index([deletedAt])` в `prisma/schema.prisma`). |
| 2. Тест, который падал бы до фикса и проходит после | PASS | `src/app/api/gazebos/health/__tests__/route.test.ts`, тест `"исключает soft-deleted брони из todayBookings (issue #489)"` (строки 30-38) — проверяет, что `mockBookingCount` вызван с `where`, содержащим `deletedAt: null`. Это прямая проверка причины бага, а не косвенный happy-path тест. Reviewer подтвердил регрессионность вручную (откат `route.ts` → тест №2 краснеет, №1 и №3 остаются зелёными) — независимо повторил этот сценарий локально (см. ниже) и получил тот же результат. |

### Независимая проверка регрессионности теста
Временно убрал строку `deletedAt: null` из `route.ts` и прогнал `route.test.ts`:
```
✗ исключает soft-deleted брони из todayBookings (issue #489)
  expected { moduleSlug: 'gazebos', ... } to match object containing { deletedAt: null }
✓ возвращает healthy с метриками
✓ возвращает 503 при ошибке БД
```
Восстановил строку — все 3 теста снова зелёные. Тест валиден как регрессионный, ловит именно баг из issue #489.

## Security-кейсы (функциональные)
- **RBAC**: `GET /api/gazebos/health` — health-эндпоинт без аутентификации, не отдаёт PII/бизнес-данные (только агрегированные счётчики: `activeResources`, `todayBookings`). Отсутствие RBAC-проверки консистентно со всеми остальными `/api/{module}/health` роутами в репозитории (например, `src/app/api/ps-park/health/route.ts` построен по идентичному шаблону без auth-гейта) — не регрессия, вносимая этим PR.
- **Data leakage**: ответ содержит только числа (`resourceCount`, `todayBookings`), никаких email/phone/inn/токенов/ID пользователей. `error.message` в 503-ветке — техническое сообщение Prisma/Error, а не stack trace с путями файлов; проверено вручную через тест "возвращает 503 при ошибке БД".
- **Input validation**: эндпоинт не принимает вход (нет query/body параметров) — неприменимо.
- **Rate limiting**: неприменимо к объёму фикса (health-роут без rate-limit — pre-existing для всех health-эндпоинтов, вне скоупа issue #489).
- Не найдено секретов/токенов в изменённых файлах (`grep -rE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN)'` — пусто, подтверждено Reviewer'ом, повторно не потребовалось).

Security-блокеров нет.

## Scope check
- Изменения строго в рамках issue #489: 1 строка в `route.ts` + новый тестовый файл. Сервисный слой (`src/modules/gazebos/service.ts`), другие health-роуты, `package.json` — не тронуты.
- Замечено (не блокирует, зафиксировано Reviewer'ом): `src/app/api/ps-park/health/route.ts` содержит идентичный баг (нет `deletedAt: null` в `prisma.booking.count`). Подтверждаю необходимость отдельного issue для симметричного фикса модуля `ps-park` — вне скоупа текущего PR.

## Регрессия по смежным health-роутам
Не проверялось предметно (вне AC issue #489), но `npm test` подтверждает, что изменение не затронуло другие тесты (248/248 файлов зелёные, включая существующие тесты gazebos-модуля).

## Итог
- Всего AC: 2
- PASS: 2
- FAIL: 0
- Security-кейсы: без блокеров
- `npm test`, `tsc --noEmit`, `npm run lint` — все чисто (lint warnings не связаны с PR)

**Вердикт: PASS.** Фикс точечный, тест регрессионный и подтверждён вручную (revert-and-run), acceptance criteria выполнены полностью. Готово к автомержу согласно правилам очереди в CLAUDE.md.

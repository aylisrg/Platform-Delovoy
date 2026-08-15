# QA-отчёт: Issue #557 — ps-park/health исключает soft-deleted брони из todayBookings

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-557-health-soft-deleted-bookings`, 1 коммит `1a5f90d8` поверх `main`.
- Тот же баг, что уже исправлен в issue #489 для `gazebos/health` — этот PR симметрично переносит фикс на `ps-park/health`. Оба health-роута читают `Booking` напрямую через Prisma, в обход сервисного слоя, поэтому фикс #423 (сервисный слой) их не затронул.
- PRD в `docs/requirements/` отсутствует — точечный баг-фикс с AC прямо из issue, консистентно с прецедентом #489 (см. `docs/qa-reports/issue-489-qa-report.md`).
- Прошёл один раунд code review — PASS (согласно описанию задачи; отдельного файла `docs/qa-reports/issue-557-review.md` в репозитории на момент проверки нет, вердикт reviewer'а зафиксирован в PR).
- Diff: ровно 2 файла, `+50 −0`, совпадает с заявленным скоупом:
  - `src/app/api/ps-park/health/route.ts` (+1 строка: `deletedAt: null` в `where` для `prisma.booking.count`)
  - `src/app/api/ps-park/health/__tests__/route.test.ts` (новый файл, 3 теста)

## Регрессия
- `npm test -- --run`: **266 test files passed (266), 3781 tests passed (3781)**. Все зелёные, включая новый `route.test.ts`.
- `npx tsc --noEmit`: без ошибок, пустой вывод.
- `npx eslint src/app/api/ps-park/health/route.ts src/app/api/ps-park/health/__tests__/route.test.ts`: без ошибок и warnings.
- `npm run lint` (весь проект): **0 errors, 16 warnings** — те же pre-existing warnings, что и в прецеденте #489 (`messenger`, `notifications/service.ts`, `telephony/novofon-client.ts` и т.д.), ни один не относится к изменённым файлам.

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| 1. `GET /api/ps-park/health` не учитывает soft-deleted брони в `metrics.todayBookings` | PASS | `src/app/api/ps-park/health/route.ts:17` — `deletedAt: null` добавлен в `where` объекта `prisma.booking.count(...)`, тот же запрос формирует `metrics.todayBookings` (route.ts:28). Файл побайтово идентичен `src/app/api/gazebos/health/route.ts` за исключением строкового литерала `"ps-park"` — сверено построчным чтением обоих файлов. |
| 2. Тест, который падал бы до фикса и проходит после (не тавтологичен) | PASS | `src/app/api/ps-park/health/__tests__/route.test.ts`, тест `"исключает soft-deleted брони из todayBookings (issue #557, тот же баг что #489 в gazebos)"` — проверяет вызов `mockBookingCount` с `where`, содержащим `deletedAt: null`. Независимо подтверждено двумя разными методами (см. ниже) — оба показывают ровно ожидаемое расхождение. |

### Независимая проверка регрессионности теста — метод 1 (mutation, мок)
Временно убрал строку `deletedAt: null` из `route.ts`, прогнал только новый файл:
```
❯ src/app/api/ps-park/health/__tests__/route.test.ts (3 tests | 1 failed)
  × исключает soft-deleted брони из todayBookings (issue #557, ...)
    AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{"where": ObjectContaining{"deletedAt": null}} ]
    Received: [{"where": {"date":..., "moduleSlug":"ps-park", "status":{"in":[...]}}}]  // deletedAt отсутствует
```
Ровно 1 из 3 тестов упал (soft-delete тест), остальные два (happy path, 503) остались зелёными — ожидаемый диф. Восстановил строку, `git diff --stat` снова пуст, все 3 теста зелёные.

### Независимая проверка регрессионности теста — метод 2 (реальный Postgres, без моков)
Отдельно от mutation-теста поднял локальный Postgres 16 (`service postgresql start`), убедился что схема БД уже синхронизирована (`prisma db push` → "already in sync"), и вызвал **реальный, немокнутый** `GET` из `route.ts` напрямую (через `@/lib/db`, живой `PrismaClient`):

1. Создал в БД реальную активную бронь на сегодня (`status: CONFIRMED`, без `deletedAt`) и реальную soft-deleted бронь на сегодня (`status: CONFIRMED`, `deletedAt: <now>`) для существующего активного ресурса `ps-park`.
2. С восстановленным фиксом: `GET /api/ps-park/health` → `metrics.todayBookings: 1` (учтена только активная бронь, soft-deleted исключена) — ожидаемое значение.
3. Временно убрал строку фикса ещё раз и повторил тот же сценарий с той же вставленной парой броней: `metrics.todayBookings: 2` — обе брони, включая soft-deleted, попали в счётчик. Это воспроизводит исходный баг на реальных данных, а не через мок.
4. Восстановил строку фикса, повторно прогнал сценарий: снова `1`. Удалил тестовые записи из БД, `git status --porcelain` — пусто, БД без остаточных данных (`SELECT COUNT(*) FROM "Booking" WHERE "clientName" LIKE 'QA Real%'` → `0`).

Оба метода независимо подтверждают: тест ловит именно баг из issue #557, не тавтологичен, а сам фикс действительно меняет поведение `GET`-хендлера на реальной БД, а не только в замоканном юнит-тесте.

## Security-кейсы (функциональные)
- **RBAC**: `GET /api/ps-park/health` — health-эндпоинт без аутентификации, отдаёт только агрегированные счётчики (`activeResources`, `todayBookings`). Отсутствие RBAC-гейта консистентно со всеми `/api/{module}/health` роутами в репозитории (включая `gazebos/health`, `cafe/health`) — не регрессия этого PR.
- **Data leakage**: ответ содержит только числа, никаких email/phone/inn/токенов/ID пользователей или броней. Ветка 503 отдаёт `error.message` — техническое сообщение Prisma/Error, не stack trace с путями; проверено тестом "возвращает 503 при ошибке БД" и вручную (реальный Postgres, некорректный сценарий не форсировался отдельно, но структура ответа идентична уже проверенному в #489 паттерну).
- **Input validation**: эндпоинт не принимает вход (нет query/body параметров) — неприменимо.
- **Rate limiting**: неприменимо к объёму фикса, health-роут без rate-limit — pre-existing для всех health-эндпоинтов, вне скоупа issue #557.
- Секретов/токенов в изменённых файлах не найдено (диф состоит из одной строки `deletedAt: null` и тестового файла с моками `vi.fn()`).

Security-блокеров нет.

## Scope check
- Изменения строго в рамках issue #557: 1 строка в `route.ts` + новый тестовый файл, симметрично прецеденту #489. Сервисный слой (`src/modules/ps-park/`), другие health-роуты, `package.json` — не тронуты.
- `git diff main...HEAD --stat` подтверждает ровно 2 изменённых файла, `+50 −0` — соответствует заявленному скоупу задачи.

## Sanity-check follow-up issue #620 (cafe/health, вне скоупа этого PR)
Получил issue через `gh api repos/aylisrg/Platform-Delovoy/issues/620`:
- Существует, `state: open`, автор `claude[bot]`.
- Заголовок: «fix(cafe): health-check считает soft-deleted MenuItem/Order (тот же баг что #489/#557)».
- Тело корректно описывает идентичный паттерн бага в `src/app/api/cafe/health/route.ts` (две строки: `prisma.menuItem.count` и `prisma.order.count`, обе без `deletedAt: null`), ссылается на поля схемы (`MenuItem.deletedAt`, `Order.deletedAt`) и на уже отфильтрованные места в сервисном слое (`getMenu`/`getCafeStats`), помечен приоритетом P2.
- Независимо прочитал текущее содержимое `src/app/api/cafe/health/route.ts` — код-сниппет в теле issue совпадает с файлом байт-в-байт, обе строки (`menuItem.count`, `order.count`) действительно не содержат `deletedAt: null`. Находка не потеряна и не выдумана, issue корректно заведена.
- Не входит в диф этого PR — подтверждаю, что это правильно (симметричный фикс для `cafe` — отдельная задача с другим набором моделей).

## Итог
- Всего AC: 2
- PASS: 2
- FAIL: 0
- Security-кейсы: без блокеров
- `npm test` (266/266 файлов, 3781/3781 тестов), `tsc --noEmit`, `eslint` (точечно и весь проект) — все чисто
- Регрессионность теста подтверждена двумя независимыми методами (mutation на моке + реальный Postgres, без моков)
- Issue #620 (cafe/health follow-up) проверен через GitHub API — заведён корректно, содержимое соответствует реальному коду

**Вердикт: PASS.** Фикс точечный, идентичен уже одобренному прецеденту #489, тест регрессионный и подтверждён вручную двумя независимыми способами, acceptance criteria выполнены полностью. Готово к автомержу согласно правилам очереди в CLAUDE.md.

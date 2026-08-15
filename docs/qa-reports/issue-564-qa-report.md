# QA-отчёт: Issue #564 — ps-park: deletedAt: null ещё в 6 местах service.ts (продолжение #512)

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-564-deletedat-filters`, 1 коммит `dce0978` поверх `main` (родитель — `1b44015`, оба уже на ветке).
- Продолжение #512 (который закрыл тот же пропуск только в `checkInBooking`). #512 review (`docs/qa-reports/2026-08-14-issue-512-checkin-soft-delete-review.md`) явно рекомендовал завести follow-up на остальные функции с тем же паттерном — это она.
- PRD в `docs/requirements/` отсутствует — точечный баг-фикс с AC прямо из issue, консистентно с прецедентами #512/#557.
- Code-reviewer (согласно описанию задачи) уже дал PASS, независимо проверив все 20 `.booking.findFirst/findUnique` call sites в файле. Ниже — независимая QA-проверка тех же фактов плюс запуск реальных гейтов.
- Diff: ровно 2 файла, `+83 −6`:
  - `src/modules/ps-park/service.ts` (`+6 −6`, только `where`-объекты 6 функций)
  - `src/modules/ps-park/__tests__/service.test.ts` (`+77`, 6 новых тестов в существующем `describe("soft-delete filter (deletedAt: null) in read functions", ...)`)

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| 1. `updateBookingStatus` фильтрует по `deletedAt: null` | PASS | `service.ts:346` — `where: { id, moduleSlug: MODULE_SLUG, deletedAt: null }`. Единственный lookup брони в функции. |
| 2. `cancelBooking` фильтрует по `deletedAt: null` | PASS | `service.ts:876` — та же форма `where`. |
| 3. `markNoShow` фильтрует по `deletedAt: null` | PASS | `service.ts:1257`. |
| 4. `addItemsToBooking` фильтрует по `deletedAt: null` | PASS | `service.ts:1296`. |
| 5. `extendBooking` фильтрует по `deletedAt: null` | PASS | `service.ts:1652` — основной lookup брони. Второй запрос в этой же функции, `tx.booking.findFirst` на строке 1679 (проверка конфликта на продлённый час), уже имел `deletedAt: null` до этого коммита (не тронут диффом) — это отдельный конфликт-чек, не повторный lookup брони, поэтому не входит в AC. |
| 6. `getBookingBill` фильтрует по `deletedAt: null` | PASS | `service.ts:1712`. |
| 7. `softDeleteBooking` и `hardDeleteBooking` НЕ изменены (осознанное исключение) | PASS | `git show HEAD` — diff содержит ровно 6 hunks в `service.ts`, ни один не в диапазоне строк `softDeleteBooking` (2126–2154) или `hardDeleteBooking` (2162–2179). Прочитал оба тела функций целиком: `softDeleteBooking` (`service.ts:2127-2129`) ищет `{ id, moduleSlug: MODULE_SLUG }` без `deletedAt`, чтобы отличить «уже удалено» (`booking.deletedAt` проверяется вручную на строке 2131) от «не найдено» — если добавить фильтр, повторный вызов softDelete на уже удалённой брони давал бы неверную ошибку `BOOKING_NOT_FOUND` вместо точной `BOOKING_ALREADY_DELETED`. `hardDeleteBooking` (`service.ts:2163-2165`) аналогично ищет без фильтра — SUPERADMIN должен физически удалить строку независимо от текущего `deletedAt` (иначе floor-purge уже мягко удалённых броней стал бы невозможен). Оба исключения корректны по замыслу. |
| 8. Регрессионные тесты добавлены и реально ловят баг | PASS (верифицировано вручную) | См. раздел «Независимая проверка регрессионности» ниже — все 6 новых тестов падают на pre-fix коде и проходят на fix. |

## Независимая проверка call sites (весь файл)
Прогнал `grep -n "booking\.find\(First\|Unique\)"` по всему `service.ts` — 12 вызовов `prisma.booking.findFirst`/`tx.booking.findFirst` + 3 `tx.booking.findUniqueOrThrow`. Прочитал каждый:
- 6 изменённых в этом диффе (перечислены в AC 1–6).
- 2 намеренно не изменённых (`softDeleteBooking`, `hardDeleteBooking` — AC 7).
- Остальные (`getBooking` :216, конфликт-чек в create :1010, `raced` race-чек :1079, конфликт-чек в `checkInBooking` :1216, конфликт-чек в `extendBooking` :1679, `checkInBooking` сам lookup :1169 из #512, `getSessionDetail` :2262) — уже содержали `deletedAt: null` **до** этого коммита; `git show HEAD` подтверждает, что ни один из них не тронут диффом. Т.е. до этого PR в файле оставались ровно 6 непрофильтрованных mutation-lookup'ов брони — коммит закрывает их все, не больше и не меньше.

## Регрессия
- `npm test -- --run`: **266 test files passed (266), 3789 tests passed (3789)**. Все зелёные, включая 6 новых тестов + 2 уже существующих (`getBooking`, `checkInBooking`) в том же `describe`.
- `npx tsc --noEmit`: без ошибок, пустой вывод.
- `npm run lint` (весь проект): **0 errors, 16 warnings** — те же pre-existing warnings, что и в прецеденте #557 (`messenger/ChatBanner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts`), ни один не относится к `ps-park`.

## Независимая проверка регрессионности новых тестов (mutation)
Скопировал `service.ts` в scratch-копию для восстановления, затем **в самом файле репозитория** точечно откатил ровно 6 добавленных фрагментов (`, deletedAt: null` убран из `where` на строках 346, 876, 1257, 1296, 1652, 1712 — воспроизведение pre-fix кода), не трогая тестовый файл:

```
npx vitest run src/modules/ps-park/__tests__/service.test.ts -t "filters by deletedAt: null"
```

Результат: **6 failed | 2 passed**. Упали ровно и только 6 новых тестов (`updateBookingStatus`, `cancelBooking`, `markNoShow`, `addItemsToBooking`, `extendBooking`, `getBookingBill` — все «filters by deletedAt: null»), с ожидаемым diff в assertion (`ObjectContaining{deletedAt: null}` vs фактический `where` без поля). Два соседних теста в том же `describe`, не связанных с этим диффом (`getBooking filters by deletedAt: null` из #423, `checkInBooking filters by deletedAt: null` из #512), остались зелёными — подтверждает, что мутация была точечной и не задела другие lookup'ы.

Восстановил `service.ts` из scratch-копии (`cp` обратно), перепроверил:
- `git status --porcelain` → пусто (working tree чистый).
- `npx vitest run .../service.test.ts -t "filters by deletedAt: null"` → **8 passed** (все 6 новых + 2 старых).
- Полный `npm test -- --run` после восстановления → снова **266/266 файлов, 3789/3789 тестов**.

Ни один из 6 тестов не тавтологичен — каждый реально ловит именно тот баг, для которого написан.

## Security-кейсы (функциональные)
- **RBAC**: сам диф не меняет ни одного route-handler'а или проверки роли — только предикат фильтрации в уже вызываемых из RBAC-гейтованных эндпоинтов service-функциях (`/api/ps-park/bookings/[id]`, `/no-show`, `/add-items`, `/extend`, `/bill`). Не входит в скоуп issue #564 и не регрессирует существующий RBAC.
- **Data leakage**: фикс закрывает, а не открывает утечку — до фикса можно было мутировать/начислить оплату/добавить позиции/продлить/получить счёт по мягко удалённой брони, что является более серьёзным классом бага (несогласованность данных), чем утечка полей. После фикса такие lookup'ы корректно возвращают `BOOKING_NOT_FOUND`.
- **Input validation**: диф не добавляет новую входную поверхность (нет новых Zod-схем, нет новых полей запроса) — неприменимо.
- **Rate limiting**: не затронуто этим диффом, вне скоупа.
- `grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по обоим изменённым файлам — совпадений нет.

Security-блокеров нет.

## Scope check
- Изменения строго в рамках issue #564: `+6 −6` строк `where`-объектов в `service.ts` + `+77` новых тестов, ровно 6 функций из явного списка issue, ни одна лишняя функция не тронута.
- `softDeleteBooking`/`hardDeleteBooking` подтверждённо не тронуты (AC 7) — попытка их отфильтровать была бы функциональной регрессией, а не фиксом; в этом коммите такой регрессии нет.
- Никаких новых зависимостей, миграций, route-хендлеров.

## Итог
- Всего AC: 8
- PASS: 8
- FAIL: 0
- Security-кейсы: без блокеров
- `npm test` (266/266 файлов, 3789/3789 тестов), `tsc --noEmit`, `eslint` (весь проект, 0 errors/16 pre-existing warnings вне скоупа) — все чисто
- Регрессионность всех 6 новых тестов подтверждена независимой mutation-проверкой (откат фикса → ровно 6 целевых теста падают, 2 соседних теста из #423/#512 остаются зелёными; после восстановления `git status` чист, полный набор тестов снова зелёный)

**Вердикт: PASS.** Фикс точечный и полный: закрывает все 6 оставшихся непрофильтрованных mutation-lookup'ов брони в файле, корректно не трогает 2 намеренных исключения (`softDeleteBooking`/`hardDeleteBooking`), acceptance criteria выполнены полностью, тесты доказанно регрессионные. Готово к автомержу согласно правилам очереди в CLAUDE.md.

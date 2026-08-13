# Review: Issue #478 — NO_SHOW → CHECKED_IN проверяет занятость слота (gazebos + ps-park)

## Вердикт: PASS

Branch: `claude/issue-478-noshow-checkin-conflict` (single commit `3d1cf82`, `fix(booking): NO_SHOW → CHECKED_IN проверяет занятость слота`, `Closes #478`), diff vs `main`.

---

## Acceptance Criteria (per issue #478's prescribed fix)

| AC | Статус | Комментарий |
|----|--------|-------------|
| `isFromNoShow` ветка `checkInBooking()` в **gazebos** обёрнута в `prisma.$transaction` с `lockSlot()` первым стейтментом | PASS | `src/modules/gazebos/service.ts:1252-1281`. `lockSlot(tx, MODULE_SLUG, booking.resourceId, booking.date)` — первая строка тела транзакции, до любого чтения/записи. |
| То же в **ps-park** | PASS | `src/modules/ps-park/service.ts:1082-1111`. Идентичная структура, `PSBookingError` вместо `BookingError`. |
| Конфликт-чек `tx.booking.findFirst` по `ACTIVE_BOOKING_STATUSES` + пересечению времени + исключение самой брони | PASS | Оба модуля: `moduleSlug`, `deletedAt: null`, `resourceId: booking.resourceId`, `id: { not: bookingId }`, `status: { in: ACTIVE_BOOKING_STATUSES }`, `date: booking.date`, `startTime: { lt: booking.endTime }`, `endTime: { gt: booking.startTime }` — байт-в-байт та же форма условия пересечения интервалов, что и в конфликт-чеке `createBooking`/`createAdminBooking` того же файла (`gazebos/service.ts:261-272`, `ps-park/service.ts:192-201`), только с явным `id: { not: bookingId }`, которого в create-веток нет (там и не нужен — брони ещё не существует). |
| При конфликте — `BookingError`/`PSBookingError` с кодом `BOOKING_CONFLICT` | PASS | `gazebos/service.ts:1269`, `ps-park/service.ts:1099`. |
| `CONFIRMED → CHECKED_IN` не берёт лишней блокировки | PASS | Ранний `if (!isFromNoShow) { return prisma.booking.update(...) }` (`gazebos/service.ts:1238-1247`, `ps-park/service.ts:1068-1077`) — прямой update без транзакции, как и раньше. Подтверждено тестом `"CONFIRMED → CHECKED_IN не берёт лишней блокировки слота"` в обоих модулях, ассертящим `expect(prisma.$transaction).not.toHaveBeenCalled()`. |
| Комментарий в `state-machine.ts`, документировавший дыру, обновлён | PASS (ожидаемо) | `src/modules/booking/state-machine.ts:20-24` — заменён текст "не перепроверяет занятость... трекается в #478" на описание фикса. Это прямое следствие закрытия issue, а не отдельная фича — соответствует брифу задачи. |

### Соответствие паттерну `slot-lock.ts`
Прочитан `src/modules/booking/slot-lock.ts:29-46` (doc-comment): "Вызов обязан быть **первым** стейтментом транзакции, а конфликт-чек и запись — в той же транзакции и на том же `tx`." Оба изменённых блока строго следуют этому: `lockSlot(tx, ...)` → `tx.booking.findFirst(...)` → (если ок) `tx.booking.update(...)`, всё на одном и том же `tx`, без внешних сетевых вызовов внутри транзакции. Идентичен паттерну, уже применённому в create-веток обоих модулей (#429).

---

## Scope Check
- Scope creep: **Нет**.
- Файлов изменено: 5 — `src/modules/gazebos/service.ts`, `src/modules/gazebos/__tests__/service.test.ts`, `src/modules/ps-park/service.ts`, `src/modules/ps-park/__tests__/service.test.ts`, `src/modules/booking/state-machine.ts` (только doc-comment). Ровно то, что описано в брифе задачи, ни одного лишнего модуля — далеко не 5+ модулей из правила #5 CLAUDE.md.
- Изменений `package.json`/`package-lock.json` нет — новых зависимостей не появилось.
- Роуты (`src/app/api/gazebos/bookings/[id]/checkin/route.ts`, `src/app/api/ps-park/bookings/[id]/checkin/route.ts`) не тронуты — подтверждено чтением: не входят в diff и явно не должны были входить, т.к. катчат `error.code` универсально.
- Никакого рефакторинга за пределами двух конкретных веток `isFromNoShow` не произошло.

---

## Качество кода
- TypeScript strict: OK — `npx tsc --noEmit -p tsconfig.json` не даёт ошибок в затронутых файлах; `any` в diff не встречается (`git diff main...HEAD | grep -n ': any\|as any'` — пусто).
- ESLint: OK — `npx eslint` на всех 5 изменённых файлов чист.
- Zod валидация: не применимо (у `checkInBooking(bookingId, managerId)` нет новых пользовательских полей — оба параметра приходят из `params`/`session.user.id`, как и раньше).
- API формат: OK — `apiResponse`/`apiError` не изменены, `BOOKING_CONFLICT` долетает через существующий `catch` в обоих роутах (`return apiError(error.code, error.message)`), формат ответа не меняется.
- Мутации в `AuditLog`: не изменены — `logAudit(session.user.id, "booking.checkin", ...)` в обоих роутах вызывается как и раньше, после успешного `checkInBooking`; при `BOOKING_CONFLICT` (исключение) вызов `checkInBooking` бросает до возврата, `logAudit` не срабатывает — корректно, лишний аудит-лог не пишется на неудачную попытку.
- Дублирование кода между gazebos и ps-park (два почти идентичных блока транзакции) — предсуществующий паттерн модуля (то же самое в create-ветках, #429), фикс просто следует уже принятому в проекте решению не выносить общий helper. Не блокер.

---

## Безопасность

### RBAC
- OK. `POST /api/gazebos/bookings/[id]/checkin` и `POST /api/ps-park/bookings/[id]/checkin` не изменены (не входят в diff). Оба по-прежнему: `auth()` → `apiUnauthorized()` если нет сессии → `requireAdminSection(session, "gazebos"|"ps-park")` → `apiForbidden()` для `USER` и для `MANAGER` без доступа к модулю (`hasAdminSectionAccess`, `src/lib/api-response.ts:76-99`) → только затем `checkInBooking(id, session.user.id)`. `managerId` берётся из `session.user.id`, не из body/params — анти-паттерн "userId из body" отсутствует.
- `BOOKING_CONFLICT` из сервиса добираются до HTTP-ответа как обычный `apiError(error.code, error.message)` (ветка `else` в обоих catch-блоках) — не 500, корректный проброс кода ошибки клиенту admin-панели.

### Secrets leakage
- `git diff main...HEAD | grep -niE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — пусто, ничего не найдено.
- Новый код не логирует `booking`/`conflict` объекты целиком, никаких PII (телефон/email гостя) в новых error-message нет — только техническое сообщение `"Слот уже занят другой бронью — реактивировать неявку нельзя"`.

### Injection
- Только Prisma (`tx.booking.findFirst`, `tx.booking.update`), параметризовано. Единственный raw SQL — внутри уже существующего, не тронутого этим диффом `lockSlot()` (`Prisma.sql` с интерполяцией через builder, не строковая конкатенация) — не новый код, ревьюился ранее в рамках #429.
- Нет `dangerouslySetInnerHTML`, нет пользовательского HTML на этом пути.

### Supply chain
- Новых зависимостей нет.

### Dangerous ops
- Нет `rm -rf`/force-push/деструктивных миграций — миграций в диффе нет вовсе.

**Security-инцидентов не найдено.**

---

## Тесты

`npm test -- --run` (полный прогон): **209 test files / 3133 tests passing**, включая изменённые файлы. Точечный прогон подтверждён отдельно:
```
npm test -- --run src/modules/gazebos/__tests__/service.test.ts src/modules/ps-park/__tests__/service.test.ts
→ 2 files, 179 tests passing
```

### Покрытие по каждому запрошенному сценарию
- **Happy path (регрессия для позднего заезда)**: `gazebos/__tests__/service.test.ts` — `describe("NO_SHOW → CHECKED_IN конфликт-чек (#478)")` → `"проходит на свободный слот..."`; `ps-park/__tests__/service.test.ts` — существующий тест `"transitions NO_SHOW → CHECKED_IN (late arrival), stores lateCheckedInAt"` корректно обновлён под новую двухшаговую последовательность моков `findFirst` (бронь → `null` под блокировкой), плюс отдельный `"делает конфликт-чек под advisory-блокировкой слота..."` в новом describe-блоке.
- **Конфликтный сценарий**: оба модуля — тест `"отдаёт BOOKING_CONFLICT и не меняет статус, если слот уже занят другой бронью"`, ассертит `rejects.toMatchObject({ code: "BOOKING_CONFLICT" })` и `expect(prisma.booking.update).not.toHaveBeenCalled()` — корректно проверяет, что при конфликте статус НЕ меняется (не просто что exception брошен).
- **`CONFIRMED → CHECKED_IN` без лишней блокировки**: оба модуля — тест `"CONFIRMED → CHECKED_IN не берёт лишней блокировки слота (уже занимал его)"`, ассертит `expect(prisma.$transaction).not.toHaveBeenCalled()`.
- Мокинг корректен: в gazebos `$transaction`-мок делегирует `tx.booking` на тот же `prisma.booking`-мок (паттерн, используемый с #429 во всём файле), поэтому `.mockResolvedValueOnce(...)`/`.mockResolvedValueOnce(...)` последовательность (сначала находка брони, потом конфликт-чек под блокировкой) реально проходит через код продукта, а не заглушается. В ps-park мок `$transaction` тоже отдаёт сам `prisma` в качестве `tx` (существующий паттерн файла) — то же самое.
- Транзитный переход валиден по `state-machine.ts`: тест `CONFIRMED → CHECKED_IN` использует `startTime` 10 минут в прошлом, что удовлетворяет условию `now >= startTime` для этого перехода (`state-machine.ts:66-69`); тесты `NO_SHOW → CHECKED_IN` используют `startTime` в будущем — переход `NO_SHOW:CHECKED_IN` в `state-machine.ts:83-85` без дополнительных условий, соответствует.
- Было бы падение тестов до фикса? Да — до фикса `checkInBooking` для `isFromNoShow` делал голый `prisma.booking.update` без обращения к `prisma.$transaction`/второму `findFirst`; тест на конфликт получил бы второй `mockResolvedValueOnce` неиспользованным и прошёл бы мимо reject (assert `rejects.toMatchObject` бы упал, т.к. `update` без транзакции не бросает `BOOKING_CONFLICT`).

---

## Что хорошо
- Точное следование уже устоявшемуся в кодовой базе паттерну `lockSlot()` + конфликт-чек в одной транзакции (#429) — ноль архитектурных отклонений, включая идентичную форму условия пересечения интервалов.
- `state-machine.ts`-комментарий, документировавший дыру как открытую, синхронно обновлён на описание фикса — не оставлен противоречащим коду.
- Тесты покрывают именно то, что просили: happy path, конфликт (с проверкой, что update НЕ вызван), и негативный кейс на отсутствие лишней блокировки для `CONFIRMED → CHECKED_IN` — не generic-заглушки, а сценарии, которые реально ловят регресс.
- `id: { not: bookingId }` в конфликт-чеке предотвращает ложный конфликт "сама с собой", отсутствующий (и не нужный) в create-ветках — правильная адаптация паттерна под контекст update, а не слепое копирование.
- Диапазон изменений строго ограничен телом бага — ни рефакторинга, ни попутных правок роутов/RBAC.

## Что можно улучшить (non-blocking, не для этого PR)
1. Предсуществующая асимметрия: начальный `findFirst` в `ps-park/service.ts:1038-1039` не фильтрует `deletedAt: null` (в отличие от `gazebos/service.ts:1209-1211`, где фильтр есть) — не тронуто этим диффом, вне скоупа #478, но кандидат для отдельного тикета согласования между модулями.

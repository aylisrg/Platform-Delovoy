# QA-отчёт: #435 — возврат часов абонемента при отмене/восстановлении ps-park-сессии

Ветка: `claude/issue-435-subscription-refund-on-cancel`, HEAD `f0d5e7f`
(коммиты `8e3cb4e` основной фикс + `f0d5e7f` фикс группировки возврата по
`subscriptionId`, найденный `code-reviewer` в первом круге).

## Вердикт: PASS

---

## 1. Regression / статическая проверка

| Проверка | Результат |
|---|---|
| `npm test -- --run` | **214 файлов / 3231 тест — все зелёные** |
| `npx tsc --noEmit` | 0 ошибок |
| `npm run lint` | 0 ошибок, 15 pre-existing warning'ов, все вне изменённых файлов (`ChatWindow.tsx`, `useChatList.ts`, `vk-community-banner.tsx`, `messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts`) |

Изменённые файлы этим PR (`git diff main...HEAD --stat`):

```
docs/runbooks/booking-operator-guide.md            |   2 +-
src/modules/booking/__tests__/restore.test.ts      | 195 +++++++
src/modules/booking/restore.ts                     |  48 ++
src/modules/subscriptions/__tests__/debit.test.ts  | 124 +++++
src/modules/subscriptions/debit.ts                 |  92 +++++
```

Scope точечный — 5 файлов, все в рамках задачи из issue, никаких новых
модулей/роутов/зависимостей.

---

## 2. Acceptance Criteria (из текста issue #435)

| AC | Статус | Проверка |
|---|---|---|
| Реализовать возврат часов (`SubscriptionTransaction` REFUND) в пути отмены/возврата ps-park-сессии | **PASS** | `refundToSubscription()` (`src/modules/subscriptions/debit.ts:157-217`), вызывается из `restore.ts:172`; `grep -rn '"REFUND"' src/` теперь находит вхождение вне `payments/service.ts` — `subscriptions/debit.ts:190` |
| Инкремент `remainingHours` | **PASS** | `debit.ts:177-184`: `tx.subscription.update({ data: { remainingHours: { increment: hours }, ...} })`, реальный Prisma `increment`, не декоративная запись |
| Пересчёт статуса DEPLETED→ACTIVE | **PASS** | `debit.ts:171-175,181`: `reactivate = sub.status === "DEPLETED"`, флип статуса в том же `update`. Прочитан enum `SubscriptionStatus` (`PENDING_PAYMENT/ACTIVE/EXPIRED/DEPLETED/CANCELLED`) — реактивация условна строго на `DEPLETED` |
| НЕ пересчитывается для EXPIRED/CANCELLED | **PASS** (неявный AC, следует из докстринга функции) | тест `debit.test.ts` "не реактивирует EXPIRED/CANCELLED — только корректирует баланс": `sub.status = "EXPIRED"` → `update` вызван без поля `status` (баланс всё равно корректируется, статус не трогается) |
| Тест: часы вернулись | **PASS** | `debit.test.ts:217-259` (happy path, `increment: 2`, `balanceAfter: 7`), `restore.test.ts:235-285` (интеграционный, тот же путь через `restoreBooking`) |
| Тест: статус пересчитан | **PASS** | `debit.test.ts:261-279`, `restore.test.ts:287-307` (DEPLETED→ACTIVE через полный путь `restoreBooking`) |

Все AC подтверждены построчным чтением, а не доверием к именам тестов —
ассерты проверяют фактические значения (`increment`, `balanceAfter`,
`hoursRefunded`, `reactivated`), не просто отсутствие исключения.

---

## 3. Независимая проверка: `restoreBooking()` — единственный путь

Не доверяя выводу предыдущих кругов ревью, проверено заново:

- `src/modules/booking/state-machine.ts` — таблица `TRANSITIONS` содержит
  ровно один исходящий переход из `COMPLETED`: `"COMPLETED:CONFIRMED"`,
  `allowedActors: ["SUPERADMIN"]` (строки 101-103). Записи
  `COMPLETED:CANCELLED` не существует вообще.
- `src/modules/ps-park/service.ts`:
  - `debitFromSession` вызывается один раз, внутри блока перехода в
    `COMPLETED` (`tx.booking.updateMany({ where: { status: { in:
    ["CONFIRMED", "CHECKED_IN"] } } })`, строка 606; `debitFromSession` —
    строка 628).
  - Обе CANCELLED-ветки `updateBookingStatus` (строки 432, 745) принимают
    исходный статус только из `{PENDING, CONFIRMED, CHECKED_IN, NO_SHOW}` —
    `COMPLETED` в списке нет.
  - `cancelBooking()` (строка 811) явно бросает `INVALID_STATUS_TRANSITION`,
    если `booking.status === "COMPLETED"` (строка 824-825).
- `grep -rn "refundToSubscription|restoreBooking(" src/` — единственный
  вызывающий `refundToSubscription` — `restore.ts:172`; `restoreBooking()`
  вызывается только из двух роутов restore (`ps-park`, `gazebos`), никаких
  других мест интеграции.

Вывод подтверждён независимо: `restoreBooking()` — действительно
единственное место в кодовой базе, где завершённая (COMPLETED)
subscription-оплаченная ps-park-бронь может сменить статус обратно, и,
соответственно, единственное место, где физически списанные часы можно и
нужно возвращать.

---

## 4. Регрессионный тест на группировку по `subscriptionId` (коммит `f0d5e7f`)

Тест `restore.test.ts:346-385` ("возвращает часы раздельно по каждому
абонементу, если бронь заряжалась с разных") проверен вручную, не только
запуском:

- Входные `subTx`: `[{sub-1, -2}, {sub-1, +2}, {sub-2, -3}]`.
- Новый код (`restore.ts:156-162`) считает `netOwedBySubscription` через
  `Map`, аккумулируя `-hoursDelta` **отдельно по каждому `subscriptionId`**:
  sub-1 → `-(-2) - (2) = 0`; sub-2 → `-(-3) = 3`.
- `owed = [...].filter(([, hours]) => hours > 0)` → только `["sub-2", 3]`.
  sub-1 не попадает в список должников (net owed 0) — корректно, часы по
  sub-1 уже возвращены прошлым restore.
- Тест ожидает: `update` НЕ вызван с `where: { id: "sub-1" }`, вызван РОВНО
  ОДИН РАЗ с `where: { id: "sub-2" }, data: { remainingHours: { increment: 3
  } } }`. Оба ассерта соответствуют фактическому поведению нового кода.

**Проверка "тест реально ловит старый баг"** — воспроизведено вручную на
`git show 8e3cb4e:src/modules/booking/restore.ts` (код ДО фикса
группировки): старый код считал единый `netOwed = -((-2)+2+(-3)) = 3` и
брал `subscriptionId = subTx[0].subscriptionId = "sub-1"` (первый элемент
массива, без `orderBy`) — вызвал бы `refundToSubscription` с
`subscriptionId: "sub-1", hours: 3`. На старом коде `update` вызывается с
`where: { id: "sub-1" }` (единственный вызов) — оба ассерта теста упали бы:
"не вызван с sub-1" (был вызван) и "вызван с sub-2" (sub-2 не тронут
вообще). Тест подтверждённо регрессионный, не декоративный.

Различение sub-1 (net owed = 0, не трогать) и sub-2 (net owed = 3, вернуть)
— проверено построчно, тест корректен.

---

## 5. Атомарность

`prisma.$transaction` открывается на `restore.ts:95` и охватывает весь блок
целиком: `lockSlot` → конфликт-чек → `booking.updateMany` (флип статуса,
строка 128) → цикл `for (const [subscriptionId, hours] of owed) { await
refundToSubscription(tx, ...) }` (строки 171-181, каждый вызов работает с
переданным `tx`, без вложенной транзакции) → `auditLog.create` (строка
185) → финальный `findUniqueOrThrow`.

- `refundToSubscription` принимает `tx: Prisma.TransactionClient` и
  использует его для всех своих операций (`subscription.findUniqueOrThrow`,
  `subscription.update`, `subscriptionTransaction.create`,
  `auditLog.create` — `debit.ts:171-214`) — отдельной вложенной транзакции
  нет.
- Если любой вызов внутри цикла бросит (например,
  `tx.subscription.findUniqueOrThrow` не найдёт подписку —
  `PrismaClientKnownRequestError`), исключение не перехватывается ни в
  цикле, ни в `restore.ts` — всплывает из callback'а `$transaction`, и Prisma
  откатывает всю interactive transaction целиком, включая уже выполненный
  `booking.updateMany` и уже отработавший `refundToSubscription` для
  предыдущей подписки в цикле (если возвратов несколько). Частичного
  состояния не остаётся — стандартное поведение Prisma interactive
  transactions, ничем не переопределено.
- Race двух параллельных `restore` того же bookingId: барьер
  `tx.booking.updateMany({ where: { id: bookingId, status: booking.status
  }, ... })` (`restore.ts:128-131`) со сторожем `res.count === 0 →
  ALREADY_RESTORED` (строки 132-137) выполняется **до** блока возврата
  подписок — Postgres сериализует конкурентные `UPDATE ... WHERE status = X`
  через блокировку строки, вторая параллельная транзакция получит `count:
  0` и упадёт до того, как дойдёт до `subscriptionTransaction.findMany` /
  `refundToSubscription`. Группировка по `subscriptionId` не меняет этот
  барьер и не открывает нового пути двойного исполнения.

---

## 6. RBAC

`refundToSubscription` не имеет собственного HTTP-входа — единственный
вызывающий путь `restoreBooking()`, вызываемый из
`src/app/api/ps-park/bookings/[id]/restore/route.ts`. Проверено построчно:

```
if (!hasRole(session.user, "SUPERADMIN")) return apiForbidden(...);   // строка 33-35
const denied = await requireAdminSection(session, MODULE_SLUG);        // строка 36-37
...
const check = await verifyUserPassword(session.user.id, parsed.data.password);  // строка 45
if (!check.ok) { ... 403 ... }
```

— роль SUPERADMIN, доступ к разделу и повторный ввод пароля проверяются до
вызова `restoreBooking`. `actorId` берётся из `session.user.id`, не из тела
запроса. Идентичная защита у gazebos-аналога
(`src/app/api/gazebos/bookings/[id]/restore/route.ts`), но там
`refundToSubscription` не вызывается (блок гейтится `moduleSlug ===
"ps-park"`, `restore.ts:151`). Никаких новых HTTP-входов, никаких путей
вызова `refundToSubscription` в обход `restoreBooking()` не найдено
(`grep -rn "refundToSubscription" src/` — единственный вызывающий вне
тестов).

### Функциональные security-кейсы (чеклист QA)

- Анонимный запрос к `/restore` → `apiUnauthorized()` (401) — без изменений
  этим PR, не затронуто.
- USER/MANAGER → `apiForbidden()` (403) через `hasRole(..., "SUPERADMIN")`
  — не затронуто.
- Подмена `userId`/`actorId` в body невозможна — `actorId` жёстко берётся
  из `session.user.id` на уровне роута, `RestoreBookingInput.actorId`
  используется без альтернативного источника.
- Data leakage: `refundToSubscription`/`restoreBooking` не формируют HTTP
  response с чувствительными полями сверх того, что уже возвращал
  `restoreBooking` до этого PR (сама бронь). `grep -iE
  '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по
  изменённым файлам — 0 совпадений.
- Rate limiting — не применимо, эндпоинт admin-only (SUPERADMIN), правило
  CLAUDE.md "Admin: no limit".

Security-инцидентов не найдено.

---

## 7. Вне зоны агентной проверки — для владельца

- Реальный вид карточки абонемента (обновлённый `remainingHours`, бейдж
  статуса ACTIVE после реактивации) в браузере админки после
  восстановления сессии — агент не кликает UI, проверено только на уровне
  API/service.
- Реальная работа модального окна повторного ввода пароля на
  `/api/ps-park/bookings/[id]/restore` — `verifyUserPassword` покрыт
  существующими unit-тестами `lib/deletion`, но полный клик-флоу
  (открытие модалки → ввод неверного/верного пароля → UI-реакция) не
  проверялся вживую.
- Отображение `subscriptionRefunds` в истории событий брони /
  audit-log-вьюхе (если такая есть в админке) — данные пишутся корректно
  (`restore.ts:201`), но визуальное представление не проверялось.

---

## 8. Наблюдение вне скоупа фикса (не блокирует вердикт)

`git status` на branch HEAD показывает, что
`docs/qa-reports/2026-08-13-issue-435-subscription-refund-on-cancel-review.md`
содержит раздел "Второй круг (коммит f0d5e7f) / Вердикт: PASS" **только в
рабочей копии, не закоммичен** — `git show f0d5e7f:docs/qa-reports/...` даёт
226 строк (только первый круг, NEEDS_CHANGES), тогда как файл на диске —
384 строки (оба круга). `git log --all -- <файл>` подтверждает единственный
коммит с этим файлом — `f0d5e7f`, без второго. Само по себе не влияет на
корректность проверяемого кода (диф `main...HEAD` для `debit.ts`/
`restore.ts`/тестов не затрагивается), но перед мержем стоит либо
закоммитить актуальную версию review-отчёта, либо не полагаться на то, что
второй круг ревью зафиксирован в git.

---

## Итог

Все acceptance criteria issue #435 подтверждены построчным чтением кода и
тестов, не только фактом их существования. Единственная точка возврата
(`restoreBooking()`) подтверждена независимо через `state-machine.ts` и все
статусные ветки `ps-park/service.ts`. Регрессионный тест на группировку по
`subscriptionId` вручную воспроизведён на коде до фикса (`8e3cb4e`) и
подтверждённо падает на старой логике `subTx[0].subscriptionId`.
Атомарность и RBAC не нарушены и не ослаблены. `npm test` (214/3231,
зелёные), `tsc --noEmit` (0 ошибок), `lint` (0 ошибок, 15 pre-existing
warning вне диффа) — все зелёные, совпадают с ожиданием задания.
Security-кейсы пройдены, инцидентов не найдено.

**Вердикт: PASS.**

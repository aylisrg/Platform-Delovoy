# Review: #435 — возврат часов абонемента при отмене/восстановлении ps-park-сессии

Ветка: `claude/issue-435-subscription-refund-on-cancel` (1 коммит `8e3cb4e`, поверх `main`).

## Вердикт: NEEDS_CHANGES

## Архитектурный вопрос (перепроверка с нуля)

Вывод разработчика подтверждён: **единственный путь возврата уже списанных
часов — `restoreBooking()`.**

Проверено вручную (`src/modules/ps-park/service.ts`, `updateBookingStatus`,
строки 283–809):

- `debitFromSession` вызывается **только** в ветке `status === "COMPLETED"`
  (строка 628), внутри `updateMany({ where: { status: { in: ["CONFIRMED",
  "CHECKED_IN"] } } })` — то есть списание физически возможно только на
  переходе в COMPLETED.
- Обе CANCELLED-ветки `updateBookingStatus` (строки 422–461 и 738–774)
  принимают исходный статус только из `{PENDING, CONFIRMED, CHECKED_IN,
  NO_SHOW}` — COMPLETED туда не входит.
- Client-facing `cancelBooking()` (строка 811) явно бросает
  `INVALID_STATUS_TRANSITION`, если `booking.status === "COMPLETED"`
  (строка 824).
- `state-machine.ts`: в таблице `TRANSITIONS` **нет записи
  `COMPLETED:CANCELLED`** вообще — переход не существует ни для одной роли.
  Единственный выход из COMPLETED — `COMPLETED:CONFIRMED`, `allowedActors:
  ["SUPERADMIN"]` (комментарий прямо ссылается на `restoreBooking()`, #511).
- `grep -rn "debitFromSession\|refundToSubscription" src/` — вызовы только в
  `ps-park/service.ts` (debit) и `booking/restore.ts` (refund); других мест
  списания/возврата нет.

Итог: гипотеза верна, других непокрытых путей отмены COMPLETED-брони,
оплаченной абонементом, не найдено. Фикс бьёт именно в ту точку, где деньги
(часы) физически теряются.

## Acceptance Criteria (из текста issue)

| AC | Статус | Комментарий |
|----|--------|-------------|
| Возврат часов (SubscriptionTransaction REFUND) в пути отмены/возврата | PASS | `refundToSubscription()` в `src/modules/subscriptions/debit.ts:157-217`, вызывается из `restore.ts:163` |
| Инкремент `remainingHours` | PASS | `debit.ts:177-184` |
| Пересчёт статуса DEPLETED→ACTIVE | PASS | `debit.ts:175,181`, тест `debit.test.ts:261-279` |
| Тест: часы вернулись | PASS | `restore.test.ts:235-285`, `debit.test.ts:217-259` |
| Тест: статус пересчитан | PASS | `restore.test.ts:287-307`, `debit.test.ts:261-279` |

Функционально happy-path и заявленные тесты реализованы корректно и точно
проверяют пересчитанные значения (не просто "не упало") — сверено построчно:
`expect(tx.subscription.update).toHaveBeenCalledWith(... increment: 2 ...)`,
проверка `hoursDelta`, `balanceAfter`, `reactivated`.

## Блокирующая находка: возврат может уйти не в ту подписку при повторном restore/re-complete

`src/modules/booking/restore.ts:154-158`:

```ts
const netOwed = -subTx.reduce((sum, t) => sum + Number(t.hoursDelta), 0);
if (netOwed > 0) {
  // Все транзакции по одной брони относятся к одному абонементу —
  // списание бывает ровно один раз, за сессию.
  const subscriptionId = subTx[0].subscriptionId;
  ...
```

Комментарий утверждает, что списание по одной брони бывает ровно один раз —
это неверно **именно из-за фичи, которую расширяет этот же PR**. Восстановление
(`restoreBooking`) переводит COMPLETED-бронь обратно в CONFIRMED (#511), после
чего её можно завершить (`updateBookingStatus` → COMPLETED) ещё раз, и снова с
абонементом — `subscriptionId` берётся из тела запроса и сверяется только с
`getActiveSubscriptionForUser(booking.userId)` (`ps-park/service.ts:534-544`),
то есть с **текущим** активным абонементом гостя, а не с тем, что был
использован в первый раз.

Реалистичный сценарий:
1. Сессия завершена, списание с абонемента A: `CHARGE(A, -2)`.
2. SUPERADMIN восстанавливает бронь (ошибочно закрыли не ту) →
   `refundToSubscription` корректно возвращает +2 в A (единственная
   транзакция — код отрабатывает правильно). Бронь снова CONFIRMED.
3. У гостя тем временем закончился/сменился абонемент A → в игре сейчас
   активен абонемент B (новая покупка). Менеджер завершает ту же бронь ещё
   раз, на этот раз с `subscriptionId = B`: `CHARGE(B, -2)`.
4. Если бронь восстанавливают повторно (тот же 24-часовой SUPERADMIN-путь,
   ничто этому не мешает): `subTx = findMany({bookingId})` вернёт все три
   записи `[CHARGE(A,-2), REFUND(A,+2), CHARGE(B,-2)]`.
   `netOwed = -(-2+2-2) = 2` — арифметика суммы верна, но
   `subscriptionId = subTx[0].subscriptionId` берёт **A** (первую по порядку
   вставки/выборки, без `orderBy`), хотя реально должок сейчас у **B**.
   Итог: A получает лишние 2 часа, которые ему уже были возвращены на шаге 2
   (задвоение), а B, у которого хост реально потерял часы, не получает
   ничего — тот самый баг, который #435 должен был закрыть, воспроизводится
   для второй подписки.

Это не гипотетическая невозможность «по схеме» — `SubscriptionTransaction`
не имеет ограничения "один bookingId → один subscriptionId", и код
`updateBookingStatus` не проверяет, что повторное завершение брони использует
тот же абонемент, что и до восстановления. Требуется либо:
- группировать `subTx` по `subscriptionId` и возвращать net-owed по каждой
  группе отдельно (`for` по уникальным `subscriptionId`, а не `subTx[0]`), либо
- явный рантайм-guard: если в `subTx` встречается более одного уникального
  `subscriptionId`, бросать понятную ошибку (`MULTIPLE_SUBSCRIPTIONS_ON_BOOKING`)
  и требовать ручной разбор — это тоже приемлемо, но код должен **отказывать**,
  а не молча возвращать деньги не туда.

Тестами это не покрыто — ни один кейс в `restore.test.ts` не подаёт `subTx` с
двумя разными `subscriptionId`.

**Файл/строка**: `src/modules/booking/restore.ts:154-171` (комментарий
строк 156-157 и допущение `subTx[0].subscriptionId`).

## Прочие пункты чеклиста

### Атомарность / race-safety — OK
Весь блок `#435` (строки 139-173) находится внутри того же
`prisma.$transaction` (открывается на строке 95), после `lockSlot` +
конфликт-чека + `booking.updateMany`, до финального `auditLog.create`.
`refundToSubscription` принимает и использует переданный `tx`
(`restore.ts:163`, `debit.ts:158`) — отдельной вложенной транзакции нет.
`findUniqueOrThrow` (`debit.ts:171`) при отсутствии подписки бросает
`PrismaClientKnownRequestError`, который не перехватывается ни в
`refundToSubscription`, ни в `restore.ts` — исключение всплывает наружу и
Prisma откатывает весь `$transaction`, включая уже выполненный
`booking.updateMany`. Подтверждено логически; отдельного теста на этот путь
нет, но это некритично — поведение стандартное для Prisma interactive
transactions.

### Decimal/number — OK, не новый риск
`hoursDelta` — `Decimal` в БД, суммируется через `Number(t.hoursDelta)`
(`restore.ts:154`), `refundToSubscription` принимает `hours: number`
(`debit.ts:127-134`). Это соответствует уже существующему контракту
`debitFromSession(hours: number)`, который `ps-park/service.ts` уже
использует для тех же дробных `billedHours` (шаг округления 15/30/60 минут,
#434). Новый код не вводит дополнительного риска потери точности сверх того,
что уже принято в модуле.

### RBAC — OK
`refundToSubscription` не имеет собственного HTTP-входа. Единственный
вызывающий путь — `restoreBooking()`, который вызывается из
`src/app/api/ps-park/bookings/[id]/restore/route.ts`, уже защищённого
`hasRole(session.user, "SUPERADMIN")` (строка 33) + `requireAdminSection`
(строка 36) + повторным вводом пароля через `verifyUserPassword` (строка 45).
Новый код добавляет side-effect внутри уже защищённого пути, не открывает
новых входов. `userId`/`actorId` берётся из `session.user.id`, не из body.

### Тесты — OK по содержанию, есть пробел (см. блокирующую находку)
`npm test -- --run` — 3230/3230 зелёных (включая новые 27 тестов). Тесты
реально проверяют значения (`increment: 2`, `hoursDelta: 2`, `reactivated:
true/false`), а не факт отсутствия исключения. Не хватает кейса с двумя
разными `subscriptionId` в `subTx` — см. блокирующую находку выше.

`npx tsc --noEmit` — чисто. `npm run lint` — 0 ошибок, только
преэкзистирующие warning'и в несвязанных файлах (`ChatWindow.tsx`,
`vk-community-banner.tsx`, `messenger/types.ts` и т.д. — не тронуты этим PR).

### Scope Check
- Scope creep: Нет.
- Изменённые файлы (5): `src/modules/subscriptions/debit.ts` (новая функция,
  симметричная существующей), `src/modules/booking/restore.ts` (точка
  интеграции), 2 тестовых файла, 1 runbook. Всё в рамках задачи из issue.
  Никаких новых модулей, роутов, зависимостей.

### Качество кода
- TypeScript strict, `any` не используется — OK.
- Zod: новых входов в API нет (внутренний сервисный код), не требуется.
- `apiResponse`/`apiError`: не затронуто, роут не менялся.
- Мутации логируются в `AuditLog`: `subscription.refund_session`
  (`debit.ts:200-214`) + существующий `booking.restore` с добавленным полем
  `subscriptionRefund` (`restore.ts:191`) — OK.
- Хардкода секретов нет.

## Security

- **Secrets leakage**: `grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по diff — 0 совпадений.
- **RBAC**: без изменений в защите; новый код выполняется только внутри уже
  SUPERADMIN-гейтованного `restoreBooking()`/`/restore` роута — см. выше. Нет
  клиентской-only проверки, нет доверия `userId` из тела запроса.
- **Injection**: нет raw SQL, нет `dangerouslySetInnerHTML`, только Prisma
  Client вызовы с типизированными аргументами.
- **Supply chain**: `package.json`/`package-lock.json` не менялись — новых
  зависимостей нет.
- **Dangerous ops**: миграции схемы в этом PR отсутствуют (модели
  `Subscription`/`SubscriptionTransaction`/`SubscriptionTransactionType.REFUND`
  уже существовали до этого коммита).

Инцидентов не найдено. Единственная находка выше — не security-инцидент
(нет privilege escalation/утечки), а логическая ошибка учёта средств
(misattribution между двумя легитимными подписками одного гостя в узком
edge-case), поэтому раздел Security сам по себе не блокирует, но вердикт
NEEDS_CHANGES выставлен по разделу "Архитектура/качество" (блокирующая
находка выше).

## Что исправить

1. **`src/modules/booking/restore.ts:154-171`** — не полагаться на
   `subTx[0].subscriptionId`. Сгруппировать транзакции по `subscriptionId`,
   посчитать `netOwed` для каждой группы отдельно и вызвать
   `refundToSubscription` по каждой подписке с ненулевым долгом (обычно
   будет ровно одна итерация — цикл не меняет поведение happy-path, но
   закрывает найденный кейс). Альтернативно — рантайм-guard, бросающий явную
   ошибку при `new Set(subTx.map(t => t.subscriptionId)).size > 1`, если
   разработчик считает мульти-подписочный возврат вне рамок #435 и хочет
   отложить его отдельным issue. Второй вариант приемлем как временное
   решение, если задокументирован (комментарий в коде + TODO/issue), но
   текущий комментарий "списание бывает ровно один раз" — фактически неверен
   и должен быть исправлен в любом случае.
2. Добавить тест в `restore.test.ts`, воспроизводящий `subTx` с двумя разными
   `subscriptionId` (после фикса — проверить, что возврат уходит в обе
   подписки корректно, либо что бросается явная ошибка, в зависимости от
   выбранного решения п.1).

## Что хорошо

- Архитектурный анализ разработчика (единственная точка возврата —
  `restoreBooking`) подтверждён построчной проверкой `state-machine.ts` и
  всех статусных веток `updateBookingStatus` — вывод верный и хорошо
  задокументирован в коде.
- `refundToSubscription` симметрична `debitFromSession`, использует тот же
  паттерн атомарности (общий `tx`, единый аудит-лог), различия (не требует
  ACTIVE, реактивирует DEPLETED, не реактивирует EXPIRED/CANCELLED) осознанны
  и прокомментированы.
- Защита от двойного возврата через `netOwed` (сумма `hoursDelta`, а не факт
  наличия CHARGE) — правильный, race-safe подход для single-subscription
  случая.
- Тесты проверяют фактические значения, а не отсутствие исключений; охвачены
  DEPLETED-реактивация, отсутствие эффекта для gazebos и для оплаты не
  абонементом.
- Runbook обновлён в том же PR, синхронно с поведением.

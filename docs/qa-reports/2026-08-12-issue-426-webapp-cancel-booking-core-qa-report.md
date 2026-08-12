# QA-отчёт: issue #426 — маршрутизация DELETE /api/webapp/bookings через booking core

**Ветка:** `claude/issue-426-webapp-cancel-booking-core` (1 коммит `7ee1323`)
**Диф:** `src/app/api/webapp/bookings/route.ts` (+50/-10), новый `src/app/api/webapp/bookings/__tests__/route.test.ts` (193 строк)

---

## 1. Тулчейн

| Проверка | Результат |
|---|---|
| `npm test -- --run` | PASS — 203 файла, 3090 тестов, всё зелёное |
| `npx vitest run .../webapp/bookings/__tests__/route.test.ts` | PASS — 10/10 тестов |
| `npx tsc --noEmit` | PASS — без ошибок |
| `npm run lint` | PASS — 0 errors, 15 warnings (все в файлах вне дифа — `session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts` — предсуществующие, не introduced этим PR) |

---

## 2. Верификация `cancelBooking()` в обоих модулях (не по описанию review, а прочитано вживую)

`src/modules/gazebos/service.ts:1074-1204` и `src/modules/ps-park/service.ts:771-877` — почти зеркальные реализации поверх общего `computeCancellationPenalty` (`src/modules/booking/cancellation.ts`) и `DEFAULT_CANCELLATION_POLICY`/`PREPAID_CANCELLATION_POLICY` (`src/modules/booking/types.ts`) — тот же движок, что использует сайт/бот, не отдельная копипаста. Подтверждено, что владеют всем перечисленным в issue:

- **State machine**: `booking.userId !== userId` → `FORBIDDEN`; `status IN (CANCELLED, COMPLETED)` → `INVALID_STATUS_TRANSITION`. Разрешённые для отмены статусы (PENDING/CONFIRMED/CHECKED_IN) проходят.
- **Штрафная политика**: `computeCancellationPenalty(startTime, now, basePrice, policy, false)`; если `penaltyApplied && !confirmPenalty` — ранний возврат `{penaltyRequired:true, penaltyAmount, basePrice}` **без побочных эффектов** (никакого обновления БД, календаря, инвентаря, уведомления, AuditLog) — то есть 5-минутный «бесплатный» баг из issue закрыт: отмена за 5 минут до старта теперь идёт по той же политике, что и сайт/бот.
- **Google Calendar**: `deleteCalendarEvent(...)`, если у брони был `googleEventId` и у ресурса `googleCalendarId`.
- **Возврат инвентаря**: `returnBookingItems(tx, id, MODULE_SLUG, items, userId)` внутри транзакции — только если бронь была `CONFIRMED` и имела `items`.
- **Уведомления**: `enqueueNotification({type:"booking.cancelled", ...})`.
- **AuditLog**: пишется в самом route-хендлере (`logAudit(user.id, "booking.cancel", ...)`) — но **только после** успешной отмены (после блока `penaltyRequired` early-return), что корректно: незавершённая отмена (ожидающая подтверждения штрафа) в аудит не попадает. Проверено тестом `"late cancellation without confirmPenalty ... does NOT write AuditLog"`.
- gazebos-специфика: авто-возврат предоплаты (`autoRefundOnCancellation`) для онлайн-оплаченных броней по отдельной политике (`PREPAID_CANCELLATION_POLICY`, >24ч — полный возврат) — это выходит за рамки списка symptoms из issue, но подтверждает, что модуль реально владеет доменной логикой, а не просто по формальному списку.

Вывод: маршрутизация через `cancelBooking()` закрывает **все** перечисленные в issue симптомы, не только часть.

---

## 3. End-to-end трассировка и поиск обходных путей

Mini App клиент (`src/app/webapp/bookings/page.tsx:45-63`, `handleCancel`) → `apiFetch("/api/webapp/bookings", {method:"DELETE", body:{bookingId}})` → `DELETE` в `route.ts`: JWT-проверка → `findFirst({id, userId})` (уже скоуплено по владельцу) → dispatch по `moduleSlug` (`gazebos`/`ps-park`) на `cancelBooking()` → маппинг `penaltyRequired`→402, успех→`logAudit`+200, thrown `BookingError`/`PSBookingError`→403/404/409.

Грепнул весь `src/app` и смежные модули на бэрные `booking.update({..., status: "CANCELLED"})` мимо `cancelBooking()`:
- Единственные прямые `prisma.booking.update` вне `gazebos/service.ts` и `ps-park/service.ts` — это soft-delete (`deletedAt`) в `src/app/api/gazebos/bookings/[id]/route.ts:199` (админский DELETE = другая операция, не отмена) и логика оплат в `src/modules/payments/subjects/booking.ts` (обновление `Payment`/подтверждение оплаты, не отмена).
- Других webapp/bot эндпоинтов, которые бы бэрно ставили `status: "CANCELLED"` на `Booking` в обход сервиса, не найдено. `src/app/api/bot/cancel-booking/route.ts` уже маршрутизирует через тот же `cancelBooking()` (это и есть паттерн, который зеркалит фикс) — но замечен **пре-существующий баг вне скоупа этого PR**: bot-роут не пробрасывает `confirmPenalty` и не проверяет `cancelled.penaltyRequired` перед `logAudit`/`apiResponse` — при штрафной отмене через бота он пишет AuditLog и отвечает 200 с телом `{penaltyRequired:true,...}`, не отменяя бронь на самом деле. Заводить отдельный issue — не в скоупе данной проверки, но стоит зафиксировать как замечание.

---

## 4. Acceptance criteria из issue #426

Явное требование: "маршрутизировать на `cancelBooking()`... Тесты: happy path + недопустимый переход/чужая бронь."

| AC | Тест(ы) в `route.test.ts` | Вердикт |
|---|---|---|
| Happy path (маршрутизация на `cancelBooking()` модуля, AuditLog, ответ) | `"happy path: dispatches to gazebos cancelBooking() and writes AuditLog"` (L93-108), `"happy path: dispatches to ps-park cancelBooking()"` (L110-124) | PASS |
| Недопустимый переход состояния | `"maps INVALID_STATUS_TRANSITION (already cancelled/completed) from ps-park to 409"` (L181-192) — мокает `PSBookingError("INVALID_STATUS_TRANSITION", ...)`, проверяет 409 | PASS |
| Чужая бронь | Две линии защиты, обе покрыты: (a) `"returns 404 when the booking isn't found (or isn't the caller's own)"` (L81-91) — реальный путь в проде, т.к. `findFirst` уже скоуплен по `userId`, чужая бронь читается как 404, не палит факт существования; (b) `"maps FORBIDDEN from cancelBooking() (someone else's booking) to 403"` (L168-179) — defense-in-depth на случай прямого вызова сервиса/гонки, мокает `BookingError("FORBIDDEN",...)`, проверяет 403 | PASS (оба смысла "чужой брони" покрыты) |

Дополнительно (сверх минимального требования, тоже проверено тестами): 401 без токена, 400 без `bookingId`, 400 на неподдерживаемый модуль (`rental`), 402 + `metadata:{penaltyAmount,basePrice}` без списания при штрафе, отсутствие AuditLog при незавершённой (штрафной) отмене, проброс `confirmPenalty=true` на повторный вызов.

**Наблюдение (не баг):** тест `"chужая бронь → FORBIDDEN → 403"` технически недостижим через этот роут в проде, потому что `findFirst` уже фильтрует по `userId` — `cancelBooking()` физически не получит вызов с чужим `bookingId` этим путём (кроме гипотетической гонки: смена владельца брони между `findFirst` и вызовом сервиса). Это нормально как defense-in-depth тест на корректность маппинга ошибок, но сам сценарий "чужая бронь" в реальности закрывается раньше, 404-веткой. Обе ветки задокументированы и протестированы — претензий нет.

---

## 5. Security-чеклист (функциональный)

- RBAC/ownership: подмена чужого `bookingId` в body не даёт отменить чужую бронь — `findFirst` скоуплен по `userId`, отдаёт 404 (не палит существование чужой брони — корректно, лучше чем 403). PASS.
- Анонимный запрос (без/невалидный JWT) → 401, `cancelBooking()` не вызывается — тест L65-70. PASS.
- Input validation: не-объект/битый JSON → 400 `VALIDATION_ERROR` до похода в БД (L72-79 — `bookingId` отсутствует). PASS.
- Data leakage: ответ 200 отдаёт только `{id, status}`, ответ 402 — только `{penaltyAmount, basePrice}`. Ничего лишнего (email/phone/internal ids) не протекает. PASS.
- AuditLog (CLAUDE.md требование): пишется на каждую успешную отмену с `source:"webapp"`, актором — реальный `user.id` из JWT (не из body). PASS.

Rate limiting на этот эндпоинт не тестировался отдельно — вне дифа PR (миддleware chain для `/api/webapp/*` не менялся), regression-риска нет.

---

## 6. Frontend gap (вне скоупа PR, но нужно зафиксировать — прямое требование заказчика проверки)

`src/app/webapp/bookings/page.tsx:45-63` (`handleCancel`) вызывает `DELETE /api/webapp/bookings` **без `confirmPenalty`** и **не различает коды ошибок**:

```ts
await apiFetch("/api/webapp/bookings", {
  method: "DELETE",
  body: JSON.stringify({ bookingId: id }),
});
haptic.notification("success");
```
```ts
} catch {
  haptic.notification("error");
}
```

А сам `apiFetch` (`src/components/webapp/TelegramProvider.tsx:225-241`) при `!data.success` выбрасывает голый `new Error(data.error?.message)` — **теряет `error.code`, HTTP-статус и `error.metadata` (`penaltyAmount`/`basePrice`)** целиком. Значит:

- Mini App структурно не может отличить 402 `PENALTY_CONFIRMATION_REQUIRED` от любой другой ошибки — просто покажет generic error-haptic.
- Нет UI для показа суммы штрафа и повторного запроса с `confirmPenalty:true` — то есть **пользователь Mini App физически не может завершить позднюю отмену** через этот флоу.
- Поведенческий регресс: до фикса баг давал бесплатно отменить бронь всегда (обходя штраф) — плохо по бизнес-политике, но пользователь получал успех. После фикса штрафные отмены в Mini App будут молча проваливаться с generic error, без пути завершить отмену. Отмены без штрафа (обычный happy path) не затронуты и работают корректно.

Для сравнения — `src/app/api/gazebos/bookings/[id]/route.ts` и ps-park эквивалент отдают тот же `PENALTY_CONFIRMATION_REQUIRED`/402 паттерн, и это уже сознательно спроектированный API-контракт (review это подтвердил) — значит фронтенд-часть для веб-админки такое умеет отображать, но у Mini App аналогичного UI нет.

Это **не блокер для бэкенд-PR** (issue #426 явно скоупнут на роут + сервис), но это реальный функциональный gap, который должен попасть в бэклог отдельным follow-up issue до того, как штрафная политика реально начнёт бить по живым пользователям Mini App.

---

## Вердикт: PASS

Бэкенд-фикс issue #426 корректен и полон: DELETE-роут теперь чистый parse+dispatch на `cancelBooking()` владеющего модуля, все перечисленные в issue симптомы (state machine, штрафная политика, инвентарь, календарь, уведомления, AuditLog) закрыты и подтверждены чтением кода сервисов, а не только по описанию ревью. Тесты покрывают happy path, недопустимый переход и чужую бронь (обе трактовки — 404 по scoped-запросу и 403 defense-in-depth), плюс security/edge-кейсы сверху требуемого минимума. `npm test`, `tsc --noEmit`, `npm run lint` чистые.

Отдельно фиксирую **некритичный для этого PR, но реальный gap**: Mini App-фронтенд (`src/app/webapp/bookings/page.tsx` + `TelegramProvider.apiFetch`) не готов к новым 402/403/404/409 ответам этого эндпоинта — не различает коды ошибок и теряет `metadata` с суммой штрафа, из-за чего штрафные отмены через Mini App будут молча падать без пути завершения. Рекомендую завести follow-up issue до того, как это дойдёт до продовых пользователей.

# QA Report: Issue #427 — Telegram bot cancel-booking скрывал penaltyRequired как success

**Дата проверки:** 2026-08-12
**Ветка:** `claude/issue-427-bot-cancel-penalty` (1 коммит: `89ee32f`)
**Модуль:** booking (gazebos + ps-park cancel path), Telegram bot (`bot/handlers/my-bookings.ts`)
**Инспектор:** QA Engineer (Claude)
**Предшествующий этап:** code-reviewer — PASS

---

## Вердикт: PASS

Диф точечный (4 файла, +334/-39, все внутри заявленного скоупа: `src/app/api/bot/cancel-booking/route.ts`, `bot/handlers/my-bookings.ts` и их тест-файлы). `src/modules/gazebos/service.ts` / `src/modules/ps-park/service.ts` **не изменены** этим PR — `confirmPenalty`-параметр и non-mutating `penaltyRequired`-ответ в них уже существовали до этой ветки; баг был именно в том, что route и бот его игнорировали. Полный `npm test`, `npx tsc --noEmit`, `npm run lint` — зелёные. Оба явных теста из acceptance bar ("happy path" и "penalty-кейс ≠ успех") написаны так, что действительно ловят старое поведение — проверено вручную прогоном логики старого кода (см. ниже), а не просто похожим названием.

---

## 1. npm test / tsc / lint (перепрогнано самостоятельно)

```
npm test -- --run
 Test Files  204 passed (204)
      Tests  3091 passed (3091)

npx tsc --noEmit
(без ошибок)

npm run lint
✖ 15 problems (0 errors, 15 warnings)
```

Все 15 warning — pre-existing, ни один не в файлах этого PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts`). 0 errors.

Точечный прогон новых тест-файлов:

```
npx vitest run src/app/api/bot/cancel-booking/__tests__/route.test.ts bot/handlers/__tests__/my-bookings.test.ts
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

5 тестов в `route.test.ts`, 6 в `my-bookings.test.ts` — все зелёные.

---

## 2. Чтение `src/app/api/bot/cancel-booking/route.ts` целиком

Подтверждено: нет ни одного пути, где `penaltyRequired: true` уезжает как success или пишет `AuditLog`.

- `result = await cancelBooking(...)` / `cancelPSBooking(...)` теперь получают четвёртым аргументом `confirmPenalty === true` (строгое сравнение — не truthy-приведение, значит нестрогие значения вроде строки `"true"` от неаккуратного клиента не пройдут; в норме бот всегда шлёт boolean).
- Сразу после вызова сервиса — явная проверка `if (result.penaltyRequired)`, которая возвращает `apiError("PENALTY_CONFIRMATION_REQUIRED", ..., 402, {penaltyAmount, basePrice})` и **делает `return` до** блока `logAudit`. Значит `AuditLog` физически не может быть записан для no-op отмены — порядок в коде (return выше logAudit), а не просто условие, гарантирует это.
- Только при `penaltyRequired === false` код идёт дальше к `logAudit` и `apiResponse(result.booking)` — обратите внимание, что `apiResponse` теперь оборачивает именно `result.booking` (распакованный объект брони), а не весь `result` конверт — это тоже было проверено тестом (см. п.5, "happy path" ловит и эту деталь).
- Других return-путей нет; catch-блок обрабатывает `BookingError`/`PSBookingError`/500 — не относится к penalty-ветке.

Вывод: путь `penaltyRequired: true → success` **закрыт полностью**, PASS.

---

## 3. Чтение `bot/handlers/my-bookings.ts` целиком

- **(a) Регистрация колбэка не сиротская.** `bot.callbackQuery(/^mybookings_confirm_penalty:(.+)$/, ...)` зарегистрирован внутри `registerMyBookingsHandler(bot)` (строки 59-63). Проверено, что сам `registerMyBookingsHandler` реально вызывается: `bot/index.ts:16` импортирует, `bot/index.ts:247` вызывает `registerMyBookingsHandler(bot)`. Плюс есть отдельный тест на wiring — `bot/__tests__/index-wiring.test.ts:49` ищет `registerMyBookingsHandler(bot` в исходнике `index.ts` (защита от регрессии "написали хэндлер, забыли подключить").
- **(b) Сообщение про штраф не утверждает успех.** Текст: `⚠️ Отмена позже допустимого срока — удерживается ${amountText}.\n\nВсё равно отменить?` — явно предупреждение + вопрос, никакого "✅ отменено". Кнопки: `✅ Да, отменить со штрафом` (callback `mybookings_confirm_penalty:{id}`) и `❌ Нет` (`mybookings:list`).
- **(c) Полная трассировка callback_data.** Гость жмёт "Да, отменить со штрафом" → `callback_data = mybookings_confirm_penalty:{bookingId}` → регекс-хэндлер извлекает `bookingId` из `ctx.match[1]` → `answerCallbackQuery("Отменяем со штрафом...")` → `performCancel(ctx, bookingId, true)` → внутри `performCancel` тело запроса `JSON.stringify({ telegramId, bookingId, confirmPenalty: true })` на `/api/bot/cancel-booking` → route читает `confirmPenalty` из body → передаёт его четвёртым аргументом в `cancelBooking()`/`cancelPSBooking()`, что заставляет сервис пройти мимо `if (cancellationResult.penaltyApplied && !confirmPenalty)` и реально закэнселить бронь. Цепочка целостна, обрыва нет.
- Обычный (не поздний) путь отмены — старая кнопка `mybookings_do_cancel:{id}` — тоже теперь идёт через тот же `performCancel(ctx, bookingId, false)`, поведение первого шага не сломано (первый диалог подтверждения "Вы уверены?" остался прежним, только реализация отмены вынесена в общую функцию).

Вывод: PASS по всем трём пунктам (a/b/c).

---

## 4. Другие вызовы `/api/bot/cancel-booking`

```
grep -rn "cancel-booking" bot/ src/
```

Единственный вызывающий код в `bot/` и `src/` — `bot/handlers/my-bookings.ts:79` (`performCancel`). Других клиентов эндпоинта (веб-UI, другие боты, скрипты) не найдено. Риска "кто-то ещё шлёт запрос без `confirmPenalty` и не обрабатывает 402 как надо" — нет, других потребителей просто не существует.

---

## 5. Acceptance criteria — соответствие явным тест-запросам

Обязательное требование из issue: "обрабатывать `penaltyRequired` явно — отдельный код ответа (не success-отмена) + диалог подтверждения штрафа в боте... Тесты роута: penalty-кейс ≠ успех; happy path."

| # | AC | Тест | Статус |
|---|----|------|--------|
| 1 | Route возвращает отдельный код (не success) при `penaltyRequired: true` | `route.test.ts`: "late cancellation (penaltyRequired) is NOT reported as success, and does NOT write AuditLog" — проверяет `status===402`, `success===false`, `error.code==="PENALTY_CONFIRMATION_REQUIRED"`, `error.metadata` содержит `penaltyAmount`/`basePrice`, `logAudit` **не** вызван | PASS |
| 2 | Happy path — обычная отмена работает и пишет AuditLog | `route.test.ts`: "happy path: cancels via gazebos and writes AuditLog" — `status===200`, `success===true`, `json.data` равен именно распакованному `result.booking` (не всему конверту `{penaltyRequired,...}`), `cancelBooking` вызван с `confirmPenalty=false`, `logAudit` вызван с правильными аргументами | PASS |
| 3 | `confirmPenalty` реально пробрасывается дальше в сервис при повторной попытке | `route.test.ts`: "confirmPenalty: true is threaded through to cancelBooking() and succeeds" — четвёртый аргумент вызова `cancelBooking`/`cancelPSBooking` равен `true`, ответ 200/success | PASS |
| 4 | RBAC: чужая бронь не отменяется, сервис не трогается | `route.test.ts`: "returns 403 for someone else's booking without calling cancelBooking()" | PASS |
| 5 | Auth: невалидный bot-token → 401 | `route.test.ts`: "returns 401 with invalid bot token" | PASS |
| 6 | Диалог подтверждения штрафа в боте — гость видит сумму, не видит ложный успех | `my-bookings.test.ts`: "does NOT show a false success on PENALTY_CONFIRMATION_REQUIRED — offers a penalty-confirm button instead" — текст не содержит "✅ Бронирование отменено", содержит сумму `500`, кнопка с `callback_data: mybookings_confirm_penalty:bk-1` присутствует | PASS |
| 7 | Повторный клик "Да, отменить со штрафом" реально шлёт `confirmPenalty: true` | `my-bookings.test.ts`: "sends confirmPenalty in the request body" | PASS |
| 8 | Обычная (не поздняя) отмена по-прежнему показывает успех | `my-bookings.test.ts`: "shows success on a real cancellation" | PASS |
| 9 | Прочие ошибки API (не penalty) отображаются как есть, сеть/auth-ошибки не роняют бота | `my-bookings.test.ts`: "shows the server error message for other failures", "shows a network-error message when the fetch throws", "shows an auth error when ctx.from is missing, without calling the API" | PASS |

### Проверка "тест ловит именно старый баг, а не просто похож по названию"

Проверено вручную (перечитан старый `route.ts` из диффа выше):

- **Старый код** для `penaltyRequired: true`: `cancelled = await cancelBooking(bookingId, user.id, "...")` (3 аргумента, `confirmPenalty` не передавался вообще — всегда дефолт `false` в сервисе), затем безусловно `await logAudit(...)`, затем `return apiResponse(cancelled)`. Так как `cancelled` в этом случае — это `{penaltyRequired: true, penaltyAmount, basePrice}` (сервис ничего не менял в БД), `apiResponse` оборачивает это как `{success: true, data: {penaltyRequired: true, ...}}` со статусом **200**. Тест "penalty-кейс ≠ успех" ожидает `status===402`, `success===false`, `error.code` — **гарантированно упал бы** на старом коде (получил бы 200/true).
- Дополнительно тест ожидает `mockLogAudit).not.toHaveBeenCalled()` — на старом коде `logAudit` вызывался безусловно → тоже упал бы.
- **"Happy path" тест** тоже не тривиален: он проверяет `json.data` равен **именно** `{id: "bk-1", status: "CANCELLED"}` (распакованный `result.booking`). На старом коде `return apiResponse(cancelled)` возвращал бы весь конверт `{penaltyRequired: false, booking: {id, status}}` как `data` — тест со strict `toEqual` тоже упал бы на старом коде. Значит это не тривиальный copy-paste тест, а реальный регрессионный тест на распаковку результата.
- Для `my-bookings.test.ts`: `performCancel` — новая экспортируемая функция, в старом коде существовавшая только как инлайновый колбэк без параметра `confirmPenalty` и без ветки на `PENALTY_CONFIRMATION_REQUIRED` (падал бы в `else`-ветку "❌ {message}" с текстом ошибки API, а не с кнопкой подтверждения штрафа) — тест на кнопку `mybookings_confirm_penalty:bk-1` не прошёл бы на старой реализации хэндлера.

Оба явных теста из acceptance bar — реальные регрессионные тесты, не formality.

---

## 6. Security-чеклист (функциональный)

- **RBAC** — чужая бронь (403, сервис не вызывается) покрыто тестом; auth по `verifyBotRequest` (401) покрыто тестом. Подмена `telegramId`/`bookingId` в body не даёт отменить чужую бронь — `booking.userId !== user.id` проверяется до вызова сервиса, до и после диффа не менялось.
- **Rate limiting** — эндпоинт internal bot-to-backend (защищён `verifyBotRequest`, не публичный пользовательский HTTP endpoint), вне периметра публичного rate-limit по конвенции `CLAUDE.md` (admin/bot-internal трафик). Не в скоупе этого PR, не регресс.
- **Input validation** — `telegramId`/`bookingId` проверяются на наличие (400 `VALIDATION_ERROR`); `confirmPenalty` — строгое `=== true` сравнение, поэтому произвольные значения (строки, числа, объекты) безопасно трактуются как `false`. Zod-схема для этого route исторически не используется (pre-existing на этом эндпоинте, не введено этим PR — не блокирует вердикт, но стоит отметить как техдолг).
- **Data leakage** — ответ `PENALTY_CONFIRMATION_REQUIRED` содержит только `penaltyAmount`/`basePrice` (числа), никаких email/phone/inn/internal ID сверх уже присутствующего `bookingId`. Ошибки 500 идут через `apiServerError()` — не содержат stack trace в теле ответа.
- **No false-success / no phantom AuditLog** — это и есть основной security/data-integrity баг issue #427 (гостя вводили в заблуждение о состоянии его брони, что могло привести к неожиданному NO_SHOW/списанию) — закрыт и покрыт тестами (см. п.5).

Security-кейсов FAIL не найдено.

---

## Ручная QA-проверка после мержа (нельзя проверить без живого бота)

Следующее не автоматизировано в этом PR и должно быть перепроверено вручную на реальном Telegram-инстансе после деплоя:

1. **Форматирование сообщения о штрафе в реальном Telegram-клиенте** — `⚠️ Отмена позже допустимого срока — удерживается {amount} ₽.` — убедиться, что `toLocaleString("ru-RU")` даёт ожидаемый формат суммы (разделитель тысяч, отсутствие копеек/лишних нулей) и что эмодзи/переносы строк рендерятся корректно на iOS/Android/Desktop клиентах.
2. **`editMessageText` на двухшаговом флоу** — цепочка "Отменить" → "Вы уверены?" → "⚠️ штраф, всё равно отменить?" → "✅ Бронирование отменено" — это 3 последовательных `editMessageText` на одном и том же сообщении. Нужно вживую убедиться, что Telegram не выдаёт `message is not modified` или `query is too old` при быстром прохождении шагов, и что клавиатура каждый раз корректно заменяется (старые кнопки не остаются висеть под новым текстом).
3. **Гонка/повторный клик** — что происходит, если гость дважды быстро жмёт "Да, отменить со штрафом" (два одновременных callback) — сервис должен либо идемпотентно вернуть уже отменённую бронь, либо второй запрос должен получить осмысленную ошибку (`INVALID_STATUS_TRANSITION`), а не необработанное исключение в боте. Юнит-тесты это не покрывают (это интеграционный/конкурентный сценарий).
4. **`answerCallbackQuery("Отменяем со штрافом...")` toast** — визуально проверить, что всплывающее уведомление показывается до завершения сетевого запроса и не блокирует UI бота при медленном ответе backend.
5. Реальный прогон полного сценария на брони с реальной поздней отменой (не мок) — увидеть фактическую сумму штрафа, посчитанную `computeCancellationPenalty`, и сверить с ожиданиями бизнес-политики.

---

## Итог

`npm test` (3091/3091), `npx tsc --noEmit` (чисто), `npm run lint` (0 errors) — все зелёные. Диф скоупирован строго по issue #427, не трогает сервисный слой (там `confirmPenalty` уже был). Оба явных теста из acceptance bar — не formality, оба реально падают на старом коде при ручной проверке логики. RBAC/audit-log integrity/data-leakage — без замечаний. Единственный вызывающий код — `my-bookings.ts`, других потребителей эндпоинта нет.

## Вердикт: PASS

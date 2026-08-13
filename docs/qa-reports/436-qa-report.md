# QA-отчёт: Issue #436 — «Заехал»/«Не пришёл» в UI броней (gazebos, ps-park)

PR #524, ветка `claude/issue-436-checkin-noshow-ui`, HEAD `59a33f4`.

## Вердикт: PASS

## Регрессия / сборка
| Проверка | Результат |
|----------|-----------|
| `npm test -- --run` | PASS — 217 test files / 3260 tests, все зелёные |
| `npx tsc --noEmit` | PASS — чисто, без ошибок |
| `npm run lint` | PASS — 0 errors, 16 warnings, все в файлах вне диффа этого PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts`) — новых warning'ов не внесено |

## Диапазон изменений
`git diff main...HEAD --stat`: 14 файлов, +809/-14. Затронуты только `gazebos` и `ps-park` (2 модуля, под порогом 5 из CLAUDE.md #5). Никаких новых `src/modules/{slug}/` — оба модуля уже `✅` в списке CLAUDE.md, обновление списка не требуется.

## Acceptance Criteria

### AC1 — Из detail-card (таймлайн) CONFIRMED-бронь можно отметить «Заехал»/«Не пришёл»
**PASS.**
- `src/components/admin/gazebos/booking-detail-card.tsx`: `canCheckIn = booking.status === "CONFIRMED"`, `canMarkNoShow = booking.status === "CONFIRMED"` — кнопки рендерятся условно, вызывают `updateStatusVia("checkin"|"no-show")` → `fetch(/api/gazebos/bookings/${id}/checkin|no-show, { method: "POST" })`.
- `src/components/admin/ps-park/booking-detail-card.tsx`: идентичный паттерн, `fetch(/api/ps-park/bookings/${id}/checkin|no-show, ...)`.
- Подтверждено тестами: `booking-detail-card.test.tsx` (gazebos) блок `describe("Заехал / Не пришёл (#436)")`, строки 196–265 — happy path для обеих кнопок, конкретные URL/method/пустое body проверены явно.

### AC2 — Из BookingActions (история/мобильный список) те же действия + late check-in NO_SHOW→CHECKED_IN
**PASS.**
- `src/components/admin/gazebos/booking-actions.tsx`: `canCheckIn = currentStatus === "CONFIRMED" || currentStatus === "NO_SHOW"`, `canMarkNoShow = currentStatus === "CONFIRMED"`.
- `src/components/admin/ps-park/booking-actions.tsx`: идентично.
- Оба компонента вызывают выделенные `/checkin`/`/no-show` роуты, не общий PATCH.
- Тест ps-park (`booking-actions.test.tsx`, строки 62–72): `renderActions("NO_SHOW")` → клик «Заехал» → POST на `/checkin`, явно проверяет именно эту ветку.
- Тест gazebos (`booking-actions.test.tsx`, диффнутый файл) — аналогичное покрытие (проверено по диффу, +116 строк с тем же паттерном).
- `BookingActions` — общий компонент, используемый в `booking-history-table.tsx` и `booking-list-mobile.tsx` обоих модулей (подтверждено `grep -l BookingActions src/components/admin/ps-park/*` → 4 файла, включая `booking-history-table.tsx` и `booking-list-mobile.tsx`, которые сами не изменены в этом PR — что верно, т.к. правка внутри `BookingActions` покрывает оба места использования сразу).

### AC3 — Для gazebos NO_SHOW-брони (не видны в таймлайне) должны быть доступны из `booking-history-table.tsx`
**PASS.**
- `src/components/admin/gazebos/booking-history-table.tsx`: добавлена кнопка «Заехал» условно на `b.status === "NO_SHOW"`, вызывающая `handleLateCheckIn()` → `POST /api/gazebos/bookings/${id}/checkin`, `stopPropagation()` (не триггерит переход в расписание), обработка ошибки через `Toast`, плюс `<option value="CHECKED_IN">Заехал</option>` в фильтре статусов.
- Обоснование в самом коде (комментарий): NO_SHOW не входит в `ACTIVE_BOOKING_STATUSES`, поэтому не попадает в `getTimeline()` — правильно диагностировано, почему именно gazebos нужен отдельный путь (ps-park решает то же через переиспользование `BookingActions` в своей history-table — асимметрия обоснована структурой кода, не недосмотром).
- Тесты `booking-history-table.test.tsx` (полностью прочитан) — 5 кейсов: кнопка видна только для NO_SHOW (не для CONFIRMED), клик шлёт правильный POST и не триггерит `push` (навигацию в расписание), тост показывает `BOOKING_CONFLICT` из ответа сервера, опция `CHECKED_IN` есть в фильтре. Тесты не тавтологичны — проверяют конкретные URL/method/side-effects.

### AC4 — CHECKED_IN-бронь всё ещё завершаема («Завершить») из detail-card
**PASS.**
- `booking-detail-card.tsx` (gazebos): `canComplete = booking.status === "CONFIRMED" || booking.status === "CHECKED_IN"` (было только `"CONFIRMED"` — corollary fix подтверждён диффом).
- `booking-detail-card.tsx` (ps-park): условие для кнопки «Завершить» изменено с `booking.status === "CONFIRMED"` на `(booking.status === "CONFIRMED" || booking.status === "CHECKED_IN")`.
- `booking-actions.tsx` (оба модуля): `canComplete` уже включал `CHECKED_IN` до этого PR (не тронуто — фикс там не требовался, диффом подтверждено отсутствие изменений в этой строке).
- Тест: `booking-detail-card.test.tsx` (gazebos), строка 250–258 — `renderCard({ status: "CHECKED_IN" })` проверяет отсутствие кнопок checkin/no-show и наличие «Завершить» одним тестом.

### AC5 — Ошибки (BOOKING_CONFLICT и т.п.) видимы пользователю, не проглатываются
**PASS.**
- Все 5 точек входа (`booking-detail-card.tsx` ×2, `booking-actions.tsx` ×2, `booking-history-table.tsx`) единообразно парсят `{ success, error: { message } }` и показывают его: detail-card — через `role="alert"` (`apiError` state), booking-actions — через `role="alert"`, gazebos history-table — через `Toast` компонент с `type: "error"`.
- Подтверждено тестами на все компоненты: `booking-detail-card.test.tsx` (gazebos, строка 212–227: `BOOKING_CONFLICT` → `alert.textContent` содержит сообщение, `onStatusChanged` НЕ вызван), `booking-actions.test.tsx` (ps-park, строка 74–89: аналогично, `refreshMock` не вызван при ошибке), `booking-history-table.test.tsx` (строка 101–120: тост с текстом ошибки).
- Fetch-level network error (catch-блок) тоже обработан — возвращает "Сетевая ошибка" вместо silent fail.

### AC6 — Кнопки не показываются для невалидных статусов (PENDING, COMPLETED, CANCELLED)
**PASS.**
- Условия `canCheckIn`/`canMarkNoShow` во всех 4 компонентах строго завязаны на `CONFIRMED` (и дополнительно `NO_SHOW` для `canCheckIn` в `BookingActions`) — для `PENDING`, `COMPLETED`, `CANCELLED` условие ложно, кнопки не рендерятся.
- В `booking-detail-card.tsx` для `CHECKED_IN` явно проверено тестом, что кнопки «Заехал»/«Не пришёл» отсутствуют, а «Завершить» есть (см. AC4).
- Тест gazebos `booking-detail-card.test.tsx` строка 243–248: `renderCard({ status: "PENDING" })` → обе кнопки `null`.
- Тест ps-park `booking-actions.test.tsx` строка 105–116: `CHECKED_IN` → «Не пришёл» отсутствует; `PENDING` → обе отсутствуют.
- В `booking-history-table.test.tsx` (gazebos) отдельно проверено, что для `CONFIRMED` кнопка «Заехал» (позднего заезда) не показывается (она там относится только к `NO_SHOW`).

## Дополнительная проверка задания (пп. 5 инструкции)

**Существование и неизменность роутов `/checkin`, `/no-show` (из #478):**
- Все 4 файла существуют: `src/app/api/gazebos/bookings/[id]/checkin/route.ts`, `.../no-show/route.ts`, ps-park аналоги — подтверждено чтением файлов.
- `git diff main...HEAD --stat -- 'src/app/api/gazebos/bookings/*' 'src/app/api/ps-park/bookings/*'` — пусто, роуты не тронуты этим PR.
- Прочитаны оба gazebos-роута: RBAC на месте (`auth()` → `apiUnauthorized()` при отсутствии сессии, `requireAdminSection(session, "gazebos")` для MANAGER/SUPERADMIN проверки доступа к модулю), мутации логируются в `AuditLog` (`logAudit(...)`). Соответствует чеклисту `agents/SECURITY.md` п.3.
- История: конфликт-чек для `NO_SHOW → CHECKED_IN` (суть #478) внесён коммитом `3d1cf82`/`62fd715` ("Closes #478"), который лежит в истории `main` до `59a33f4` этого PR — подтверждает, что бизнес-логика роутов не создавалась и не менялась в рамках #524, только UI получил кнопки к уже существующим эндпоинтам.

**Типовые правки (`types.ts`/`service.ts`):**
- `TimelineBooking.status` расширен `"PENDING" | "CONFIRMED"` → `"PENDING" | "CONFIRMED" | "CHECKED_IN"` в обоих модулях, с комментарием, почему `NO_SHOW` не включён (не входит в `ACTIVE_BOOKING_STATUSES`, использованный в `getTimeline()`).
- Соответствующий каст в `getTimeline()` синхронизирован с типом в обоих `service.ts`. Чисто типовая правка, без изменения бизнес-логики.

## Security-чеклист (функциональный, по `agents/qa.md`)
- **RBAC**: не regresses — новые кнопки рендерятся на уже RBAC-гейтящихся admin-страницах (тот же механизм, что и у существующих кнопок «Подтвердить»/«Отменить»); роуты, к которым они обращаются, независимо проверяют `auth()` + `requireAdminSection` на сервере (см. выше) — UI не расширяет поверхность доступа.
- **Data leakage**: `git diff main...HEAD | grep -iE 'password|token|secret|NEXTAUTH|TELEGRAM.*TOKEN|api[_-]key'` — единственное совпадение это pre-existing `handleDelete(password: string, ...)` (soft-delete confirmation UI, не связано с этим PR, сигнатура не менялась).
- **Rate limiting**: N/A для этого PR — новые кнопки бьют в уже существующие admin (не публичные) эндпоинты, лимиты на них не менялись.
- **Input validation**: N/A — все новые запросы это `POST` без body, эндпоинты не принимают новых полей.

## Качество тестов (выборочная проверка по заданию)
Прочитаны полностью `booking-history-table.test.tsx` (gazebos, 131 строка, 5 тестов) и `booking-actions.test.tsx` (ps-park, 117 строк, 6 тестов), а также `booking-detail-card.test.tsx` (gazebos, полностью, включая pre-existing тесты + новый блок для #436). Тесты не тавтологичны: проверяют точный URL эндпоинта, HTTP-метод, отсутствие body, side-effects (`router.refresh`/`onStatusChanged` вызван при успехе и НЕ вызван при ошибке), видимость/невидимость кнопок по статусам включая негативные кейсы, и в gazebos history-table отдельно — что клик по кнопке не триггерит непреднамеренную навигацию (`stopPropagation`).

## Заключение
Все 6 acceptance criteria реализованы и покрыты нетривиальными тестами. `npm test`, `tsc --noEmit`, `npm run lint` чисты. Диапазон изменений ограничен заявленным UI-слоем + точечной типовой правкой (`TimelineBooking.status`); `/checkin`/`/no-show` роуты и их бизнес-логика (конфликт-чек из #478) не тронуты. Scope guard соблюдён (2 модуля, оба уже в списке CLAUDE.md, `MIN_BOOKING_HOURS` из #523 сознательно не тронут). Security-регрессий не найдено.

**Вердикт: PASS**

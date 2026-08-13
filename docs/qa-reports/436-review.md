# Review: Issue #436 — «Заехал»/«Не пришёл» в UI броней (gazebos, ps-park)

## Вердикт: PASS

## Acceptance Criteria
| AC | Статус | Комментарий |
|----|--------|-------------|
| Кнопка «Заехал» (CONFIRMED→CHECKED_IN) в detail-card обоих модулей | PASS | `booking-detail-card.tsx` (gazebos, ps-park) — POST на `/checkin`, покрыто тестом |
| Кнопка «Не пришёл» (CONFIRMED→NO_SHOW) в detail-card обоих модулей | PASS | POST на `/no-show`, покрыто тестом |
| То же в `booking-actions.tsx` (используется в history/mobile-list обоих модулей) | PASS | Плюс late-checkin (NO_SHOW→CHECKED_IN) там же корректно добавлен |
| Late-checkin (NO_SHOW→CHECKED_IN) доступен там, где NO_SHOW-бронь реально видна | PASS | В gazebos `booking-history-table.tsx` (бесспойная своя рендер-логика строк) получил отдельную кнопку/тост/фильтр; в ps-park история переиспользует `BookingActions`, отдельного кода не потребовалось — корректно, соответствует описанию в issue |
| Корolarный фикс `canComplete` для CHECKED_IN в detail-card | PASS | Оба detail-card: `booking.status === "CONFIRMED" \|\| booking.status === "CHECKED_IN"`; `booking-actions.tsx` уже имел это условие до PR (`currentStatus === "CONFIRMED" \|\| currentStatus === "CHECKED_IN"`) — проверено, отдельного фикса там не требовалось |
| Использование выделенных `/checkin`, `/no-show` роутов, а не общего PATCH | PASS | Проверил `updateBookingStatus()` в `src/modules/gazebos/service.ts:1141` (аналогично ps-park) — fallback-ветка `else` для статусов вне `CONFIRMED+items/CANCELLED+items/COMPLETED` — обычный незалоченный `prisma.booking.update()`. Дизайн-решение обосновано: заявленный риск для NO_SHOW→CHECKED_IN через generic PATCH реален. `checkInBooking()` (service.ts:1325) оборачивает именно эту ветку в `lockSlot()`+conflict-check (#478) |
| `TimelineBooking.status` расширен до `CHECKED_IN`, `NO_SHOW` намеренно не включён | PASS | `getTimeline()` фильтрует по `ACTIVE_BOOKING_STATUSES = ["PENDING","CONFIRMED","CHECKED_IN"]` (`state-machine.ts:29`) — типы `types.ts` и каст в `service.ts` синхронизированы в обоих модулях |
| Тесты на happy path + error path (BOOKING_CONFLICT) во всех 4 компонентах | PASS | См. ниже |

## Scope Check
- Scope creep: Нет
- Модулей затронуто: 2 (`gazebos`, `ps-park`) — под порогом 5 из правила #5 CLAUDE.md, новых модулей не создано
- `MIN_BOOKING_HOURS` хардкод в `quick-booking-popover.tsx` (оба модуля) сознательно не тронут — подтверждено `git diff --stat`: файл отсутствует в списке изменённых. Корректно отложено в #523, как и заявлено
- Роуты `/checkin`, `/no-show` (из #478) не изменены — PR действительно только UI-слой, как заявлено

## Качество кода
- TypeScript strict: OK (`npx tsc --noEmit` — чисто)
- Никаких `any`: OK, локальные `ApiOkBody`/`ApiErrorBody` типы определены в каждом файле консистентно
- API формат: OK — везде `POST`, без тела, разбор `{ success, data | error }` единообразен в 4 компонентах
- Дублирование: `updateStatusVia()` продублирован почти дословно в 4 файлах (detail-card ×2, booking-actions ×2) — не блокер (существующий стиль модуля уже дублирует `updateStatus()` аналогично для остальных переходов), но кандидат на будущий рефакторинг в общий hook
- Мёртвый код: не найдено (`grep isNoShow` — пусто, никаких debug-артефактов)
- Тесты: OK, все зелёные (`npm test` — 217 файлов / 3260 тестов, включая новые/изменённые для этого PR)

## Безопасность
- RBAC: OK. Роуты `/checkin` и `/no-show` (не изменены в этом PR) уже вызывают `requireAdminSection(session, "gazebos"|"ps-park")` — это `auth()` + role-check + для MANAGER `hasAdminSectionAccess`/`hasModuleAccess`. Новые кнопки рендерятся на тех же admin-страницах, что уже гейтятся тем же механизмом для остальных статус-кнопок («Подтвердить», «Отменить») — новой поверхности для неавторизованных ролей не появляется
- Утечки данных: OK — секретов/токенов/PII в диффе нет (грепнул сохранённый `git diff` на `password|token|secret|NEXTAUTH|TELEGRAM.*TOKEN|api[_-]key` — единственное совпадение это pre-existing несвязанный `handleDelete(password: string, ...)` для soft-delete confirmation, не относится к этому PR)
- Injection: N/A — новых raw-запросов/HTML-рендера нет
- Supply chain: новых зависимостей не добавлено

## Проверка специфичных пунктов из задания
1. **Endpoint/method/body корректность** — во всех 4 компонентах: `fetch(.../checkin|no-show, { method: "POST" })`, без body — верно. Ошибка (`BOOKING_CONFLICT` и др.) читается из `body.error.message` и показывается через существующий `apiError`-state (`role="alert"` в detail-card, `Toast` в gazebos history-table, error-state в `BookingActions`) — покрыто тестами на все 4 компонента.
2. **RBAC** — сервер уже проверял роль до этого PR, UI не расширяет доступ за пределы уже существующего гейта страницы.
3. **Консистентность gazebos/ps-park** — идентичный паттерн `updateStatusVia()`, идентичные условия `canCheckIn`/`canMarkNoShow`. Проверил потенциальное расхождение: в `booking-actions.tsx` `canCheckIn` включает `NO_SHOW` (для позднего заезда), а в `booking-detail-card.tsx` — только `CONFIRMED`. Это не баг: `booking-detail-card` рендерится исключительно из `timeline-grid.tsx`/`mobile-timeline.tsx`, чьи данные идут через `getTimeline()`, который фильтрует по `ACTIVE_BOOKING_STATUSES` — NO_SHOW туда физически не попадает, так что ветка была бы мёртвой в этом компоненте. Разница обоснована структурой данных, не недосмотром.
4. **`canComplete` corollary fix** — проверено, в `booking-actions.tsx` условие `canComplete = currentStatus === "CONFIRMED" || currentStatus === "CHECKED_IN"` уже существовало до этого PR (сам компонент не менял эту строку — правка добавлена только `canCheckIn`/`canMarkNoShow` рядом), т.е. там аналогичного пробела не было и никакого фикса не требовалось.
5. **Тесты** — не тривиальны: проверяют URL, method, отсутствие body, happy-path (`onStatusChanged`/`router.refresh` вызван), error-path (`BOOKING_CONFLICT` показан, callback НЕ вызван), видимость кнопок по статусам (включая негативные case — кнопка не показывается для PENDING/CHECKED_IN), для gazebos history-table — что клик не триггерит переход в расписание (`stopPropagation`) и что фильтр статусов получил опцию CHECKED_IN.
6. **Scope creep** — подтверждено, 2 модуля, PRD-list в CLAUDE.md не требует изменений (gazebos/ps-park уже ✅ в списке).
7. **Мёртвый код** — не найдено.

## Что хорошо
- Дизайн-решение (выделенные роуты вместо generic PATCH) подтверждено чтением реального кода `updateBookingStatus()`/`checkInBooking()` — рационале в PR корректно отражает поведение сервиса.
- Комментарии в коде хорошо документируют, почему `NO_SHOW` исключён из `ACTIVE_BOOKING_STATUSES`/timeline и почему понадобился отдельный путь в gazebos history-table.
- Полное покрытие error-path (`BOOKING_CONFLICT`) во всех новых обработчиках — редкая аккуратность для UI-PR.
- Осознанное решение не чинить `MIN_BOOKING_HOURS` в рамках этого PR и явная ссылка на follow-up issue.

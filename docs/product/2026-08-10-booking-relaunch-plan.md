# План перезапуска модуля бронирования (беседки + PS Park)

Дата: 2026-08-10 · Статус: утверждён владельцем (охват: оба модуля; задачи: GitHub Issues)
Связанные документы: QA-отчёт `docs/qa-reports/2026-08-10-booking-relaunch-audit.md`, чек-лист дня перезапуска `docs/releases/2026-08-booking-relaunch-checklist.md`, инструкция операторов `docs/runbooks/booking-operator-guide.md`.

## 1. Контекст

Публичное бронирование беседок отключено тумблером `Module.config.publicBookingEnabled` (PR #377); Telegram-уведомления gazebos + ps-park отключены workflow `disable-gazebos-pspark-channel.yml` (chat ID сохранены, включение — `/admin/monitoring`). Код бронирования жив (Booking Engine v2, ЮKassa, ~2825 зелёных тестов), но аудит 2026-08-10 подтвердил ряд багов, часть из которых блокирует перезапуск. Параллельно администраторы переводятся с бумажных журналов на календари в админке.

## 2. Волны

### P0 — блокеры включения публичного тоггла

Критерий P0: баг виден публичному гостю сразу после включения, мешает операторам вести календарь в день 1, или security-дыра в публичном контуре.

| # | Фикс | Размер | Ключевые файлы |
|---|------|--------|----------------|
| P0-1 | Gazebos: `deletedAt: null` во все запросы Booking (эталон — ps-park, 18 фильтров) | M | `src/modules/gazebos/service.ts` |
| P0-2 | CHECKED_IN в таймлайне и конфликт-проверках обоих модулей; общая константа `ACTIVE_BOOKING_STATUSES` в booking core | M | оба `service.ts`, `src/modules/booking/state-machine.ts` |
| P0-3 | Карточка брони в таймлайне: показывать ошибки; «Завершить» открывает bill-модал (переиспользовать wiring pending-таблицы) | M | `booking-detail-card.tsx` ×2, `gazebo-bill-modal.tsx`, `session-bill-modal.tsx` |
| P0-4 | `/api/webapp/bookings` DELETE — через сервис отмены модуля (state machine, штраф, инвентарь, GCal, уведомления, AuditLog) | M | `src/app/api/webapp/bookings/route.ts` |
| P0-5 | `bot/cancel-booking`: не отвечать 200 «успехом» при `penaltyRequired` без отмены | S | `src/app/api/bot/cancel-booking/route.ts` |
| P0-6 | `session-ending-alert`: auth-секрет + Zod + HTML-escape | S | `src/app/api/ps-park/session-ending-alert/route.ts` |
| P0-7 | Гонка double-booking: конфликт-чек + create в `$transaction` с `pg_advisory_xact_lock` | M | create/reschedule в обоих `service.ts` |
| P0-8 | Инструкция операторов (docs-only) — готова в этом PR | M | `docs/runbooks/booking-operator-guide.md` |

Порядок PR: P0-1 → P0-2 → P0-7 (все трогают конфликт-чеки gazebos, мержить последовательно) → P0-3 (UI). P0-4 / P0-5 / P0-6 — независимы, параллельно. Каждый фикс = 1 PR с тестами в том же коммите (scope guard).

### P1 — первая неделя после перезапуска

1. Gazebos `createAdminBooking`: гость через `upsertClientByPhone` + `managerId` (паттерн ps-park `service.ts:910-925`) — сейчас брони приписаны админу, CRM-карточки не создаются.
2. Пагинация истории броней: подключить готовый `listBookingsPaginated`, page/perPage в Zod.
3. `rescheduleBooking`: вызвать `updateCalendarEvent` + уведомление клиенту/каналу.
4. Zod-схема PATCH статуса: enum статусов, `cashAmount/cardAmount ≥ 0` (иначе обходится PAYMENT_REQUIRED).
5. Живые настройки часов работы: убрать хардкод `OPEN_HOUR=8/CLOSE_HOUR=23` (5+ мест), свести к одному источнику (settings / seed `metadata.workingHours` 11:00–22:30 / JSON-LD 10–22 сейчас противоречат).
6. Subscription REFUND: возврат часов при отмене сессии, оплаченной абонементом.
7. Публикация админ-броней (телефонных) в Telegram-канал смены (вернуть событие для admin-create).
8. Кнопки Check-in / No-show в таймлайне (роуты уже есть, UI-вызовов нет); после P0-2 статус CHECKED_IN становится рабочим.
9. Поиск по имени/телефону в истории броней.
10. Редактирование даты/беседки в `booking-edit-form.tsx` (PATCH уже умеет).
11. Бэкфилл прошлых броней для админ-роли (снять `DATE_IN_PAST` флагом) — если решим переносить бумажный журнал.

### P2 — бэклог (сводные issues)

- UX календаря: недельный вид, drag-drop переноса, печатный лист дня, автокомплит клиента по телефону, поле комментария/email в квик-форме, причина отмены, UI создания ресурсов.
- Блокировка слотов / blackout-даты (сейчас только `Resource.isActive`, который прячет и историю).
- Hardening: DB exclusion constraint (btree_gist по resource + tstzrange) поверх P0-7.
- Чистка: `admin-booking-form.tsx` ×2 (703 строки мёртвого кода по ADR), дубль ps-park history-таблиц, неиспользуемые роуты после P1-8.
- Тест-долг: route-тесты бронирования, cron-роуты, `subscriptions/validation.ts`, gazebos `checkInBooking`/`markNoShow`.
- Docs: CLAUDE.md `src/middleware.ts` → `src/proxy.ts`.

## 3. Критерии готовности к флипу тоггла

1. Все P0-PR смержены, задеплоены, `npm test` зелёный.
2. Чек-лист `docs/releases/2026-08-booking-relaunch-checklist.md` пройден полностью (Telegram-каналы, GCal, цены, смоук).
3. Администраторы прочитали `docs/runbooks/booking-operator-guide.md`, владелец провёл разбор.

## 4. Процесс исполнения

- Задачи заведены как GitHub Issues (лейблы модуля + приоритет). Один issue = один PR.
- Исполнение — сессиями на Sonnet 5 (модель выбирается при создании сессии / `/model sonnet`); Fable-сессия использована только для аудита и планирования.
- Fix-PR обязан: тесты в том же коммите, `apiResponse()/apiError()`, Zod, ссылку на issue, зелёный CI.

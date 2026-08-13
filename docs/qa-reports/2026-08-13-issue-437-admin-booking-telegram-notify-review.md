# Review: Issue #437 — публиковать телефонные/админ-брони в Telegram-канал смены

## Вердикт: PASS

Branch: `claude/issue-437-admin-booking-telegram-notify`, HEAD `33d4949`.
Compared against `main` via `git diff main...claude/issue-437-admin-booking-telegram-notify`.

## Acceptance Criteria (из текста issue #437)

| AC | Статус | Комментарий |
|----|--------|-------------|
| Отдельное событие/шаблон для админ-броней (`booking.admin_created`), не резервируя показ неоплаченных публичных PENDING | PASS | Новый шаблон в `channelTemplates` для `gazebos`/`ps-park` в `src/modules/notifications/module-channel.ts:80-81,108-109`; `booking.confirmed`/`booking.created` по-прежнему не имеют записи в `channelTemplates` — комментарий на строках 63-70 подтверждает намерение, а сам объект содержит только `booking.paid`, `booking.admin_created`, `booking.cancelled`, `booking.completed`, `booking.deleted`/`reminder`/`rescheduled`/`ending_soon` — `booking.confirmed` там нет. Значит нет риска, что публичная бронь, подтверждённая вручную, тоже начнёт постить в канал. |
| Дублирования поста для админ-брони нет | PASS | В `createAdminBooking` (gazebos `service.ts:584-611`, ps-park `service.ts:1076-1096`) остаётся один вызов `enqueueNotification({type:"booking.confirmed"...})` (клиентский DM, не тронут) плюс новый `enqueueNotification({type:"booking.admin_created"...})`. Т.к. `booking.confirmed` не имеет канал-шаблона, `dispatchModuleChannel` для него всегда возвращает `null` (`renderChannelMessage` → `template` undefined → return null, `module-channel.ts:124-127`) и ничего не постит — двойного поста в канал не возникает. |
| Тест: dispatch с шаблоном при `createAdminBooking` | PASS | `src/modules/gazebos/__tests__/service.test.ts:969-991` и `src/modules/ps-park/__tests__/service.test.ts:1969-1991` проверяют, что `enqueueNotification` вызывается с `type: "booking.admin_created"` и корректным `data` (clientName/clientPhone/bookingId). `src/modules/notifications/__tests__/module-channel.test.ts` добавляет 3 кейса: рендер шаблона для gazebos, для ps-park, и отсутствие поста, если событие не включено в `telegramChannelEvents` module-конфига. |
| Формат сообщения — решение реализующей сессии (issue явно оставляет это на PO/владельца) | Note, не блокирует | См. раздел "Процесс" ниже. |

## Проверка технических рисков из задания

1. **"Нет двойного поста"**: подтверждено чтением `module-channel.ts` целиком — `booking.confirmed` действительно не имеет шаблона ни для `gazebos`, ни для `ps-park`. Единственная запись, которая могла бы конфликтовать, — `booking.paid`, но она использует онлайн-оплату (другой источник события), не относится к `createAdminBooking`.
2. **`EVENT_ROUTING` для `notify()`**: прочитан `src/modules/notifications/service.ts:27-32` — `routing = EVENT_ROUTING[event.type]`; для `booking.admin_created` `routing = {client:false, admin:false}` — объект truthy, `if (!routing)` не срабатывает, `console.warn("Unknown event type")` не вызывается; `routing.client` и `routing.admin` оба `false` → ни `notifyClient`, ни `notifyAdmin` не планируются. Тихий no-op, идентично `booking.paid`/`order.paid`. Подтверждено.
3. **Соответствие полей данных**: шаблон обращается к `d.resourceName`, `d.date`, `d.startTime`, `d.endTime`, `d.clientName`, `d.clientPhone`, `adminLink(...,d)` → `d.bookingId`. Все эти ключи присутствуют в payload нового `enqueueNotification` вызова (`resourceName: resource.name, date, startTime, endTime, clientName, clientPhone, bookingId: booking.id`) — совпадение точное, опечаток не найдено.
4. **HTML-экранирование**: `escapeHtml()` применён к `d.resourceName`, `d.clientName`, `d.clientPhone` в обоих новых шаблонах, зеркально соседним шаблонам (`booking.paid`, `booking.cancelled`). `d.date`/`d.startTime`/`d.endTime` не экранируются, но это последовательно с остальными шаблонами в файле (эти поля — форматированные сервером строки, не сырой пользовательский ввод) — не regression, не новый паттерн.
5. **RBAC / fire-and-forget**: `createAdminBooking` вызывается только из `POST /api/gazebos/admin-book` и `POST /api/ps-park/admin-book` — оба route-хендлера не изменены этим PR и по-прежнему требуют `hasRole(session.user, "MANAGER")` до вызова сервиса (проверено чтением `src/app/api/gazebos/admin-book/route.ts`). `enqueueNotification()` (`src/modules/notifications/queue.ts:11-45`) — синхронная `void`-функция, вся асинхронная работа обёрнута в `Promise.resolve().then(...).catch(...)`; она не может бросить исключение в вызывающий код и не блокирует транзакцию/ответ `createAdminBooking`.
6. **Scope**: изменения затрагивают `notifications`, `gazebos`, `ps-park` — все три уже существующие модули из реестра CLAUDE.md, новых модулей не создано. `telegram-channel-form.tsx` в обоих модулях действительно управляется данными: `GAZEBO_CHANNEL_EVENTS.map(...)` (`src/components/admin/gazebos/telegram-channel-form.tsx:189`) — новый label автоматически появится чекбоксом без правки компонента. `package.json`/`package-lock.json` не менялись — новых зависимостей нет.
7. **Качество тестов**: новые ассерты проверяют не только факт вызова, но и конкретное содержимое — точный `type`, `data` объект (`expect.objectContaining` с реальными значениями clientName/clientPhone/bookingId) и рендер текста шаблона (`text.toContain("по телефону")`, `toContain("+79991234567")`, negative-case на отключённый event type). Не тавтологичны.

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — правки строго ограничены новым событием/шаблоном канала и его подключением в двух `createAdminBooking`

## Качество кода
- TypeScript strict: OK (без `any`, `enqueueNotification`/типы `NotificationEvent` не изменены)
- Zod валидация: OK — `GAZEBO_CHANNEL_EVENT_TYPES`/`PS_PARK_CHANNEL_EVENT_TYPES` (Zod-валидируемый список admin-настроек канала) дополнен новым типом события
- API формат: N/A — PR не добавляет и не меняет API-роуты
- Тесты: OK, `npm test -- --run` → 231 test files / 3469 tests passed (включая 5 новых)

## Безопасность

- **Secrets leakage**: `grep -iE '(password|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key|executeRawUnsafe|dangerouslySetInnerHTML)'` по всему diff — совпадений нет.
- **RBAC**: не тронута — `createAdminBooking` уже был MANAGER-gated до PR, PR не добавляет новую точку входа. `userId` берётся из уже существующего `clientUserId` (resolved через `upsertClientByPhone`), не из body напрямую.
- **Injection**: нет raw SQL, нет новых Prisma raw-запросов. Telegram HTML injection закрыт `escapeHtml()` на всех пользовательских полях (`clientName`, `clientPhone`, `resourceName`) в новом шаблоне — консистентно с существующими шаблонами.
- **Supply chain**: `package.json`/`package-lock.json` не изменены, новых зависимостей нет.
- **Dangerous ops**: нет `rm -rf`, force-push, деструктивных миграций — миграций вообще нет (Prisma schema не тронута).

Инцидентов не найдено.

## Что хорошо
- Точное попадание в первопричину: явно проверено чтением `module-channel.ts`, что `booking.confirmed` не имеет шаблона — это ключевая гарантия отсутствия дубликата, и PR её не нарушает.
- Комментарии в коде (`events.ts:29-33`, `module-channel.ts:72-74`, `validation.ts`) явно объясняют, почему добавлено именно новое событие, а не резервирован `booking.confirmed`/`booking.created` — снижает риск, что кто-то в будущем случайно "восстановит" публичный PENDING-шаблон.
- Тесты покрывают все три угла: рендер для обоих модулей + negative-case на выключенный тип события в конфиге канала.
- Реализация полностью зеркальна между gazebos и ps-park (включая структуру комментариев) — соответствует существующему паттерну "ps-park как зеркало gazebos" в кодовой базе.

## Процесс (не блокирует вердикт)
Issue явно пометил выбор формата сообщения как решение владельца/PO ("Решение по формату сообщения — за владельцем/PO"), но реализующая сессия сделала этот выбор сама, скопировав визуальный стиль соседнего `booking.paid` (эмодзи-заголовок, ресурс/дата/время, опциональные имя/телефон клиента, admin-ссылка). Технически риск низкий: формат согласован с остальными шаблонами канала, легко меняется одной правкой строки без миграций и без влияния на другой код. Тем не менее по букве issue это было основание для `needs-owner`, а не для одностороннего решения агента. Отмечаю как процессное замечание для трекинга (стоит поднять с владельцем/PO retroactively, соответствует ли выбранный текст ожиданиям), но не считаю это причиной для NEEDS_CHANGES — код корректен, low-risk и легко обратим.

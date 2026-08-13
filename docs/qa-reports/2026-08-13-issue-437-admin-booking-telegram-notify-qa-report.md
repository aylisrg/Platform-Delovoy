# QA Report: Issue #437 — публиковать телефонные/админ-брони в Telegram-канал смены

## Вердикт: PASS

Branch: `claude/issue-437-admin-booking-telegram-notify`, HEAD `d1b449e`.
Compared against `main` via `git diff main...HEAD`.

## Regression / build gates

| Проверка | Результат |
|---|---|
| `npm test -- --run` | 231 test files / 3469 tests — все зелёные (включая 5 новых) |
| `npx tsc --noEmit` | без ошибок |
| `npm run lint` | 0 errors, 16 warnings — все warnings в файлах вне диффа PR (`ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts`); ни один warning не касается изменённых строк |

## Diff scope

```
docs/qa-reports/2026-08-13-issue-437-admin-booking-telegram-notify-review.md
src/modules/gazebos/__tests__/service.test.ts
src/modules/gazebos/service.ts
src/modules/gazebos/validation.ts
src/modules/notifications/__tests__/module-channel.test.ts
src/modules/notifications/events.ts
src/modules/notifications/module-channel.ts
src/modules/ps-park/__tests__/service.test.ts
src/modules/ps-park/service.ts
src/modules/ps-park/validation.ts
```
Подтверждено `git diff main...HEAD --name-only` и отдельно `git diff main...HEAD --stat -- 'src/app/**'` (пусто — ни один route/API-файл не тронут). RBAC-контур не затронут: `POST /api/gazebos/admin-book` / `POST /api/ps-park/admin-book` в диффе отсутствуют.

## Acceptance Criteria

| # | AC | Статус | Доказательство |
|---|---|---|---|
| 1 | `createAdminBooking` (gazebos) шлёт `booking.admin_created` отдельно от `booking.confirmed`, с данными для сообщения | PASS | `src/modules/gazebos/service.ts:584-611` — второй `enqueueNotification({type:"booking.admin_created", entityId: booking.id, userId: clientUserId, actor:"admin", data:{resourceName, date, startTime, endTime, clientName, clientPhone, bookingId}})` идёт сразу после неизменённого вызова `booking.confirmed` (строки 584-592). `clientName`/`clientPhone` деструктурированы из `input` на строке 429 — доступны в замыкании, не `undefined` по построению. |
| 2 | То же для `createAdminBooking` (ps-park) | PASS | `src/modules/ps-park/service.ts:1076-1096` — идентичная структура, `clientName`/`clientPhone` деструктурированы на строке 927. |
| 3 | `dispatchModuleChannel` реально рендерит непустое сообщение для `booking.admin_created` в обоих модулях (шаблон не `return null`) | PASS | Новые записи в `channelTemplates` — `src/modules/notifications/module-channel.ts:80-81` (gazebos, "📞 Бронь по телефону") и `:108-109` (ps-park, "📞 Сессия по телефону"). Проверено тестами `src/modules/notifications/__tests__/module-channel.test.ts` (новые кейсы, см. ниже) — `expect(global.fetch).toHaveBeenCalledTimes(1)` и содержимое текста; юнит-тест реально исполняет `dispatchModuleChannel`, не мокает `renderChannelMessage`. |
| 4 | Регрессия: `booking.created`/`booking.confirmed` по-прежнему НЕ постятся в канал (поведение PR #353 сохранено) | PASS | `channelTemplates` не содержит записей `"booking.created"`/`"booking.confirmed"` ни для `gazebos`, ни для `ps-park` (`grep -n '"booking\.' module-channel.ts` — полный список ключей не включает эти два). Существующие regression-тесты `booking.created больше НЕ постится...` (строка 99) и `booking.confirmed больше НЕ постится...` (строка 111) в `module-channel.test.ts` не изменены этим PR и продолжают проходить. |
| 5 | Клиентский DM (`booking.confirmed` → `notify()` → Telegram/email) не изменён — PR строго аддитивен | PASS | Построчное сравнение блока `enqueueNotification({type:"booking.confirmed",...})` в обоих `service.ts` до и после диффа — идентичен байт-в-байт, новый вызов вставлен только *после* него, ничего внутри старого блока не тронуто. `notify()`/`EVENT_ROUTING["booking.confirmed"]`/шаблоны клиентских сообщений (`templates.ts`) в диффе отсутствуют. |
| 6 | Новый event type валиден и переключаем в настройках Telegram-канала модуля (Zod принимает, форма сохранит без ошибки) | PASS | `"booking.admin_created"` добавлен в `GAZEBO_CHANNEL_EVENT_TYPES`/`GAZEBO_CHANNEL_EVENTS` (`src/modules/gazebos/validation.ts:69,89`) и в `PS_PARK_CHANNEL_EVENT_TYPES`/`PS_PARK_CHANNEL_EVENTS` (`src/modules/ps-park/validation.ts:77,95`) с русским лейблом "Бронь по телефону (админом)". UI-компонент (`telegram-channel-form.tsx`) рендерит чекбоксы через `.map()` по этим массивам — не требует правки. `NotificationEvent.type` типизирован как `string` (`src/modules/notifications/types.ts:7`), новый литерал не требует расширения union-типа — tsc это подтверждает (0 ошибок). |

## Проверка отсутствия двойного поста (ключевой риск фикса)

`enqueueNotification` синхронно триггерит и `notify()` (client/admin DM по `EVENT_ROUTING`), и `dispatchModuleChannel()` (канал) для каждого вызова (`src/modules/notifications/queue.ts:34-44`). Для `booking.confirmed`-вызова: `EVENT_ROUTING["booking.confirmed"]` (не тронут) продолжает слать клиентский DM; `channelTemplates` не имеет записи для `booking.confirmed` → `renderChannelMessage` возвращает `null` → `dispatchModuleChannel` рано выходит (`module-channel.ts:156-157`), в канал ничего не летит. Для нового `booking.admin_created`-вызова: `EVENT_ROUTING["booking.admin_created"] = {client:false, admin:false}` (`events.ts:32`, паттерн идентичен прекеденту `booking.paid`) → `notify()` — тихий no-op, ни один DM не уходит; `channelTemplates` содержит шаблон → канал получает ровно один пост. Итог: ровно один DM-пост клиенту + ровно один пост в канал на одну админ-бронь, без дублирования в любую сторону.

## Оценка качества новых тестов

Тесты не тавтологичны — проверяют конкретные значения, а не просто факт вызова:

- `src/modules/notifications/__tests__/module-channel.test.ts` (+3 кейса): рендер шаблона для gazebos и ps-park по-настоящему исполняет `dispatchModuleChannel` (реальный `fetch`-мок), ассертит `text.toContain("по телефону")`/`toContain(clientPhone)`/`toContain(resourceName)`, плюс negative-case — событие не в `telegramChannelEvents` → `fetch` не вызван вовсе (иначе ложный PASS проглядел бы сломанный toggle-чек).
- `src/modules/gazebos/__tests__/service.test.ts` (+1) и `src/modules/ps-park/__tests__/service.test.ts` (+1): `expect.objectContaining` проверяет точный `type`, `moduleSlug`, `entityId`, `userId` и конкретные значения `clientName`/`clientPhone`/`bookingId` в payload — не просто "вызван ли `enqueueNotification`". Отмечу, что `ps-park/service.test.ts` до этого PR действительно не имел ни одной проверки `enqueueNotification` в блоке `createAdminBooking` (импорт `enqueueNotification` добавлен этим PR же), т.е. это закрывает реальный пробел в покрытии, а не дублирует существующий тест.

## Security-чеклист (функциональный)

| Кейс | Статус | Комментарий |
|---|---|---|
| RBAC — `createAdminBooking` остаётся MANAGER-gated | PASS | Route-файлы `admin-book` не в диффе; сервисная функция не приобрела новый вход, вызывается из того же единственного места. |
| Data leakage — публичные ответы API | N/A / PASS | PR не меняет ни один API-response; `clientPhone`/`clientName` уходят только во внутренний Telegram-канал смены (не публичный эндпоинт), это ровно тот функционал, который и заказан issue. |
| Injection / HTML-escaping в новом канал-контенте | PASS | Оба новых шаблона оборачивают `resourceName`, `clientName`, `clientPhone` в `escapeHtml()` (`module-channel.ts:80-81`, `:108-109`) — консистентно с соседними шаблонами `booking.paid`/`booking.cancelled`. |
| Rate limiting | N/A | Fire-and-forget внутренний notification pipeline, не публичный HTTP endpoint. |
| Input validation (Zod) | PASS | Новый event type добавлен в существующие Zod-валидируемые enum-списки (`GAZEBO_CHANNEL_EVENT_TYPES`/`PS_PARK_CHANNEL_EVENT_TYPES`), без ослабления схемы. |

Security-кейсов, специфичных для RBAC/rate-limit/анонимного доступа, здесь по существу нет — PR не вводит новый API endpoint и не меняет авторизацию; это подтверждено, а не пропущено.

## Scope check

Изменения ограничены тремя уже существующими модулями реестра CLAUDE.md (`notifications`, `gazebos`, `ps-park`), новый модуль не создан, `Module`-таблица/health-эндпоинты не затронуты (уже существуют). 10 файлов в диффе, ни один route/`prisma/schema.prisma`/зависимости — соответствует правилу "One PR = one feature".

## Процессный вопрос (не блокирует вердикт)

Issue дословно оставляет формат сообщения "за владельцем/PO" ("Обходной путь... описан в инструкции оператора. Фикс: отдельное событие/шаблон... не возвращая шаблон для неоплаченных публичных PENDING"). Согласен с выводом code-reviewer: решение по конкретному тексту/эмодзи-стилю шаблона — низкорисковый, полностью обратимый выбор (одна строка кода, без миграций, без влияния на другую логику), и зеркалирование уже одобренного визуального паттерна `booking.paid` — разумная default-эвристика, а не самовольное расширение скоупа. Формально это могло уйти на `needs-owner` по букве issue, но по духу scope-guard (правило "no scope expansion without PO" в CLAUDE.md защищает от *новых фич/модулей*, а не от текста уведомления в рамках уже одобренной фичи) эскалация здесь избыточна. Не понижаю вердикт из-за этого; рекомендую то же, что и reviewer — ретроактивно показать текст шаблона владельцу/PO при следующей возможности, без блокировки мержа.

## Итог

Все 6 AC подтверждены чтением кода и исполнением тестов. Регрессия (`booking.created`/`booking.confirmed` не в канале) сохранена и покрыта неизменёнными существующими тестами. Двойного поста нет — прослежен полный путь `enqueueNotification → notify()/dispatchModuleChannel()` для обоих вызовов. RBAC/API-поверхность не задета. `npm test`, `tsc --noEmit`, `npm run lint` — чисто.

**Вердикт: PASS**

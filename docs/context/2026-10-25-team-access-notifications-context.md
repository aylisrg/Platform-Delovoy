# Context: 2026-10-25-team-access-notifications

Запрос владельца (2026-10-25):
> Провести ревью прав пользователей `/admin/users?tab=team`. Удалить `deniszzza@mail.ru`
> из команды — не получается, «какие-то другие поля защищают». Понять, кому какие
> уведомления доставляются в Mini App, и на странице пользователя настраивать, какие
> уведомления к нему приходят. Общая статистика полученных уведомлений и как
> пользователь на них реагирует. У одного пользователя могут быть и email, и Telegram;
> ставить галочку, если пользователь начал использовать Delovoy Bot в TG.
> Порядок: продуктолог (ТЗ) → CTO → QA.

## Исследование (координатор, до PO)

### Почему пользователь не удаляется
- `DELETE /api/users/[id]` → `deleteUser` (`src/modules/users/service.ts:199`): жёсткий
  `prisma.user.delete`. Пре-чек только `Subscription`. Иначе P2003 → 409
  `USER_HAS_DEPENDENCIES` «Нельзя удалить пользователя: на него ссылаются другие записи.»,
  UI — `alert()` (`src/components/admin/users/users-list.tsx:173-189`).
- RESTRICT-FK на `User`: `AuditLog.userId` (каждый вход пишет строку — `src/lib/auth.ts:130`,
  бот `bot/handlers/auth-deeplink.ts:349`), `ModuleAssignment` (сидер
  `scripts/seeds/nedelovoy-grants.ts` даёт всем SUPERADMIN на каждом деплое), `TaskAssignee`,
  `FeedbackItem`, `Subscription`, `MergeCandidate.*`, `Chat.createdByUserId`,
  `ChatParticipant`, `ChatMessage.senderUserId`, `ChatMessageReceipt`; косвенно
  `OutgoingNotification.channelId → UserNotificationChannel` (каскад канала упирается в RESTRICT).
- «Команда» = `role IN (SUPERADMIN, ADMIN, MANAGER)` (`users/service.ts:81-83`).
- Действия «исключить из команды» нет. Смена роли на USER (`updateUser`) меняет только
  `role` — `AdminPermission`, `ModuleAssignment`, `Module.config.notificationRecipients`
  (рассылается без перепроверки роли), подписки и Telegram-канал остаются.
- JWT: `token.role`/`adminSections` обновляются только при логине или `trigger==="update"`
  (`src/lib/auth.config.ts:92-108`, `src/lib/auth.ts:79-115`) — понижённый сохраняет доступ
  до перелогина. Отзыва сессий нет.
- Модалка «Права» для SUPERADMIN не сохраняется: GET отдаёт все нестрогие разделы, PUT
  отвечает 400 `INVALID_ROLE` (`src/app/api/admin/permissions/[userId]/route.ts:100-106`).
- `/admin/users/[id]` не существует. `/admin/clients/[id]` — только `role: USER`.
- `SUPERADMIN_TELEGRAM_ID` в `scripts/seeds/core.ts:63-66` повышает до SUPERADMIN на каждом деплое.

### Кто что получает
- Каталог `src/modules/notifications/catalog.ts`: telephony (in-app, superadminOnly),
  bookings (gazebos/ps-park), cafe, rental, payments, avito, system (release).
- Подписки — `NotificationEventPreference` (opt-in: строка `enabled=true`), Центр в Mini App
  `src/modules/notifications/webapp-center.ts`, видимость категорий —
  `src/lib/webapp/capabilities.ts:36-72` (по `getUserAdminSections`).
- Резолв получателей `notifyAdmin` (`src/modules/notifications/service.ts:303-409`):
  список модуля `Module.config.notificationRecipients` (`recipients.ts:42-49`) +
  самоподписанные (`subscribers.ts:50-80`) + групповой чат модуля/системный.
  `dispatch()` (`dispatch/dispatcher.ts`) → `OutgoingNotification` → cron `process-outgoing`.
- Расхождения: получатель из списка модуля видит в Центре «выкл»; `avito.lead.new` шлётся
  по роли (`src/app/api/avito/webhook/messenger/route.ts:301-349`), «вкл» никого не добавляет;
  `getRecipientUserIds` (все SUPERADMIN) импортирован и не используется, а UI пишет
  «суперадмины получают всегда»; ADMIN без явных разделов не видит категорий.
- Админского управления чужими подписками нет (кроме `PATCH /api/users/[id]/notify-releases`).

### Статистика
- `OutgoingNotification` (status, sentAt, failureReason, readAt, attempts), `InAppNotification.readAt`,
  legacy `NotificationLog` (группы и клиентский путь). `externalId` канала выбрасывается
  (`dispatcher.ts:196-200`). Пропуски в `dispatch()` (дубль/opt-out/DND/нет канала) строк не
  оставляют. Кликов не пишет никто: Telegram-кнопки только URL (`dispatch/channels/telegram.ts:28-34`),
  тап по карточке ленты ставит `readAt` и открывает URL без записи клика
  (`src/app/webapp/page.tsx:362-388`).
- Единственный stats-эндпоинт `src/app/api/admin/notifications/routing-map/stats/route.ts` —
  только `NotificationLog`, UI не вызывает.

### Email + Telegram
- `User` имеет `email` и `telegramId` в одной строке, но:
  - `processDeepLink` (`src/modules/telegram-link/service.ts:265`) — 409 «Этот Telegram уже
    привязан к другому аккаунту», если человек раньше входил через бота (бот создаёт
    отдельный аккаунт, `bot/handlers/auth-deeplink.ts:220`, `source: "telegram_bot"`);
  - OTP-привязка (`requestLink`) код не отправляет — только `console.log`;
  - `previewMerge`/`mergeClients` (`src/modules/clients/service.ts:1023/1112`) — только `role: USER`.
- Признака «запустил бота / заблокировал бота» нет. Без `/start` бот не может писать
  пользователю — Telegram-доставка падает.

## Решения владельца (AskUserQuestion, 2026-10-25)
1. Удаление → **только «Исключить из команды»** (offboarding, аккаунт остаётся клиентом,
   история цела). Жёсткое удаление/обезличивание — вне scope. Кнопка «Удалить» объясняет,
   что мешает, и предлагает исключение.
2. Реакция → **прочтение + клики** (трекинг-ссылки, время до реакции), по сотруднику и по типу события.
3. Управление → **админ ставит, сотрудник может менять** (та же `NotificationEventPreference`,
   AuditLog с актором). Замка «обязательное» нет.
4. Email+TG → **объединение аккаунтов сотрудников + починка самопривязки**; галочка
   «бот запущен» с датой и признак «бот заблокирован».

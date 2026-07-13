# ADR: статус оплаты в админке + Telegram-канал «только оплаченные»

- **Дата:** 2026-07-13
- **Статус:** реализовано
- **Связано:** YooKassa-интеграция (`docs/architecture/2026-07-08-yookassa-integration-plan.md`, PR #349/#351/#352)

## Контекст

После запуска онлайн-оплаты ЮKassa бронь имеет два денежных состояния — «создана» и «оплачена» — но админка их не показывала, а в выделенный Telegram-канал беседок летел `booking.created`, то есть уведомление о **ещё не оплаченной** броне (при 100 % предоплате бронь создаётся в PENDING до оплаты).

## Решение

### 1. Статус оплаты в админке (беседки + PS Park)
- Derived-статус `BookingPaymentStatus` (`PAID | AWAITING | PARTIALLY_REFUNDED | REFUNDED | FAILED | NONE`) выводится из модели `Payment` по полиморфной связи (`subjectType="BOOKING"`, `subjectId`). Методы `getBookingPaymentSummaries` (батч) и `getBookingPaymentDetail` в `src/modules/payments/service.ts`. `NONE` (нет платежа) отделён от `FAILED` (платёж был, но CANCELED), чтобы POS-бронь наличными не помечалась «Не оплачено».
- Списки броней (`/api/{gazebos,ps-park}/bookings`) обогащаются `paymentStatus` одним батч-запросом. Бейдж `BookingPaymentBadge` — в таблицах истории, мобильных карточках, таймлайне.
- Новая страница брони беседки `/admin/gazebos/bookings/[id]` (у беседок её не было; у PS Park есть `/admin/ps-park/sessions/[id]`) — детали брони + секция оплаты (сумма, способ, статус, `paidAt`, возвраты). Это цель Telegram-ссылки.
- `getSessionDetail` (PS Park) расширен онлайн-частью (`payment.online`).

### 2. Telegram-канал «только оплаченные» + ссылка (беседки + PS Park)
- Новое канал-only событие `booking.paid` (`EVENT_ROUTING = {client:false, admin:false}` — не идёт через `notify()` в client/admin, только `dispatchModuleChannel`). Эмитится из `afterBookingPaymentSucceeded` для обоих модулей строго после успешной оплаты.
- Шаблон канала `booking.paid` несёт ссылку «Открыть в панели» на конкретную бронь (`adminBookingUrl` по `moduleSlug`+`bookingId`+`NEXT_PUBLIC_APP_URL`), имена экранируются (`escapeHtml`, parse_mode=HTML).
- `booking.created` и `booking.confirmed` убраны из канал-типов и из `channelTemplates` — гарантирует, что неоплаченные брони в канал не попадают и нет двойного поста confirmed+paid. Клиентское уведомление `booking.confirmed` (DM) сохранено.
- Для PS Park построена инфраструктура канала зеркально беседкам: `PS_PARK_CHANNEL_EVENT_TYPES`, поля `telegramChannel*` в `moduleSettingsSchema`, форма настроек, `settings/test`-роут.

## Совместимость / деплой
- Схема БД не меняется — всё в `Module.config` (JSON). `telegramChannelEvents` не сидим (seed не перезаписывает `config`).
- Старые сохранённые `booking.created`/`booking.confirmed` в конфиге безопасны: их шаблоны удалены (render → null), а формы настроек фильтруют неизвестные типы при загрузке (strict `z.enum` иначе отклонит сохранение).
- **Пост-деплой (ручной шаг):** в настройках каналов беседок и PS Park включить событие «Оплачено онлайн» (`booking.paid`) — иначе канал перестанет постить `booking.created`, но `booking.paid` сам не включится.

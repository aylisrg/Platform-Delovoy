# ADR: Онлайн-чекаут кафе (subjectType ORDER) — гостевые заказы, эффекты оплаты, статистика

**Дата:** 2026-07-22
**Статус:** ACCEPTED (реализовано)
**PRD:** `docs/requirements/2026-07-22-cafe-checkout-catalog-stats-prd.md`
**База:** `docs/architecture/2026-07-08-yookassa-integration-plan.md` (§ 5.5 «Кафе — фаза 4»)

---

## Контекст

Платёжный модуль полиморфен (`subjectType + subjectId`), значение enum `ORDER`
зарезервировано под кафе. Требуется подключить заказы кафе к оплате, открыть
гостевой чекаут и построить каталог/статистику, не ломая существующие потоки
(`/api/cafe/order` для залогиненных и PS-Park attach-заказов).

## Решения

### 1. Схема
- `Order.userId` → **nullable** — гостевой QR-заказ не имеет пользователя.
  Контакт для чека живёт на `Payment.customerEmail/customerPhone`; полей
  guest-имени на Order нет — сценарию у кассы они не нужны.
- `Order.paidAt` — факт онлайн-оплаты; отдельное измерение от `status`.
- `Order.comment` — персистируется (валидировался и терялся — латентный баг).
- `OrderItem.name` — **снапшот названия** на момент заказа (`menuItemId` —
  строка без FK): статистика и чеки переживают переименования/удаления меню.
  Backfill в миграции; читатели используют `name ?? lookup ?? "—"`. Категория
  НЕ снапшотится — резолвится по текущему меню, фолбэк «Прочее».
- `FinancialTransaction` **без** колонки `orderId`: связь через
  `metadata.orderId` — как уже делает `REFUND` (леджер неизменяемый, запросы
  статистики идут по Order, а не по леджеру).

### 2. Эффекты оплаты — `src/modules/payments/subjects/order.ts`
Зеркало `subjects/booking.ts`, регистрация в `switch` сервисных
`applySubjectEffectsOnSuccess/OnCancel` + post-commit hook в `markSucceeded`:
- **success (в транзакции)**: CAS `updateMany({ paidAt: null })` — повторный
  вебхук = no-op без задвоения леджера; самообслуживание (`!deliveryTo &&
  status=NEW`) → сразу `DELIVERED` (владелец: персонал ничего не нажимает);
  с доставкой — остаётся `NEW`+`paidAt`, кухонная цепочка не меняется.
  `FinancialTransaction` type `ONLINE_PAYMENT`.
- **after-commit**: событие `order.paid` — канал-only (зеркало `booking.paid`,
  `{client:false, admin:false}` + шаблон в module-channel): админ-группа и так
  получает `payment.succeeded` (в `templates.ts` блокам cafe добавлены
  `paymentClient/AdminTemplates` — без этого шаблон рендерился в null).
- **cancel**: CAS `NEW`+`paidAt:null` → `CANCELLED` — авто-отмена брошенных
  корзин через TTL платежа (60 мин) + reconciliation-cron.

### 3. Чеки 54-ФЗ
`ReceiptItemInput.paymentSubject?: "service" | "commodity"` (дефолт `service`
— поведение существующих потоков не меняется). Кафе шлёт `commodity`.
Значение снапшотится в `Payment.metadata.receiptItems` и восстанавливается
в чеке возврата.

### 4. Middleware allowlist (`src/lib/auth.config.ts`) — попутный фикс
Матчер proxy закрывал ВСЕ `/api/*` кроме allowlist. До этого PR анонимные
запросы получали 401 на: `GET /api/payments/{id}` (поллинг страницы ожидания —
гость висел на спиннере), `POST /api/payments/yookassa/webhook/*` (вебхук
вообще не доходил до обработчика) и `GET /api/cron/payments-reconcile` (крон
молча падал). Гостевой чекаут кафе без них не работает → добавлены записи:
`POST /api/cafe/checkout`, `POST /api/payments/yookassa/webhook/*` (роут
fail-secure по секрету), `GET /api/payments/` (trailing slash — админский
список `/api/payments` остаётся за сессией), `GET /api/cron/payments-reconcile`
(роут сверяет CRON_SECRET). Остальные `/api/cron/*` так же заблокированы —
фикс отдельным issue, вне скоупа. Контракт зафиксирован тестом
`src/lib/__tests__/auth-config.test.ts`.

### 5. Гостевой чекаут
`POST /api/cafe/checkout` (public POST, IP rate-limit 60/мин) →
`createCheckout`: заказ (`order.placed` подавлен — персонал оповещается по
факту оплаты) → `createOnlinePayment` → redirect на `confirmationUrl`
(СБП/карта выбираются на hosted-странице ЮKassa; наш код метод не выбирает,
`paymentMethodType` возвращается вебхуком). Деградация: провайдер недоступен →
заказ остаётся + «оплатите на кассе» + `order.placed`; ошибка данных платежа
(`PAYMENT_CONTACT_REQUIRED`) → заказ `CANCELLED` + 422.

### 6. Статистика (`getCafeStats`)
«Учитываемый заказ»: `deletedAt:null`, `status != CANCELLED`, и (`paidAt !=
null` ИЛИ `status = DELIVERED`); дата — `paidAt ?? createdAt`. Покрывает
онлайн, кассовый фолбэк и менеджерские заказы. Агрегация в памяти (объёмы
кафе малы), способы оплаты — из `Payment.paymentMethodType` успешных платежей.
CSV: `;`-разделитель + UTF-8 BOM (Excel с русской локалью).

### 7. Фото меню
Диск (`CAFE_UPLOAD_DIR`, прод `/data/uploads/cafe`) — клон паттерна
`feedback/file-storage.ts` (5 МБ, PNG/JPG/WEBP, magic bytes, basename от
traversal). Отдача — публичный `GET /api/cafe/menu/images/[filename]` с
проверкой привязки файла к позиции в БД (анти-перебор), `Cache-Control 24h`.
`MenuItem.imageUrl` принимает и внешний URL, и served-путь.

### 8. Попутные security-фиксы (зона кафе)
`GET /api/cafe/orders` и `GET /api/cafe/orders/[id]` были без авторизации
(отдавали все заказы и имя/email клиентов). Теперь: USER — только свои,
персонал — `requireAdminSection("cafe")`.

## Отклонённые альтернативы
- **MenuCategory-модель** — категории остаются свободным текстом + datalist:
  меньше сущностей, достаточно для одного кафе.
- **`FinancialTransaction.orderId`** — metadata-связь консистентна с refund.
- **Виджет/embedded-подтверждение ЮKassa** — redirect уже реализован и покрыт;
  QR СБП рисует hosted-страница.
- **Списание склада при продаже** — scope expansion, отдельная задача.

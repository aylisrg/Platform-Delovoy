# ADR-012: Онлайн-оплата бронирования беседки через ЮKassa

## Статус
Принято

## Контекст
PRD требует принимать оплату онлайн при создании брони. Текущая схема: Booking.status = PENDING без предоплаты. Нужен платёжный провайдер с российским legal, API, документацией.

## Варианты

### Вариант A: ЮKassa (YooKassa)
- Плюсы: самый популярный в РФ, русская документация, встроенная отчётность, SDK для Node.js
- Минусы: комиссия 3.5%

### Вариант B: CloudPayments
- Плюсы: комиссия 2.8%
- Минусы: меньше готовых интеграций, хуже документация

### Вариант C: Тинькофф Касса
- Плюсы: комиссия 2.5%
- Минусы: сложная подключение, ручные согласования

## Решение
Выбран **Вариант A (ЮKassa)**. Скорость запуска важнее экономии 1% комиссии.

## Последствия

### Схема данных

```prisma
model Payment {
  id          String        @id @default(cuid())
  bookingId   String        @unique
  booking     Booking       @relation(fields: [bookingId], references: [id])
  amount      Decimal
  status      PaymentStatus @default(PENDING)
  providerRef String?       // YooKassa payment id
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

enum PaymentStatus {
  PENDING
  SUCCEEDED
  CANCELLED
  REFUNDED
}
```

### API-контракты

```
POST /api/payments/create
  RBAC: USER (owner брони) или MANAGER (модуль gazebos)
  hasModuleAccess проверка для MANAGER
  Rate limit: 10 req/min на пользователя
  Request: { bookingId: string }
  Response: { success: true, data: { confirmationUrl: string } }

POST /api/payments/webhook (ЮKassa callback)
  RBAC: публичный, проверка signature
  Rate limit: 100 req/min на IP

POST /api/payments/:id/refund
  RBAC: MANAGER (gazebos) / SUPERADMIN
  Логируется в AuditLog
```

### Миграция
`prisma migrate dev --name add_payment_model` — новая таблица, безопасна (only ADD).

### Влияние на существующие модули
- `src/modules/gazebos/service.ts` — `confirmBooking()` вызывается из payment webhook
- `src/lib/notifications.ts` — новый шаблон "Оплата подтверждена"

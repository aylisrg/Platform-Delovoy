# ADR: Редизайн UX модуля PS Park

**Дата:** 2026-04-12
**Статус:** Предложено
**Авторы:** System Architect (Claude)

---

## Контекст

Текущая админ-страница PS Park (`src/app/admin/ps-park/page.tsx`) представляет собой вертикальный список таблиц бронирований с формой бронирования, которая требует:
1. Ручного нажатия "Показать слоты" для каждой даты
2. Прокрутки до формы бронирования
3. Отсутствует визуальный обзор дня (timeline)
4. Нет понятия "активная сессия" с таймером и текущим счётом
5. Публичная страница требует ручной загрузки слотов

Менеджер PS Park обрабатывает телефонные бронирования, при этом workflow перегружен: выбрать дату, нажать кнопку, прокрутить слоты, заполнить форму. Нужно свести к минимуму кликов.

### Текущая архитектура

- **Сервер:** `getAvailability(date)` возвращает `DayAvailability[]` (ресурс + слоты)
- **Админ-страница:** Server Component загружает bookings через Prisma, рендерит таблицы
- **Форма бронирования:** Client Component `AdminBookingForm` вызывает `/api/ps-park/availability` и `/api/ps-park/admin-book`
- **Действия:** `BookingActions` (подтвердить/завершить/отменить) + `AddItemsButton`
- **Обновление:** `router.refresh()` после мутаций

---

## Рассмотренные варианты

### Вариант 1: Timeline Grid как Client Component с полной загрузкой через API

Timeline-грид полностью клиентский. Загружает данные через `GET /api/ps-park/availability` и `GET /api/ps-park/bookings`. Все обновления через polling.

**Плюсы:** Полностью реактивный UI, не зависит от серверного рендеринга.
**Минусы:** Двойная загрузка (сначала пустая страница, потом данные). Нужен спиннер. Нет SSR.

### Вариант 2: Гибрид — Server Component для начальных данных + Client Components для интерактивности

Server Component загружает начальные данные (ресурсы, бронирования дня, активные сессии) через Prisma. Передаёт props в Client Components (TimelineGrid, ActiveSessionsPanel). Мутации через API, обновление через `router.refresh()`. Активные сессии обновляются polling каждые 30 сек.

**Плюсы:** Мгновенный первый рендер (SSR). Единый паттерн с остальными админ-страницами. Меньше кода.
**Минусы:** `router.refresh()` перезагружает всю страницу (но это уже принятый паттерн проекта).

### Вариант 3: WebSocket для real-time обновлений

**Плюсы:** Мгновенные обновления.
**Минусы:** Требует отдельного WS-сервера, усложняет инфраструктуру. Overkill для 3-5 столов.

---

## Решение

**Вариант 2: Гибрид Server + Client Components.**

Это соответствует существующему паттерну проекта (страница `force-dynamic`, данные через Prisma, обновление через `router.refresh()`). Для активных сессий добавляем client-side polling каждые 30 секунд через выделенный лёгкий API-эндпоинт.

---

## Изменения схемы БД

**Не требуются.** Все необходимые данные уже доступны:
- `Booking.startTime` / `endTime` — для определения активной сессии
- `Booking.status` = `CONFIRMED` + `startTime <= now < endTime` — "активная сессия"
- `Booking.metadata.items` / `metadata.itemsTotal` — текущий счёт
- `Resource.pricePerHour` — для расчёта стоимости часов

---

## API: изменения и новые эндпоинты

### Существующие эндпоинты — без изменений

Все текущие эндпоинты продолжают работать как есть. Обратная совместимость полная.

### Новый эндпоинт: `GET /api/ps-park/timeline`

Специализированный эндпоинт для Timeline Grid. Возвращает ресурсы, слоты и бронирования для конкретной даты в формате, оптимизированном для отображения сетки.

```
GET /api/ps-park/timeline?date=2026-04-12
```

**Зачем отдельный эндпоинт вместо `/availability`:**
- `/availability` возвращает только boolean `isAvailable` без деталей бронирования
- Timeline нужны данные о бронированиях: кто, когда, статус, для отображения блоков
- Этот эндпоинт объединяет данные ресурсов + бронирований в одном запросе

**Response:**
```typescript
{
  success: true,
  data: {
    date: "2026-04-12",
    resources: [
      {
        id: "clxxx...",
        name: "PlayStation 5 №1",
        capacity: 4,
        pricePerHour: 500,
        isActive: true,
      }
    ],
    bookings: [
      {
        id: "clyyy...",
        resourceId: "clxxx...",
        startTime: "2026-04-12T10:00:00",
        endTime: "2026-04-12T12:00:00",
        status: "CONFIRMED",
        clientName: "Иванов Иван",
        clientPhone: "+7 999 123-45-67",
        metadata: {
          playerCount: 3,
          items: [...],
          itemsTotal: "350.00",
          comment: "День рождения"
        }
      }
    ],
    hours: ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00"]
  }
}
```

**Сервисная функция:**

```typescript
// src/modules/ps-park/service.ts

export async function getTimeline(date: string): Promise<TimelineData> {
  const resources = await prisma.resource.findMany({
    where: { moduleSlug: MODULE_SLUG, isActive: true },
    orderBy: { name: "asc" },
  });

  const bookingDate = new Date(date);
  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      date: bookingDate,
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    select: {
      id: true,
      resourceId: true,
      startTime: true,
      endTime: true,
      status: true,
      clientName: true,
      clientPhone: true,
      metadata: true,
    },
    orderBy: { startTime: "asc" },
  });

  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) =>
    `${(OPEN_HOUR + i).toString().padStart(2, "0")}:00`
  );

  return { date, resources, bookings, hours };
}
```

### Новый эндпоинт: `GET /api/ps-park/active-sessions`

Лёгкий эндпоинт для polling активных сессий (каждые 30 сек).

```
GET /api/ps-park/active-sessions
```

**Response:**
```typescript
{
  success: true,
  data: [
    {
      bookingId: "clyyy...",
      resourceId: "clxxx...",
      resourceName: "PlayStation 5 №1",
      clientName: "Иванов Иван",
      clientPhone: "+7 999 123-45-67",
      startTime: "2026-04-12T10:00:00",
      endTime: "2026-04-12T12:00:00",
      status: "CONFIRMED",
      pricePerHour: 500,
      hoursBooked: 2,
      hoursCost: 1000,
      items: [...],          // BookingItemSnapshot[]
      itemsTotal: 350.00,
      totalBill: 1350.00,
      // Вычисляемые на клиенте по startTime/endTime/now:
      // - elapsedMinutes, remainingMinutes, progressPercent
    }
  ]
}
```

**Сервисная функция:**
```typescript
export async function getActiveSessions(): Promise<ActiveSession[]> {
  const now = new Date();
  const today = new Date(now.toISOString().split("T")[0]);

  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: MODULE_SLUG,
      status: "CONFIRMED",
      date: today,
      startTime: { lte: now },
      endTime: { gt: now },
    },
    orderBy: { startTime: "asc" },
  });

  const resourceIds = [...new Set(bookings.map((b) => b.resourceId))];
  const resources = await prisma.resource.findMany({
    where: { id: { in: resourceIds } },
  });
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  return bookings.map((b) => {
    const resource = resourceMap.get(b.resourceId);
    const metadata = b.metadata as Record<string, unknown> | null;
    const pricePerHour = Number(resource?.pricePerHour ?? 0);
    const hoursBooked = Math.ceil(
      (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60)
    );
    const hoursCost = hoursBooked * pricePerHour;
    const itemsTotal = Number(metadata?.itemsTotal ?? 0);

    return {
      bookingId: b.id,
      resourceId: b.resourceId,
      resourceName: resource?.name ?? "—",
      clientName: b.clientName ?? "—",
      clientPhone: b.clientPhone,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      pricePerHour,
      hoursBooked,
      hoursCost,
      items: (metadata?.items ?? []) as BookingItemSnapshot[],
      itemsTotal,
      totalBill: hoursCost + itemsTotal,
    };
  });
}
```

### Новый эндпоинт: `POST /api/ps-park/bookings/[id]/extend`

Продление сессии на 1 час (US-7, Should Have).

```
POST /api/ps-park/bookings/{id}/extend
Body: {} (пустой — всегда +1 час)
```

**Response:** обновлённый объект Booking.

**Логика (сервисная функция):**
```typescript
export async function extendBooking(bookingId: string, managerId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });

  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  if (booking.status !== "CONFIRMED") {
    throw new PSBookingError("INVALID_STATUS", "Продлить можно только подтверждённое бронирование");
  }

  const newEndTime = new Date(booking.endTime.getTime() + 60 * 60 * 1000);
  const newEndHour = newEndTime.getHours();
  if (newEndHour > CLOSE_HOUR || (newEndHour === 0 && CLOSE_HOUR < 24)) {
    throw new PSBookingError("BEYOND_CLOSING", "Нельзя продлить за пределы рабочего времени (до 23:00)");
  }

  // Проверка конфликта
  const conflict = await prisma.booking.findFirst({
    where: {
      moduleSlug: MODULE_SLUG,
      resourceId: booking.resourceId,
      id: { not: bookingId },
      status: { in: ["PENDING", "CONFIRMED"] },
      date: booking.date,
      startTime: { lt: newEndTime },
      endTime: { gt: booking.endTime },
    },
  });

  if (conflict) {
    throw new PSBookingError("BOOKING_CONFLICT", "Следующий час занят другим бронированием");
  }

  return prisma.booking.update({
    where: { id: bookingId },
    data: { endTime: newEndTime, managerId },
  });
}
```

### Новый эндпоинт: `GET /api/ps-park/bookings/[id]/bill`

Итоговый счёт для завершения сессии (US-8).

```
GET /api/ps-park/bookings/{id}/bill
```

**Response:**
```typescript
{
  success: true,
  data: {
    bookingId: "clyyy...",
    resourceName: "PlayStation 5 №1",
    clientName: "Иванов Иван",
    date: "2026-04-12",
    startTime: "10:00",
    endTime: "12:00",
    hoursBooked: 2,
    pricePerHour: 500,
    hoursCost: 1000,
    items: [
      { skuId: "...", name: "Coca-Cola 0.5", quantity: 2, price: 80, subtotal: 160 },
      { skuId: "...", name: "Чипсы Lay's", quantity: 1, price: 190, subtotal: 190 }
    ],
    itemsTotal: 350,
    totalBill: 1350
  }
}
```

**Сервисная функция:**
```typescript
export async function getBookingBill(bookingId: string): Promise<BookingBill> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug: MODULE_SLUG },
  });
  if (!booking) throw new PSBookingError("BOOKING_NOT_FOUND", "Бронирование не найдено");

  const resource = await prisma.resource.findUnique({ where: { id: booking.resourceId } });
  const metadata = booking.metadata as Record<string, unknown> | null;
  const items = (metadata?.items ?? []) as BookingItemSnapshot[];
  const pricePerHour = Number(resource?.pricePerHour ?? 0);
  const hoursBooked = Math.ceil(
    (booking.endTime.getTime() - booking.startTime.getTime()) / (1000 * 60 * 60)
  );
  const hoursCost = hoursBooked * pricePerHour;
  const itemsTotal = Number(metadata?.itemsTotal ?? 0);

  return {
    bookingId: booking.id,
    resourceName: resource?.name ?? "—",
    clientName: booking.clientName ?? "—",
    date: booking.date.toISOString().split("T")[0],
    startTime: booking.startTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    endTime: booking.endTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    hoursBooked,
    pricePerHour,
    hoursCost,
    items: items.map((i) => ({ ...i, subtotal: i.quantity * i.price })),
    itemsTotal,
    totalBill: hoursCost + itemsTotal,
  };
}
```

---

## Новые типы (`src/modules/ps-park/types.ts`)

```typescript
// Timeline данные для admin grid
export type TimelineData = {
  date: string;
  resources: PSTableResource[];
  bookings: TimelineBooking[];
  hours: string[]; // ["08:00", "09:00", ..., "22:00"]
};

export type TimelineBooking = {
  id: string;
  resourceId: string;
  startTime: string; // ISO datetime
  endTime: string;
  status: "PENDING" | "CONFIRMED";
  clientName: string | null;
  clientPhone: string | null;
  metadata: Record<string, unknown> | null;
};

// Активная сессия
export type ActiveSession = {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  clientName: string;
  clientPhone: string | null;
  startTime: string; // ISO
  endTime: string;   // ISO
  status: "CONFIRMED";
  pricePerHour: number;
  hoursBooked: number;
  hoursCost: number;
  items: BookingItemSnapshot[];
  itemsTotal: number;
  totalBill: number;
};

// Счёт при завершении
export type BookingBill = {
  bookingId: string;
  resourceName: string;
  clientName: string;
  date: string;
  startTime: string;
  endTime: string;
  hoursBooked: number;
  pricePerHour: number;
  hoursCost: number;
  items: (BookingItemSnapshot & { subtotal: number })[];
  itemsTotal: number;
  totalBill: number;
};
```

### Новые Zod-схемы (`src/modules/ps-park/validation.ts`)

```typescript
export const timelineQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Формат даты: YYYY-MM-DD"),
});

// Для extend — валидация не нужна (пустое тело), но эндпоинт проверяет bookingId в URL
```

---

## Архитектура компонентов

### Дерево компонентов админ-страницы

```
src/app/admin/ps-park/page.tsx (Server Component)
  |
  |-- AdminHeader (title + ReceiveStockButton)
  |
  |-- StatsRow (StatusWidget x3) — без изменений
  |
  |-- ActiveSessionsPanel (Client Component) *** НОВЫЙ ***
  |     |-- ActiveSessionCard (Client Component) *** НОВЫЙ ***
  |     |     |-- ProgressBar (время)
  |     |     |-- AddItemsButton (существующий)
  |     |     |-- ExtendSessionButton (Client Component) *** НОВЫЙ ***
  |     |     |-- CompleteSessionButton (Client Component) *** НОВЫЙ ***
  |     |           |-- SessionBillModal (Client Component) *** НОВЫЙ ***
  |
  |-- DateNavigator (Client Component) *** НОВЫЙ ***
  |
  |-- TimelineGrid (Client Component) *** НОВЫЙ ***
  |     |-- TimelineSlot (кликабельная ячейка)
  |     |-- TimelineBookingBlock (визуальный блок бронирования)
  |     |-- QuickBookingPopover (Client Component) *** НОВЫЙ ***
  |           |-- (name input, optional phone, optional players, submit)
  |
  |-- Card "Столы" — без изменений (TableEditor)
  |
  |-- Card "Завершённые бронирования" — без изменений
```

### Новые компоненты

Все новые компоненты располагаются в `src/components/admin/ps-park/`.

#### 1. `DateNavigator`

```
src/components/admin/ps-park/date-navigator.tsx
```

**Props:**
```typescript
type DateNavigatorProps = {
  currentDate: string; // "YYYY-MM-DD"
  onChange: (date: string) => void;
};
```

**Поведение:**
- Кнопка "Сегодня" (подсвечена если текущая дата = сегодня)
- Стрелки влево/вправо для +-1 день
- Date picker (input type="date")
- При изменении даты вызывает `onChange` -> перезагрузка timeline

#### 2. `TimelineGrid`

```
src/components/admin/ps-park/timeline-grid.tsx
```

**Props:**
```typescript
type TimelineGridProps = {
  initialData: TimelineData;  // SSR-данные
  initialDate: string;        // начальная дата (сегодня)
};
```

**Поведение:**
- Горизонтальная ось: часы 08:00-23:00 (15 столбцов)
- Вертикальная ось: столы (ресурсы)
- Бронирования отображаются как цветные блоки, занимающие соответствующие ячейки:
  - `CONFIRMED` — зелёный блок с именем клиента
  - `PENDING` — жёлтый блок (пунктирная рамка)
  - Активная сессия (CONFIRMED + startTime <= now < endTime) — зелёный с пульсирующей точкой
- Клик по свободному слоту открывает `QuickBookingPopover`
- Включает `DateNavigator` внутри себя
- При смене даты: `fetch("/api/ps-park/timeline?date=...")` и обновление state
- Текущий час подсвечен вертикальной линией (red marker)

**Внутреннее состояние:**
```typescript
const [date, setDate] = useState(initialDate);
const [data, setData] = useState(initialData);
const [popover, setPopover] = useState<{ resourceId: string; startTime: string } | null>(null);
```

**Размеры ячейки:** `min-width: 80px`, `height: 64px` (адаптивно). На мобильных — горизонтальный скролл.

#### 3. `QuickBookingPopover`

```
src/components/admin/ps-park/quick-booking-popover.tsx
```

**Props:**
```typescript
type QuickBookingPopoverProps = {
  resourceId: string;
  resourceName: string;
  date: string;
  startTime: string;         // "10:00"
  pricePerHour: number | null;
  onClose: () => void;
  onCreated: () => void;     // callback для обновления timeline
};
```

**Поведение:**
- Появляется как popover/dropdown рядом с кликнутой ячейкой (position: absolute)
- Минимальная форма:
  - Имя клиента (обязательно)
  - Телефон (необязательно)
  - Кол-во игроков (необязательно)
  - Длительность: выбор 1ч / 2ч / 3ч (по умолчанию 1ч), только если слоты свободны
- Кнопка "Забронировать" -> `POST /api/ps-park/admin-book`
- После успеха: `onCreated()` -> timeline перезагружает данные + `router.refresh()`

#### 4. `ActiveSessionsPanel`

```
src/components/admin/ps-park/active-sessions-panel.tsx
```

**Props:**
```typescript
type ActiveSessionsPanelProps = {
  initialSessions: ActiveSession[];
};
```

**Поведение:**
- Рендерит карточки `ActiveSessionCard` горизонтально (flex, overflow-x-auto)
- Polling каждые 30 секунд: `fetch("/api/ps-park/active-sessions")`
- Скрывается если нет активных сессий

**Polling реализация:**
```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const res = await fetch("/api/ps-park/active-sessions");
    const data = await res.json();
    if (data.success) setSessions(data.data);
  }, 30_000);
  return () => clearInterval(interval);
}, []);
```

#### 5. `ActiveSessionCard`

```
src/components/admin/ps-park/active-session-card.tsx
```

**Props:**
```typescript
type ActiveSessionCardProps = {
  session: ActiveSession;
  onUpdate: () => void; // для обновления после действий
};
```

**Визуал:**
- Карточка (Card) с акцентным бордером (amber/green)
- Заголовок: название стола
- Клиент: имя + телефон
- Время: "10:00 - 12:00" с прогресс-баром (% прошедшего времени)
- Оставшееся время: "Осталось 47 мин" (вычисляется на клиенте)
- Текущий счёт: часы (1000 ₽) + товары (350 ₽) = итого 1350 ₽
- Кнопки действий:
  - "+" Товары -> `AddItemsButton` (существующий)
  - "+1 час" -> `ExtendSessionButton`
  - "Завершить" -> `CompleteSessionButton`

**Прогресс-бар:** вычисляется на клиенте каждую минуту:
```typescript
const elapsed = (Date.now() - new Date(session.startTime).getTime()) / 1000 / 60;
const total = (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000 / 60;
const percent = Math.min(100, (elapsed / total) * 100);
```

#### 6. `ExtendSessionButton`

```
src/components/admin/ps-park/extend-session-button.tsx
```

**Props:**
```typescript
type Props = {
  bookingId: string;
  onExtended: () => void;
};
```

**Поведение:**
- Кнопка "+1ч"
- `POST /api/ps-park/bookings/{id}/extend`
- При ошибке (конфликт / закрытие) показать toast
- При успехе: `onExtended()` -> `router.refresh()`

#### 7. `CompleteSessionButton` + `SessionBillModal`

```
src/components/admin/ps-park/complete-session-button.tsx
src/components/admin/ps-park/session-bill-modal.tsx
```

**CompleteSessionButton props:**
```typescript
type Props = {
  bookingId: string;
  onCompleted: () => void;
};
```

**Поведение:**
1. Клик "Завершить" -> `GET /api/ps-park/bookings/{id}/bill` -> открыть `SessionBillModal`
2. Модальное окно показывает итоговый счёт (US-8)
3. Кнопка "Подтвердить завершение" -> `PATCH /api/ps-park/bookings/{id}` с `{ status: "COMPLETED" }`
4. После успеха: закрыть модал, `onCompleted()` -> `router.refresh()`

**SessionBillModal props:**
```typescript
type SessionBillModalProps = {
  bill: BookingBill;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
};
```

**Визуал модала:**
```
┌─────────────────────────────────┐
│  Завершение сессии              │
│                                 │
│  PlayStation 5 №1               │
│  Клиент: Иванов Иван           │
│  12 апреля, 10:00 - 12:00      │
│                                 │
│  ─────────────────────────────  │
│  Аренда: 2 ч. x 500 ₽  1000 ₽ │
│  ─────────────────────────────  │
│  Coca-Cola x2             160 ₽ │
│  Чипсы Lay's x1          190 ₽ │
│  ─────────────────────────────  │
│  Товары:                  350 ₽ │
│  ═════════════════════════════  │
│  ИТОГО:                 1 350 ₽ │
│                                 │
│  [Отмена]  [Подтвердить]       │
└─────────────────────────────────┘
```

---

## Публичная страница (US-9, US-10)

### Изменения в `src/app/(public)/ps-park/page.tsx`

Текущая публичная страница загружает слоты только по нажатию "Проверить". Вместо этого:

1. **Визуальная сетка доступности** (US-9): Server Component загружает `getAvailability(today)` и передаёт в новый компонент `PublicAvailabilityGrid`.
2. **Упрощённая форма** (US-10): При клике на свободный слот открывается минимальная форма (только имя, телефон по желанию).

### Компонент `PublicAvailabilityGrid`

```
src/components/public/ps-park/public-availability-grid.tsx
```

**Props:**
```typescript
type Props = {
  initialAvailability: DayAvailability[];
  initialDate: string;
};
```

**Поведение:**
- Визуальная сетка (упрощённая версия admin TimelineGrid, только цвета: зелёный/серый)
- DateNavigator (только вперёд от сегодня)
- Клик по свободному слоту -> inline форма бронирования (не popover, а развернутая секция)
- `POST /api/ps-park/book` при отправке

---

## Потоки данных

### 1. Первая загрузка админ-страницы

```
Browser -> Next.js Server (RSC)
  |
  |-- prisma.resource.findMany(...)           -> resources
  |-- prisma.booking.findMany(date=today)     -> bookings for timeline
  |-- getActiveSessions()                     -> active sessions
  |-- prisma.booking.findMany(completed)      -> recent history
  |
  v
Server renders HTML with:
  - TimelineGrid(initialData={resources, bookings, hours})
  - ActiveSessionsPanel(initialSessions=[...])
  - BookingTable(history)
  |
  v
Browser hydrates Client Components
  - ActiveSessionsPanel starts 30s polling
  - TimelineGrid interactive (click slots)
```

### 2. Quick Booking (клик по слоту)

```
User clicks free slot in TimelineGrid
  |
  v
QuickBookingPopover opens (local state)
  |-- User fills: name, [phone], [players], [duration]
  |-- Submit -> POST /api/ps-park/admin-book
  |
  v
API creates booking (CONFIRMED) + Google Cal + inventory
  |
  v
onCreated callback:
  |-- fetch("/api/ps-park/timeline?date=...") -> update timeline state
  |-- router.refresh() -> re-render server data (stats, history)
```

### 3. Active Sessions Polling

```
Every 30 seconds:
  fetch("/api/ps-park/active-sessions")
    |
    v
  Update ActiveSessionsPanel state
  (Cards re-render with new remaining time, progress)

Client-side: useEffect interval updates progress bar every 60s
```

### 4. Session Completion (US-8)

```
Manager clicks "Завершить" on ActiveSessionCard
  |
  v
GET /api/ps-park/bookings/{id}/bill
  |
  v
SessionBillModal opens (shows bill summary)
  |-- Manager reviews bill
  |-- Clicks "Подтвердить завершение"
  |
  v
PATCH /api/ps-park/bookings/{id} { status: "COMPLETED" }
  |
  v
Modal closes -> router.refresh()
  -> Session disappears from ActiveSessionsPanel
  -> Appears in history
```

### 5. Extend Session (US-7)

```
Manager clicks "+1ч" on ActiveSessionCard
  |
  v
POST /api/ps-park/bookings/{id}/extend
  |
  v
Service: check next slot free, check closing time
  |-- If conflict: return error -> toast
  |-- If OK: update endTime += 1h
  |
  v
router.refresh() -> session card updates with new endTime
```

---

## Файлы для создания / изменения

### Новые файлы

| Файл | Описание |
|------|----------|
| `src/app/api/ps-park/timeline/route.ts` | Route handler для timeline |
| `src/app/api/ps-park/active-sessions/route.ts` | Route handler для активных сессий |
| `src/app/api/ps-park/bookings/[id]/extend/route.ts` | Route handler для продления |
| `src/app/api/ps-park/bookings/[id]/bill/route.ts` | Route handler для счёта |
| `src/components/admin/ps-park/date-navigator.tsx` | Навигация по датам |
| `src/components/admin/ps-park/timeline-grid.tsx` | Timeline-сетка |
| `src/components/admin/ps-park/quick-booking-popover.tsx` | Быстрая форма бронирования |
| `src/components/admin/ps-park/active-sessions-panel.tsx` | Панель активных сессий |
| `src/components/admin/ps-park/active-session-card.tsx` | Карточка активной сессии |
| `src/components/admin/ps-park/extend-session-button.tsx` | Кнопка продления |
| `src/components/admin/ps-park/complete-session-button.tsx` | Кнопка завершения с загрузкой счёта |
| `src/components/admin/ps-park/session-bill-modal.tsx` | Модал итогового счёта |
| `src/components/public/ps-park/public-availability-grid.tsx` | Публичная сетка доступности |
| `src/modules/ps-park/__tests__/service-timeline.test.ts` | Тесты для новых сервисных функций |

### Изменяемые файлы

| Файл | Что меняется |
|------|-------------|
| `src/modules/ps-park/service.ts` | +4 функции: `getTimeline`, `getActiveSessions`, `extendBooking`, `getBookingBill` |
| `src/modules/ps-park/types.ts` | +4 типа: `TimelineData`, `TimelineBooking`, `ActiveSession`, `BookingBill` |
| `src/modules/ps-park/validation.ts` | +1 схема: `timelineQuerySchema` |
| `src/app/admin/ps-park/page.tsx` | Новый layout: TimelineGrid + ActiveSessionsPanel вместо AdminBookingForm + BookingTable для upcoming |
| `src/app/(public)/ps-park/page.tsx` | Заменить PSAvailability на PublicAvailabilityGrid с SSR-данными |

### Удаляемые / deprecated компоненты

| Файл | Статус |
|------|--------|
| `src/components/admin/ps-park/admin-booking-form.tsx` | **Заменяется** на QuickBookingPopover внутри TimelineGrid. Можно удалить после миграции. |

`BookingActions`, `AddItemsButton`, `TableEditor` — **остаются** без изменений.

---

## Последствия

### Позитивные

- Менеджер видит весь день на одном экране без прокрутки
- Бронирование по телефону: 2 клика (слот + имя + Enter) вместо 7+ действий
- Активные сессии с таймером и счётом — менеджер всегда в курсе
- Завершение с итоговым счётом — прозрачность для клиента
- Публичная страница загружается с данными (SSR), не требует нажатия кнопки

### Негативные / риски

- TimelineGrid — самый сложный компонент проекта (сетка + popover + блоки бронирований). Потребует тщательного тестирования на разных размерах экранов
- Polling каждые 30 сек создаёт нагрузку (но минимальную: 1 запрос с 2-3 записями max)
- Удаление AdminBookingForm — нужно убедиться что QuickBookingPopover покрывает все сценарии (items picker — не включён в quick form, добавляется отдельно через AddItemsButton)

### Компромиссы

- **Quick booking НЕ включает товары** — товары добавляются после через AddItemsButton. Это сознательный trade-off для скорости бронирования по телефону. Менеджер создаёт бронь за 5 секунд, товары добавляет когда клиент на месте.
- **Polling вместо WebSocket** — достаточно для 3-5 столов. Если парк масштабируется до 20+ столов, перейти на SSE/WebSocket.
- **Нет drag-and-drop** для перемещения бронирований по timeline — это Phase 2 UX improvement, не MVP.

---

## План реализации (порядок)

1. **Типы и валидация** — `types.ts`, `validation.ts` (30 мин)
2. **Сервисные функции** — `getTimeline`, `getActiveSessions`, `extendBooking`, `getBookingBill` + тесты (2 часа)
3. **API routes** — 4 новых эндпоинта (1 час)
4. **DateNavigator + TimelineGrid** — основной UI компонент (3 часа)
5. **QuickBookingPopover** — форма быстрого бронирования (1.5 часа)
6. **ActiveSessionsPanel + ActiveSessionCard** — панель сессий с polling (2 часа)
7. **ExtendSessionButton** (30 мин)
8. **CompleteSessionButton + SessionBillModal** (1.5 часа)
9. **Обновление admin page** — интеграция всех компонентов (1 час)
10. **PublicAvailabilityGrid + обновление public page** (1.5 часа)
11. **Тестирование и polish** (2 часа)

**Общая оценка: ~16 часов разработки.**

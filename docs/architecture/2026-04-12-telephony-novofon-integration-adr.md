# ADR: Интеграция телефонии Novofon

**Дата:** 2026-04-12  
**Статус:** Предложено  
**Автор:** System Architect  
**Модули:** telephony (новый), gazebos, ps-park  
**PRD:** Интеграция телефонии Novofon в Platform Delovoy

---

## Контекст

Клиенты не могут позвонить менеджеру напрямую с сайта. Менеджеры не могут инициировать звонок клиенту из карточки бронирования. История звонков не ведётся — менеджер не видит, звонили ли клиенту по конкретному бронированию и каков был результат разговора.

Novofon (бывший Zadarma) предоставляет REST API (`start.employee_call`) для инициации click-to-call, а также вебхуки для входящих событий. Интеграция вводится как отдельный модуль `telephony` с полной поддержкой RBAC и логированием через `SystemEvent`.

---

## Варианты

### Вариант A: Хранить звонки в `SystemEvent` (source: "telephony")

**Плюсы:** Нет миграции, повторное использование существующей инфраструктуры логирования.  
**Минусы:** `SystemEvent` — это операционный лог, не реляционная сущность. Невозможно выстроить запросы «все звонки по бронированию», индексировать по `bookingId`, управлять RBAC на уровне строки, хранить направление/длительность как типизированные поля. Использование `metadata: Json?` превращает `SystemEvent` в неструктурированный склад данных.

### Вариант B: Отдельная таблица `CallLog` (выбрано)

**Плюсы:** Строгая типизация, явные FK на `Booking` и `User`, индексы для быстрого поиска по `bookingId`/`clientPhone`, чистое разделение операционного лога и бизнес-данных. Легко расширять (добавить `recordingUrl`, `duration`, `externalId`). Миграция добавляет одну таблицу и два enum — минимальный риск.  
**Минусы:** Требуется миграция Prisma.

**Решение: Вариант B.** Звонок — это бизнес-сущность (аналог `Booking`, `Order`), а не техническое событие. Она должна жить в собственной таблице.

---

## Решение

### 1. Схема данных (Prisma)

Добавить в `prisma/schema.prisma`:

```prisma
// === TELEPHONY ===

model CallLog {
  id            String        @id @default(cuid())
  bookingId     String?                   // null для standalone-звонков
  booking       Booking?      @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  moduleSlug    String?                   // "gazebos", "ps-park", null для общих
  direction     CallDirection
  status        CallStatus    @default(INITIATED)
  clientPhone   String                    // номер клиента
  managerPhone  String?                   // SIP-линия или номер менеджера
  initiatedBy   String?                   // userId (null для входящих)
  externalCallId String?                  // ID звонка в системе Novofon
  duration      Int?                      // секунды, заполняется по вебхуку
  recordingUrl  String?                   // ссылка на файл записи от Novofon
  errorMessage  String?                   // текст ошибки при FAILED
  metadata      Json?                     // сырой payload вебхука / ответ API
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@index([bookingId])
  @@index([clientPhone])
  @@index([moduleSlug, createdAt])
  @@index([externalCallId])
}

enum CallDirection {
  OUTBOUND   // менеджер → клиент (click-to-call)
  INBOUND    // клиент → платформа (вебхук)
}

enum CallStatus {
  INITIATED   // запрос к Novofon отправлен, ответа нет
  RINGING     // Novofon подтвердил, идёт дозвон
  ANSWERED    // разговор состоялся
  NO_ANSWER   // не взяли трубку
  BUSY        // занято
  FAILED      // ошибка API или сети
  COMPLETED   // звонок завершён нормально (финальный статус)
}
```

Также добавить обратную связь в модель `Booking`:

```prisma
model Booking {
  // ... существующие поля ...
  callLogs  CallLog[]
}
```

### 2. Архитектура модуля

```
src/modules/telephony/
├── service.ts          — бизнес-логика (initiateCall, handleWebhook, listCalls, getRecording)
├── types.ts            — TypeScript-интерфейсы
├── validation.ts       — Zod-схемы для API входных данных и вебхука
└── novofon-client.ts   — HTTP-клиент для Novofon API (изолирован от service.ts)
```

#### 2.1 `novofon-client.ts` — изоляция внешнего API

```typescript
// src/modules/telephony/novofon-client.ts

const NOVOFON_API_BASE = "https://api.novofon.com/v1";

export interface NovofonCallRequest {
  from: string;      // SIP-линия или номер менеджера
  to: string;        // номер клиента
  caller_id?: string; // отображаемый номер
}

export interface NovofonCallResponse {
  success: boolean;
  call_id?: string;
  error?: string;
}

export async function novofonStartCall(
  apiKey: string,
  params: NovofonCallRequest
): Promise<NovofonCallResponse> {
  const res = await fetch(`${NOVOFON_API_BASE}/start.employee_call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    return { success: false, error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  return {
    success: data.success === true || data.status === "success",
    call_id: data.call_id ?? data.callid,
    error: data.error ?? data.message,
  };
}
```

**Принцип:** `novofon-client.ts` знает только о HTTP-протоколе Novofon. `service.ts` знает только о бизнес-логике и БД. Зависимость — односторонняя: `service → client`.

#### 2.2 Конфигурация — где хранить

| Данные | Хранение | Причина |
|--------|----------|---------|
| `NOVOFON_API_KEY` | `.env` | Секрет. Никогда не в БД, не в `Module.config` |
| `sipLine` (номер менеджера) | `Module.config` (JSONB) | Специфично для модуля, меняется суперадмином через Config GUI |
| `publicPhone` (номер на сайте) | `Module.config` (JSONB) | Отображается на публичных страницах, управляется без деплоя |
| `telephonyEnabled` (флаг) | `Module.config` (JSONB) | Включение/отключение per-module без кода |

Пример `Module.config` для модуля `gazebos`:

```json
{
  "publicPhone": "+74951234567",
  "telephony": {
    "enabled": true,
    "sipLine": "79991234567",
    "callerId": "+74951234567"
  }
}
```

### 3. Бизнес-логика (`service.ts`)

Ключевые функции:

```typescript
// Инициировать исходящий звонок
initiateCall(managerId: string, bookingId: string, moduleSlug: string): Promise<CallLog>

// Обработать входящий вебхук от Novofon
handleWebhook(payload: NovofonWebhookPayload): Promise<void>

// Список звонков по бронированию
listCallsByBooking(bookingId: string): Promise<CallLog[]>

// Список звонков с фильтрацией (для страницы журнала)
listCalls(filter: CallFilter): Promise<{ calls: CallLog[]; total: number }>

// Получить/обновить URL записи (если Novofon отдаёт её отложенно)
getRecordingUrl(callId: string): Promise<string | null>
```

`initiateCall` — последовательность операций:
1. Получить бронирование, извлечь `clientPhone`
2. Получить `Module.config` для соответствующего `moduleSlug`, достать `sipLine`
3. Прочитать `NOVOFON_API_KEY` из `process.env`
4. Создать запись `CallLog` со статусом `INITIATED`
5. Вызвать `novofonStartCall()`
6. Обновить `CallLog.status` (если ошибка — `FAILED`, если успех — `RINGING`) и сохранить `externalCallId`
7. Записать `SystemEvent` level `INFO` (или `ERROR` при сбое)
8. Записать `AuditLog` с action `"call.initiated"`
9. Вернуть `CallLog`

### 4. API-контракты

#### POST /api/telephony/call — инициировать исходящий звонок

**RBAC:** SUPERADMIN, MANAGER (только своего модуля)

Запрос:
```json
{
  "bookingId": "clxyz123",
  "moduleSlug": "gazebos"
}
```

Ответ 200:
```json
{
  "success": true,
  "data": {
    "callId": "cllog456",
    "status": "RINGING",
    "externalCallId": "novofon-call-789",
    "clientPhone": "+79001234567"
  }
}
```

Ошибки:
- `404` `BOOKING_NOT_FOUND` — бронирование не найдено
- `400` `NO_CLIENT_PHONE` — у клиента не указан номер телефона
- `400` `TELEPHONY_DISABLED` — телефония отключена для модуля
- `503` `NOVOFON_ERROR` — ошибка вызова внешнего API
- `422` `VALIDATION_ERROR` — некорректный запрос

---

#### POST /api/telephony/webhook — вебхук входящих событий Novofon

**Auth:** HMAC-подпись в заголовке `X-Novofon-Signature` (верификация через secret из `.env`)  
**RBAC:** публичный endpoint, но защищён подписью

Входящий payload (пример):
```json
{
  "event": "call.completed",
  "call_id": "novofon-call-789",
  "direction": "outbound",
  "duration": 145,
  "recording_url": "https://storage.novofon.com/rec/abc.mp3",
  "caller": "+74951234567",
  "callee": "+79001234567"
}
```

Ответ 200:
```json
{ "success": true, "data": { "processed": true } }
```

Логика обработки:
1. Верифицировать подпись
2. Найти `CallLog` по `externalCallId`
3. Обновить `status`, `duration`, `recordingUrl` в зависимости от типа события
4. Записать `SystemEvent`

---

#### GET /api/telephony/calls — список звонков

**RBAC:** SUPERADMIN (все), MANAGER (только свой moduleSlug)

Query-параметры: `bookingId?`, `moduleSlug?`, `dateFrom?`, `dateTo?`, `status?`, `page?`, `perPage?`

Ответ 200:
```json
{
  "success": true,
  "data": [
    {
      "id": "cllog456",
      "bookingId": "clxyz123",
      "moduleSlug": "gazebos",
      "direction": "OUTBOUND",
      "status": "COMPLETED",
      "clientPhone": "+79001234567",
      "duration": 145,
      "recordingUrl": "https://...",
      "createdAt": "2026-04-12T10:30:00Z",
      "initiatedByName": "Иван Менеджер"
    }
  ],
  "meta": { "page": 1, "perPage": 20, "total": 42 }
}
```

---

#### GET /api/telephony/calls/:id/recording — получить URL записи

**RBAC:** SUPERADMIN, MANAGER — доступ есть. USER — доступа нет (403).

Ответ 200:
```json
{
  "success": true,
  "data": {
    "callId": "cllog456",
    "recordingUrl": "https://storage.novofon.com/rec/abc.mp3",
    "expiresAt": null
  }
}
```

Ошибки:
- `404` — звонок не найден
- `404` `NO_RECORDING` — запись отсутствует
- `403` `FORBIDDEN` — USER пытается получить доступ

---

#### GET /api/telephony/health — health check модуля

**RBAC:** SUPERADMIN

Ответ 200:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "novofonApiConfigured": true,
    "lastCallAt": "2026-04-12T09:15:00Z",
    "totalCallsToday": 7
  }
}
```

---

### 5. Zod-схемы

```typescript
// src/modules/telephony/validation.ts

import { z } from "zod";

export const initiateCallSchema = z.object({
  bookingId: z.string().min(1),
  moduleSlug: z.enum(["gazebos", "ps-park"]),
});

export const callFilterSchema = z.object({
  bookingId: z.string().optional(),
  moduleSlug: z.string().optional(),
  status: z.enum(["INITIATED", "RINGING", "ANSWERED", "NO_ANSWER", "BUSY", "FAILED", "COMPLETED"]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export const novofonWebhookSchema = z.object({
  event: z.string(),
  call_id: z.string(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  duration: z.number().int().nonnegative().optional(),
  recording_url: z.string().url().optional(),
  caller: z.string().optional(),
  callee: z.string().optional(),
  // Допускаем дополнительные поля от Novofon
}).passthrough();

export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type CallFilter = z.infer<typeof callFilterSchema>;
export type NovofonWebhookPayload = z.infer<typeof novofonWebhookSchema>;
```

---

### 6. Публичная страница — кнопка звонка (US-1)

Номер телефона читается из `Module.config.publicPhone` через серверный компонент — никаких клиентских запросов к API. Пример:

```typescript
// src/app/(public)/gazebos/page.tsx (server component)
const module = await prisma.module.findUnique({ where: { slug: "gazebos" } });
const config = module?.config as { publicPhone?: string } | null;
const phone = config?.publicPhone ?? process.env.NEXT_PUBLIC_DEFAULT_PHONE;
```

Рендер:
```tsx
<a href={`tel:${phone}`} className="...">
  Позвонить
</a>
```

Это решение не требует нового API-эндпоинта для публичного номера.

---

### 7. Переменные окружения

Добавить в `.env.example`:

```env
# Novofon (телефония)
NOVOFON_API_KEY="your-novofon-api-key"
NOVOFON_WEBHOOK_SECRET="your-webhook-hmac-secret"
```

`NOVOFON_API_KEY` и `NOVOFON_WEBHOOK_SECRET` — только в `.env`, никогда в БД.

---

### 8. Регистрация модуля

В seed-скрипте или через Config GUI добавить модуль:

```typescript
await prisma.module.upsert({
  where: { slug: "telephony" },
  update: {},
  create: {
    slug: "telephony",
    name: "Телефония",
    description: "Интеграция с Novofon: click-to-call, журнал звонков, записи",
    isActive: true,
    config: {
      provider: "novofon",
      enabledForModules: ["gazebos", "ps-park"],
    },
  },
});
```

---

## Последствия

### Положительные
- Менеджер инициирует звонок одной кнопкой из карточки бронирования — не нужно набирать номер вручную
- Полная история звонков по каждому бронированию с направлением, длительностью и записью
- RBAC соблюдён: USER не имеет доступа к записям звонков
- API-ключ Novofon защищён в `.env`, конфигурация номеров управляется через Config GUI без деплоя
- Архитектура идентична существующим модулям (service / types / validation / client), onboarding разработчиков прост

### Риски и ограничения
- **Novofon webhook latency:** статус `RINGING` → `COMPLETED` + запись приходят асинхронно. UI должен показывать статус из БД с возможностью обновления (polling или SSE). Для MVP — polling каждые 5 секунд при открытой карточке.
- **Запись звонков:** ссылка может быть временной (expires). Если нужно долгосрочное хранение — потребуется задача копирования в S3/file storage. MVP: хранить URL как есть, принять что ссылка живёт столько, сколько Novofon гарантирует.
- **HMAC-верификация вебхука:** если Novofon не поддерживает HMAC-подпись в конкретном тарифе — fallback на проверку IP whitelist через middleware.
- **Тесты:** `novofon-client.ts` мокируется через `vi.mock`, реальных HTTP-запросов в тестах нет.

### Миграция БД
Добавляется одна таблица `CallLog` и два enum (`CallDirection`, `CallStatus`). Обратно совместима: существующие данные не затрагиваются. Откат: `DROP TABLE "CallLog"` + `DROP TYPE`.

---

## Порядок реализации

1. **Миграция Prisma** — добавить `CallLog`, `CallDirection`, `CallStatus`, обратную связь в `Booking`
2. **`novofon-client.ts`** — HTTP-обёртка, unit-тесты с `vi.mock(fetch)`
3. **`service.ts`** — `initiateCall`, `handleWebhook`, `listCalls`, `getRecordingUrl`; тесты мокируют Prisma и novofon-client
4. **API route handlers** — `POST /call`, `POST /webhook`, `GET /calls`, `GET /calls/:id/recording`, `GET /health`
5. **UI: кнопка "Позвонить клиенту"** в карточке бронирования (admin, gazebos + ps-park)
6. **UI: блок истории звонков** в карточке бронирования
7. **UI: кнопка "Позвонить"** на публичных страницах `/gazebos` и `/ps-park`
8. **Config GUI** — поле `telephony.enabled` и `publicPhone` в настройках модуля

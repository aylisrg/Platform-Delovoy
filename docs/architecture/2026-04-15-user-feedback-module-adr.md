# ADR: Модуль «Обратная связь» (Feedback)

**Дата:** 2026-04-15
**Статус:** Предложено
**Авторы:** System Architect (Claude)

---

## Контекст

### Проблема

Платформа «Деловой» не имеет канала для сбора обратной связи от пользователей. Посетители не могут сообщить об ошибке или предложить улучшение. Обращения теряются в мессенджерах и устных разговорах.

SUPERADMIN не имеет единого места для просмотра, приоритизации и обработки обращений. Срочные проблемы не отличаются от пожеланий.

### Требования

- Кнопка обратной связи на всех страницах (только для авторизованных)
- Форма: тип (ошибка/предложение), описание (10-2000 символов), скриншот (до 5 МБ), флаг «СРОЧНО!», автосбор URL
- Срочные обращения -> Telegram-алерт владельцу в течение 30 секунд (со скриншотом)
- История обращений в ЛК пользователя
- Панель управления для SUPERADMIN (фильтрация, статусы, комментарии)
- Защита от спама: 5 обращений/сутки, 1 срочное/час

### Текущая архитектура (что уже есть)

- **Модульная система**: каждый модуль в `src/modules/{slug}/` с `service.ts`, `types.ts`, `validation.ts`
- **API-паттерн**: Route Handlers в `src/app/api/{module}/`, стандартный ответ через `apiResponse()`/`apiError()`
- **Auth**: NextAuth v5 с RBAC (`auth()` -> `session.user.id`, `session.user.role`)
- **Rate limiting**: Redis sliding window в `src/lib/rate-limit.ts` (60/мин public, 120/мин auth)
- **Telegram**: `bot/index.ts` экспортирует `sendAlert()` для отправки сообщений в админ-чат через HTTP API; `bot/handlers/alerts.ts` роутит по severity
- **Audit**: `logAudit()` в `src/lib/logger.ts` для записи действий
- **Файловый upload**: в проекте пока не реализован -- это первый модуль с загрузкой файлов

---

## Рассмотренные варианты

### Хранение скриншотов

#### Вариант A: Локальная файловая система (`/uploads/feedback/`)

Сохранять файлы в `public/uploads/feedback/{id}.{ext}`, отдавать через статику Next.js.

**Плюсы:** Максимально просто, нет внешних зависимостей.
**Минусы:** Не работает при горизонтальном масштабировании. При переезде на несколько инстансов -- файлы потеряются. Нет CDN.

#### Вариант B: S3-совместимое хранилище (MinIO / Timeweb S3)

Загружать в S3 bucket, хранить URL в БД.

**Плюсы:** Масштабируется, CDN-ready, стандартный подход.
**Минусы:** Дополнительная зависимость, настройка инфраструктуры. Overkill для MVP с одним типом загрузок.

#### Вариант C: Файловая система на VPS с абсолютным путём вне `public/`

Сохранять в `/data/uploads/feedback/`, отдавать через API route (`GET /api/feedback/uploads/:filename`). При масштабировании -- мигрировать на S3.

**Плюсы:** Просто как A, но файлы не в git и не в public (безопаснее). API route позволяет добавить проверку доступа. Легко мигрировать на S3 позже (заменить одну функцию).
**Минусы:** Нужен API route для отдачи файлов.

### Модель данных

#### Вариант A: Одна модель `FeedbackItem` + JSONB для комментариев

**Плюсы:** Минимум таблиц.
**Минусы:** JSONB неудобен для пагинации комментариев, нет FK constraints.

#### Вариант B: `FeedbackItem` + `FeedbackComment` (две таблицы)

**Плюсы:** Реляционная модель, типобезопасность, возможность расширения (несколько комментариев, история статусов).
**Минусы:** Чуть больше кода.

### Rate limiting обратной связи

#### Вариант A: Использовать существующий Redis rate limiter

Добавить конфиги `feedback_daily` (5/86400s) и `feedback_urgent` (1/3600s) в `src/lib/rate-limit.ts`.

**Плюсы:** Переиспользование, единообразие.
**Минусы:** Текущий rate limiter работает по IP, а нужно по userId.

#### Вариант B: Кастомный rate limiter по userId в service.ts

Проверять в `feedbackService.create()` через Redis keys `feedback:daily:{userId}` и `feedback:urgent:{userId}`.

**Плюсы:** Точный контроль по пользователю, простая логика.
**Минусы:** Дублирование паттерна. Но логика достаточно специфична (разные лимиты для обычных и срочных).

---

## Решение

### Хранение скриншотов: Вариант C (файловая система + API route)

**Обоснование:**
1. Это первый file upload в проекте -- важно не переусложнять.
2. На текущем этапе один VPS, S3 не нужен.
3. API route для отдачи файлов позволяет добавить проверку доступа (авторизация, rate limit).
4. Путь миграции на S3 прост: заменить `saveFile()` и `getFileUrl()` в `src/modules/feedback/file-storage.ts`.

**Реализация:**
- Директория: `UPLOAD_DIR` из env (default: `/data/uploads/feedback/` в prod, `./uploads/feedback/` в dev)
- Имя файла: `{feedbackId}-{timestamp}.{ext}` (предотвращает коллизии)
- Отдача: `GET /api/feedback/uploads/[filename]` (проверяет что пользователь -- автор или SUPERADMIN)
- Максимум: 5 МБ, форматы: PNG, JPG, WEBP
- Абстракция: `src/modules/feedback/file-storage.ts` с интерфейсом `saveScreenshot()` / `getScreenshotUrl()` / `deleteScreenshot()`

### Модель данных: Вариант B (две таблицы)

**Обоснование:** Комментарий админа -- отдельная сущность. В будущем может быть диалог (несколько комментариев). Реляционная модель надёжнее.

### Rate limiting: Вариант B (кастомный по userId)

**Обоснование:** Лимиты специфичны для feedback (5/день + 1 urgent/час) и привязаны к userId, а не IP. Проще и надёжнее реализовать отдельно.

---

## Схема данных (Prisma)

```prisma
// === FEEDBACK ===

enum FeedbackType {
  BUG        // Ошибка
  SUGGESTION // Предложение
}

enum FeedbackStatus {
  NEW         // Новое (только что отправлено)
  IN_PROGRESS // В работе
  RESOLVED    // Выполнено
  REJECTED    // Отклонено
}

model FeedbackItem {
  id             String         @id @default(cuid())
  userId         String
  user           User           @relation(fields: [userId], references: [id])
  type           FeedbackType
  description    String         @db.Text     // 10-2000 символов
  screenshotPath String?                     // Относительный путь к файлу
  pageUrl        String                      // URL страницы, с которой отправлено
  isUrgent       Boolean        @default(false)
  status         FeedbackStatus @default(NEW)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  comments       FeedbackComment[]

  @@index([userId])
  @@index([status, isUrgent, createdAt])
  @@index([createdAt])
}

model FeedbackComment {
  id             String       @id @default(cuid())
  feedbackId     String
  feedback       FeedbackItem @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  authorId       String       // SUPERADMIN user ID
  text           String       @db.Text
  createdAt      DateTime     @default(now())

  @@index([feedbackId])
}
```

**Изменения в существующих моделях:**

```prisma
// User model -- добавить relation
model User {
  // ... existing fields ...
  feedbackItems    FeedbackItem[]
}
```

**Миграция:** Стандартная Prisma migration (`prisma migrate dev --name add-feedback-module`). Нет изменений в существующих таблицах, только добавление двух новых таблиц + relation на User.

---

## API-контракты

### Модуль регистрируется в таблице Module

```
slug: "feedback"
name: "Обратная связь"
```

### Endpoints

#### 1. `POST /api/feedback` -- Создать обращение

**Доступ:** Авторизованные пользователи (USER, MANAGER, SUPERADMIN)

**Request:** `multipart/form-data`

| Поле          | Тип    | Обязательно | Описание                        |
|---------------|--------|-------------|----------------------------------|
| type          | string | Да          | "BUG" или "SUGGESTION"          |
| description   | string | Да          | 10-2000 символов                 |
| pageUrl       | string | Да          | URL страницы                     |
| isUrgent      | string | Нет         | "true" / "false" (default false) |
| screenshot    | File   | Нет         | PNG/JPG/WEBP, до 5 МБ           |

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "type": "BUG",
    "description": "Не работает кнопка...",
    "screenshotUrl": "/api/feedback/uploads/clx...-1713168000.png",
    "pageUrl": "/ps-park",
    "isUrgent": true,
    "status": "NEW",
    "createdAt": "2026-04-15T12:00:00Z"
  }
}
```

**Ошибки:**
- `422 VALIDATION_ERROR` -- невалидные данные
- `429 FEEDBACK_DAILY_LIMIT` -- "Превышен лимит обращений (5 в сутки)"
- `429 FEEDBACK_URGENT_LIMIT` -- "Не более 1 срочного обращения в час"
- `401 UNAUTHORIZED`

**Побочные эффекты:**
- Если `isUrgent: true` -> отправить Telegram-алерт владельцу (level: CRITICAL, source: "feedback") с текстом (до 500 символов), именем пользователя, URL, ссылкой в админку
- Если есть скриншот и isUrgent -> отправить фото в Telegram через `sendPhoto` API
- Записать в AuditLog: `feedback.create`
- Записать SystemEvent (INFO/CRITICAL в зависимости от isUrgent)

#### 2. `GET /api/feedback` -- Список обращений пользователя

**Доступ:** Авторизованные (USER видит свои, SUPERADMIN видит все)

**Query параметры:**

| Параметр | Тип    | Описание                              |
|----------|--------|---------------------------------------|
| page     | number | Страница (default 1)                  |
| perPage  | number | Размер страницы (default 20, max 50)  |
| status   | string | Фильтр по статусу                     |
| type     | string | Фильтр по типу (BUG/SUGGESTION)       |
| isUrgent | string | "true" для срочных                    |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "type": "BUG",
      "description": "Не работает...",
      "screenshotUrl": "/api/feedback/uploads/...",
      "pageUrl": "/ps-park",
      "isUrgent": true,
      "status": "NEW",
      "createdAt": "2026-04-15T12:00:00Z",
      "user": { "id": "...", "name": "Иван" }
    }
  ],
  "meta": { "page": 1, "perPage": 20, "total": 42 }
}
```

**Логика:**
- USER -> `WHERE userId = session.user.id`
- SUPERADMIN -> все, сортировка: `isUrgent DESC, createdAt DESC` (срочные первыми)

#### 3. `GET /api/feedback/[id]` -- Детальный просмотр

**Доступ:** Автор обращения или SUPERADMIN

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "type": "BUG",
    "description": "Полный текст...",
    "screenshotUrl": "/api/feedback/uploads/...",
    "pageUrl": "/ps-park",
    "isUrgent": true,
    "status": "IN_PROGRESS",
    "createdAt": "2026-04-15T12:00:00Z",
    "user": { "id": "...", "name": "Иван", "email": "ivan@..." },
    "comments": [
      {
        "id": "clx...",
        "text": "Исправим в ближайшем обновлении",
        "authorName": "Администратор",
        "createdAt": "2026-04-15T14:00:00Z"
      }
    ]
  }
}
```

#### 4. `PATCH /api/feedback/[id]` -- Обновить статус (SUPERADMIN)

**Доступ:** SUPERADMIN

**Request:**
```json
{
  "status": "IN_PROGRESS"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "status": "IN_PROGRESS",
    "updatedAt": "2026-04-15T14:00:00Z"
  }
}
```

**Побочные эффекты:** AuditLog: `feedback.status_change`, metadata: `{ from: "NEW", to: "IN_PROGRESS" }`

#### 5. `POST /api/feedback/[id]/comments` -- Добавить комментарий (SUPERADMIN)

**Доступ:** SUPERADMIN

**Request:**
```json
{
  "text": "Исправим в ближайшем обновлении"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "text": "Исправим в ближайшем обновлении",
    "authorName": "Администратор",
    "createdAt": "2026-04-15T14:00:00Z"
  }
}
```

**Побочные эффекты:** AuditLog: `feedback.comment`

#### 6. `GET /api/feedback/stats` -- Счётчики для админ-панели (SUPERADMIN)

**Доступ:** SUPERADMIN

**Response (200):**
```json
{
  "success": true,
  "data": {
    "totalNew": 12,
    "totalUrgentNew": 3,
    "totalInProgress": 5,
    "totalResolved": 42,
    "totalRejected": 2
  }
}
```

#### 7. `GET /api/feedback/uploads/[filename]` -- Отдача скриншота

**Доступ:** Автор обращения или SUPERADMIN (проверка по feedbackId, извлечённому из filename)

**Response:** Binary file с правильным `Content-Type`

#### 8. `GET /api/feedback/health` -- Health check модуля

**Доступ:** Публичный (по конвенции проекта)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "module": "feedback",
    "timestamp": "2026-04-15T12:00:00Z"
  }
}
```

---

## Zod-схемы валидации

```typescript
// src/modules/feedback/validation.ts

import { z } from "zod";

export const createFeedbackSchema = z.object({
  type: z.enum(["BUG", "SUGGESTION"], {
    required_error: "Тип обращения обязателен",
    invalid_type_error: "Тип: BUG или SUGGESTION",
  }),
  description: z
    .string()
    .min(10, "Описание минимум 10 символов")
    .max(2000, "Описание максимум 2000 символов"),
  pageUrl: z
    .string()
    .min(1, "URL страницы обязателен")
    .max(2000),
  isUrgent: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().default(false)
  ),
});

export const feedbackFilterSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"]).optional(),
  type: z.enum(["BUG", "SUGGESTION"]).optional(),
  isUrgent: z.preprocess(
    (val) => val === "true" || val === true,
    z.boolean().optional()
  ),
});

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "REJECTED"]),
});

export const createCommentSchema = z.object({
  text: z
    .string()
    .min(1, "Комментарий не может быть пустым")
    .max(5000, "Комментарий максимум 5000 символов"),
});

// Валидация файла (в route handler, не через Zod)
export const SCREENSHOT_CONSTRAINTS = {
  maxSizeBytes: 5 * 1024 * 1024, // 5 МБ
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  allowedExtensions: [".png", ".jpg", ".jpeg", ".webp"] as const,
};
```

---

## Структура файлов модуля

```
src/modules/feedback/
  service.ts          -- Бизнес-логика (create, list, getById, updateStatus, addComment, getStats)
  types.ts            -- TypeScript типы
  validation.ts       -- Zod-схемы
  file-storage.ts     -- Абстракция хранения файлов (saveScreenshot, getScreenshotPath, deleteScreenshot)
  telegram.ts         -- Отправка срочных обращений в Telegram (sendUrgentFeedbackAlert, sendUrgentFeedbackPhoto)
  __tests__/
    service.test.ts
    validation.test.ts
    file-storage.test.ts

src/app/api/feedback/
  route.ts                  -- GET (list) + POST (create)
  [id]/
    route.ts                -- GET (detail) + PATCH (update status)
    comments/
      route.ts              -- POST (add comment)
  uploads/
    [filename]/
      route.ts              -- GET (serve file)
  stats/
    route.ts                -- GET (counters)
  health/
    route.ts                -- GET (health check)
```

---

## Интеграция с Telegram (срочные обращения)

Для отправки скриншотов нужен `sendPhoto` API, которого нет в текущем `sendAlert()`. Создаём `src/modules/feedback/telegram.ts`:

```typescript
// src/modules/feedback/telegram.ts

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Отправляет срочное обращение в Telegram.
 * Сначала текстовое сообщение, затем скриншот (если есть).
 */
export async function sendUrgentFeedbackAlert(params: {
  feedbackId: string;
  type: "BUG" | "SUGGESTION";
  description: string;      // Обрезается до 500 символов
  userName: string;
  pageUrl: string;
  screenshotPath?: string;  // Абсолютный путь к файлу на диске
}): Promise<boolean> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return false;

  const typeLabel = params.type === "BUG" ? "Ошибка" : "Предложение";
  const adminUrl = `${APP_URL}/admin/feedback/${params.feedbackId}`;
  const truncatedDesc = params.description.slice(0, 500);

  const text = [
    `<b>СРОЧНОЕ обращение!</b>`,
    ``,
    `<b>Тип:</b> ${typeLabel}`,
    `<b>От:</b> ${params.userName}`,
    `<b>Страница:</b> ${params.pageUrl}`,
    ``,
    truncatedDesc,
    ``,
    `<a href="${adminUrl}">Открыть в панели</a>`,
  ].join("\n");

  // 1. Send text message
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: ADMIN_CHAT_ID,
      text,
      parse_mode: "HTML",
    }),
  });

  // 2. Send screenshot if present
  if (params.screenshotPath) {
    const fs = await import("fs");
    if (fs.existsSync(params.screenshotPath)) {
      const FormData = (await import("undici")).FormData;
      const formData = new FormData();
      formData.append("chat_id", ADMIN_CHAT_ID);
      formData.append("photo", new Blob([fs.readFileSync(params.screenshotPath)]));
      formData.append("caption", `Скриншот к обращению ${params.feedbackId}`);

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        body: formData as never,
      });
    }
  }

  return true;
}
```

---

## Rate Limiting (по userId через Redis)

```typescript
// Внутри src/modules/feedback/service.ts

import { redis, redisAvailable } from "@/lib/redis";

async function checkFeedbackRateLimit(userId: string, isUrgent: boolean): Promise<string | null> {
  if (!redisAvailable) return null; // Если Redis недоступен, пропускаем

  const dailyKey = `feedback:daily:${userId}`;
  const dailyCount = await redis.get(dailyKey);
  if (dailyCount && parseInt(dailyCount, 10) >= 5) {
    return "FEEDBACK_DAILY_LIMIT";
  }

  if (isUrgent) {
    const urgentKey = `feedback:urgent:${userId}`;
    const urgentCount = await redis.get(urgentKey);
    if (urgentCount && parseInt(urgentCount, 10) >= 1) {
      return "FEEDBACK_URGENT_LIMIT";
    }
  }

  return null;
}

async function incrementFeedbackCounters(userId: string, isUrgent: boolean): Promise<void> {
  if (!redisAvailable) return;

  const dailyKey = `feedback:daily:${userId}`;
  const pipeline = redis.pipeline();
  pipeline.incr(dailyKey);
  pipeline.expire(dailyKey, 86400); // 24 часа

  if (isUrgent) {
    const urgentKey = `feedback:urgent:${userId}`;
    pipeline.incr(urgentKey);
    pipeline.expire(urgentKey, 3600); // 1 час
  }

  await pipeline.exec();
}
```

---

## Влияние на существующие модули

### Минимальное влияние

1. **Prisma schema** -- добавление 2 моделей + 2 enum + relation на User. Не меняет существующие таблицы.
2. **User model** -- добавление `feedbackItems FeedbackItem[]` relation. Обратно совместимо.
3. **AdminPermission** -- добавить `"feedback"` в допустимые значения section (для будущих MANAGER с доступом к feedback). На данном этапе -- только SUPERADMIN.
4. **Bot** -- не трогаем. Telegram-алерты отправляются через HTTP API напрямую (как уже делает `sendAlert()`).
5. **Middleware** -- существующий auth middleware уже работает. Rate limiting для feedback -- кастомный в service.

### UI компоненты (новые)

```
src/components/public/feedback-button.tsx    -- Плавающая кнопка + модальная форма
src/components/admin/feedback/
  feedback-list.tsx                          -- Таблица обращений с фильтрами
  feedback-detail.tsx                        -- Детальный просмотр + комментарии
  feedback-stats-cards.tsx                   -- Счётчики (новые, срочные, в работе)
```

Кнопка `FeedbackButton` встраивается в корневой layout (`src/app/layout.tsx`) внутри `SessionProvider`, рендерится только при наличии сессии.

### Админ-панель

Новая страница: `src/app/(admin)/admin/feedback/page.tsx` -- доступна только SUPERADMIN. Добавить пункт в sidebar навигацию (в `src/components/admin/sidebar.tsx` или аналог).

---

## Миграция данных

Не требуется. Создаются только новые таблицы. Seed-скрипт (`prisma/seed.ts`) должен зарегистрировать модуль:

```typescript
await prisma.module.upsert({
  where: { slug: "feedback" },
  create: {
    slug: "feedback",
    name: "Обратная связь",
    description: "Сбор обратной связи от пользователей: ошибки и предложения",
    isActive: true,
  },
  update: {},
});
```

---

## Безопасность

1. **Только авторизованные** -- все эндпоинты требуют `session.user.id`
2. **Rate limiting по userId** -- 5 обращений/день, 1 срочное/час (Redis)
3. **Валидация файлов** -- проверка MIME type, расширения, размера. Дополнительно: проверка magic bytes заголовка файла (чтобы нельзя было загрузить `.exe` переименованный в `.png`)
4. **Доступ к скриншотам** -- через API route с проверкой: автор или SUPERADMIN
5. **Имя файла** -- генерируется сервером (`{feedbackId}-{timestamp}.{ext}`), не используется имя от клиента
6. **XSS** -- описание и комментарии рендерятся через React (автоэкранирование). В Telegram -- через HTML parse mode (экранирование спецсимволов)
7. **AuditLog** -- все мутации логируются

---

## Тестирование

### Unit-тесты (Vitest)

- `service.test.ts`: create (happy path, rate limit exceeded, urgent -> telegram called), list (user sees own, admin sees all), updateStatus, addComment, getStats
- `validation.test.ts`: все Zod-схемы (valid/invalid inputs, edge cases: 10 chars, 2000 chars, boundary)
- `file-storage.test.ts`: saveScreenshot (valid file, too large, wrong mime), deleteScreenshot

### Integration-тесты

- `POST /api/feedback` -- happy path, validation error, rate limit, with screenshot
- `GET /api/feedback` -- user list, admin list with filters
- `PATCH /api/feedback/[id]` -- status change, forbidden for non-admin
- `POST /api/feedback/[id]/comments` -- add comment, forbidden for non-admin

### Моки

- Prisma: `vi.mock('@/lib/db')`
- Redis: `vi.mock('@/lib/redis')`
- File system: `vi.mock('fs/promises')`
- Telegram API: `vi.mock` или mock fetch

---

## Последовательность реализации

1. **Prisma schema + migration** -- добавить модели, запустить миграцию
2. **Module files** -- `src/modules/feedback/` (types, validation, file-storage, service, telegram)
3. **API routes** -- все 7 эндпоинтов
4. **Тесты** -- unit + integration (в том же коммите с кодом)
5. **UI: FeedbackButton** -- плавающая кнопка + модальная форма
6. **UI: Admin panel** -- страница `/admin/feedback` с таблицей, фильтрами, деталями
7. **Seed** -- регистрация модуля + sidebar пункт
8. **Smoke test** -- ручная проверка полного flow (создание -> telegram -> просмотр в ЛК -> обработка в админке)

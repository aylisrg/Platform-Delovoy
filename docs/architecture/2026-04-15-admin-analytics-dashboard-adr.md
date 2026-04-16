# ADR: Панель аналитики рекламы (Admin Analytics Dashboard)

**Дата:** 2026-04-15
**Статус:** Предложено
**Авторы:** System Architect (Claude)

---

## Контекст

### Проблема

Владелец парка запустил 3 рекламные кампании в Яндекс.Директ и настроил Яндекс.Метрику (счётчик 73068007, 6 целей конверсий). Данные разбросаны по трём интерфейсам (Директ, Метрика, внутренняя БД), нет единой картины "расход -> клики -> конверсии -> бронирования".

Нужен единый дашборд `/admin/analytics`, агрегирующий данные из внешних API (Яндекс.Метрика, Яндекс.Директ) с кэшированием и выбором периода.

### Требования (Must Have)

- **US-1**: Обзорная панель -- трафик (Метрика), реклама (Директ), конверсии (6 целей) за выбранный период
- **US-2**: Выбор периода (сегодня / 7 / 30 дней / произвольный), по умолчанию 7 дней
- **US-3**: Разбивка по кампаниям Директа (статус, показы, клики, CTR, расход, CPC)
- **US-6**: Сводка "расход -> результат" -- стоимость конверсии по каждому направлению
- **US-7**: Кэширование на 15 мин, кнопка обновления, timestamp "данные обновлены"

### Требования (Should Have)

- **US-4**: Источники трафика (разбивка по UTM/каналам)
- **US-5**: Воронка конверсий (визиты -> submit -> success)

### Won't Have (сознательно исключено)

- Управление кампаниями Директа (создание, редактирование)
- Графики и чарты (Recharts и пр.) -- только таблицы и карточки
- Детализация до уровня объявлений

### Текущая архитектура (что уже есть)

- **Модульная система**: каждый модуль в `src/modules/{slug}/` с `service.ts`, `types.ts`, `validation.ts`
- **API-паттерн**: Route Handlers в `src/app/api/{module}/`, стандартный ответ через `apiResponse()`/`apiError()`
- **Auth**: NextAuth v5 с RBAC (`auth()` -> `session.user.id`, `session.user.role`)
- **Redis**: `src/lib/redis.ts` -- singleton ioredis с graceful degradation (fallback без кэша)
- **Rate limiting**: Redis sliding window в `src/lib/rate-limit.ts`
- **Env vars уже в .env.example**: `YANDEX_OAUTH_TOKEN`, `YANDEX_DIRECT_CLIENT_LOGIN`, `YANDEX_METRIKA_COUNTER_ID`
- **Admin sections**: `src/lib/permissions.ts` -- RBAC через `hasAdminSectionAccess()`, список секций в `ADMIN_SECTIONS`

### Внешние зависимости

| API | Документация | Лимиты |
|-----|-------------|--------|
| Яндекс.Метрика Reporting API | https://yandex.ru/dev/metrika/doc/api2/api_v1/intro.html | 500 запросов/день |
| Яндекс.Директ Reports API v5 | https://yandex.ru/dev/direct/doc/reports/spec.html | Ожидание очереди, retry по HTTP 201/202 |
| Авторизация | OAuth-токен, один на оба API | Единый `YANDEX_OAUTH_TOKEN` |

---

## Рассмотренные варианты

### Получение данных из Яндекс.Метрики

#### Вариант A: Яндекс.Метрика Stat API v1 (REST, JSON)

Запрос `GET https://api-metrika.yandex.net/stat/v1/data` с параметрами `metrics`, `dimensions`, `date1`, `date2`. Ответ -- JSON.

**Плюсы:** Простой REST API, JSON-ответ, не нужно парсить TSV. Стандартный подход для дашбордов.
**Минусы:** Лимит 500 запросов/день (достаточно при кэше 15 мин, ~96 запросов/день максимум на один эндпоинт).

#### Вариант B: Logs API (выгрузка сырых данных)

Скачивать полные логи визитов, считать метрики локально.

**Плюсы:** Полный контроль над данными.
**Минусы:** Overkill для агрегатов, задержка (данные за вчера), большой объём, сложность парсинга. Не подходит для near-realtime дашборда.

### Получение данных из Яндекс.Директа

#### Вариант A: Reports API (TSV-отчёты)

`POST https://api.direct.yandex.com/json/v5/reports` -- запрос отчёта, получение TSV. Поддерживает асинхронный режим (HTTP 201 -- отчёт в очереди, 202 -- обрабатывается, 200 -- готов).

**Плюсы:** Единственный способ получить агрегированную статистику по кампаниям. Гибкие срезы (по кампании, дню, площадке).
**Минусы:** TSV-формат требует парсинга. Асинхронный протокол (нужен retry-loop). Заголовок `returnMoneyInMicros: true` -- суммы в микроединицах (1 руб = 1_000_000).

#### Вариант B: Campaigns.get + отдельные запросы

Получать статистику через Campaigns API v5.

**Плюсы:** JSON.
**Минусы:** Campaigns API не возвращает статистику (показы, клики, расходы). Статистика доступна только через Reports API.

### Кэширование

#### Вариант A: Redis с TTL 15 минут

Ключ = `analytics:{endpoint}:{hash(params)}`, значение = JSON-строка. При запросе: проверить кэш -> если есть, вернуть с `cachedAt` timestamp -> если нет, запросить API, сохранить, вернуть.

**Плюсы:** Переиспользует существующий Redis. Простой invalidation (TTL). Graceful degradation (если Redis недоступен -- запрос напрямую).
**Минусы:** Нет предварительного прогрева (первый запрос после истечения -- медленный).

#### Вариант B: Redis с фоновым обновлением (CRON)

Фоновый cron-job обновляет кэш каждые 15 минут. API всегда читает из кэша.

**Плюсы:** Всегда быстрый ответ.
**Минусы:** Избыточная сложность для MVP. Нужен cron-инфраструктура. Данные обновляются даже когда никто не смотрит дашборд.

### Архитектура API-клиентов

#### Вариант A: Два отдельных клиента в модуле analytics

`metrika-client.ts` и `direct-client.ts` -- изолированные HTTP-клиенты, каждый знает только свой API. Сервис `service.ts` оркестрирует вызовы.

**Плюсы:** Separation of concerns, легко тестировать (мокаем клиент), легко заменить/добавить API.
**Минусы:** Чуть больше файлов.

#### Вариант B: Один универсальный клиент

Один `yandex-client.ts` для обоих API.

**Плюсы:** Меньше файлов.
**Минусы:** Смешение ответственности. Метрика (REST/JSON) и Директ (Reports/TSV) -- принципиально разные протоколы.

---

## Решение

### Получение данных: Метрика -- Вариант A (Stat API), Директ -- Вариант A (Reports API)

**Обоснование:**
1. Stat API покрывает все нужные метрики (визиты, просмотры, цели, источники) через простой REST.
2. Reports API -- единственный способ получить статистику Директа.
3. Оба API используют один OAuth-токен, что упрощает авторизацию.

### Кэширование: Вариант A (Redis с TTL)

**Обоснование:**
1. MVP-подход: не нужен cron, работает "из коробки".
2. При 15 мин TTL и типичной нагрузке (1-2 пользователя смотрят дашборд) -- максимум ~96 запросов/день в Метрику, далеко от лимита 500.
3. Graceful degradation уже реализован в `src/lib/redis.ts`.
4. Кнопка "обновить" принудительно инвалидирует кэш.

### Архитектура: Вариант A (два клиента)

**Обоснование:**
1. Метрика и Директ -- разные протоколы (JSON vs TSV, синхронный vs асинхронный).
2. Отдельные клиенты проще тестировать.
3. Соответствует принципу Domain Modules из CLAUDE.md.

---

## Схема данных

Новых таблиц в Prisma **не требуется**. Все данные приходят из внешних API и кэшируются в Redis. Состояние не хранится в PostgreSQL.

Единственное изменение -- регистрация секции в `ADMIN_SECTIONS`:

```typescript
// src/lib/permissions.ts -- добавить в массив ADMIN_SECTIONS
{ slug: "analytics", label: "Аналитика", icon: "📈" },
```

---

## API-контракты

### Доступ

Все эндпоинты `/api/analytics/*` требуют:
- Авторизацию (`session.user`)
- Роль `SUPERADMIN` (через `requireAdminSection(session, "analytics")`)

### 1. `GET /api/analytics/overview` -- Обзорная панель

Агрегирует данные из Метрики (трафик + конверсии) и Директа (расход) за период.

**Query параметры:**

| Параметр  | Тип    | Обязательно | Описание                          |
|-----------|--------|-------------|-----------------------------------|
| dateFrom  | string | Нет         | Начало периода (YYYY-MM-DD)       |
| dateTo    | string | Нет         | Конец периода (YYYY-MM-DD)        |
| period    | string | Нет         | "today" / "7d" / "30d" (default "7d") |
| forceRefresh | string | Нет      | "true" -- пропустить кэш          |

Если передан `period`, то `dateFrom`/`dateTo` вычисляются автоматически. Если переданы `dateFrom`+`dateTo`, `period` игнорируется.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "period": {
      "dateFrom": "2026-04-08",
      "dateTo": "2026-04-15"
    },
    "traffic": {
      "visits": 1245,
      "pageviews": 3891,
      "users": 876,
      "bounceRate": 32.5,
      "avgVisitDuration": 185.3
    },
    "advertising": {
      "impressions": 15420,
      "clicks": 312,
      "ctr": 2.02,
      "cost": 8540.50,
      "avgCpc": 27.37
    },
    "conversions": [
      {
        "goalId": 123456,
        "goalName": "Бронирование беседки",
        "reaches": 28,
        "conversionRate": 2.25,
        "costPerConversion": 305.02
      },
      {
        "goalId": 123457,
        "goalName": "Заказ в кафе",
        "reaches": 15,
        "conversionRate": 1.20,
        "costPerConversion": 569.37
      }
    ],
    "summary": {
      "totalConversions": 67,
      "totalCost": 8540.50,
      "avgCostPerConversion": 127.47
    },
    "cachedAt": "2026-04-15T12:30:00Z"
  }
}
```

**Ошибки:**
- `401 UNAUTHORIZED` -- нет сессии
- `403 FORBIDDEN` -- не SUPERADMIN
- `422 VALIDATION_ERROR` -- невалидные даты (dateFrom > dateTo, будущие даты)
- `502 EXTERNAL_API_ERROR` -- Яндекс API недоступен
- `503 YANDEX_TOKEN_MISSING` -- не настроен `YANDEX_OAUTH_TOKEN`

### 2. `GET /api/analytics/campaigns` -- Разбивка по кампаниям Директа

**Query параметры:** те же, что у `/overview`.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "period": {
      "dateFrom": "2026-04-08",
      "dateTo": "2026-04-15"
    },
    "campaigns": [
      {
        "campaignId": 12345678,
        "campaignName": "Беседки -- Поиск",
        "status": "ACCEPTED",
        "impressions": 8200,
        "clicks": 185,
        "ctr": 2.26,
        "cost": 4850.00,
        "avgCpc": 26.22
      },
      {
        "campaignId": 12345679,
        "campaignName": "PS Park -- РСЯ",
        "status": "ACCEPTED",
        "impressions": 5100,
        "clicks": 98,
        "ctr": 1.92,
        "cost": 2490.50,
        "avgCpc": 25.41
      },
      {
        "campaignId": 12345680,
        "campaignName": "Кафе -- Поиск",
        "status": "DRAFT",
        "impressions": 2120,
        "clicks": 29,
        "ctr": 1.37,
        "cost": 1200.00,
        "avgCpc": 41.38
      }
    ],
    "totals": {
      "impressions": 15420,
      "clicks": 312,
      "ctr": 2.02,
      "cost": 8540.50,
      "avgCpc": 27.37
    },
    "cachedAt": "2026-04-15T12:30:00Z"
  }
}
```

### 3. `GET /api/analytics/conversions` -- Детализация конверсий

**Query параметры:** те же, что у `/overview`.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "period": {
      "dateFrom": "2026-04-08",
      "dateTo": "2026-04-15"
    },
    "goals": [
      {
        "goalId": 123456,
        "goalName": "Бронирование беседки",
        "reaches": 28,
        "visits": 1245,
        "conversionRate": 2.25
      }
    ],
    "funnel": {
      "totalVisits": 1245,
      "totalGoalReaches": 67,
      "overallConversionRate": 5.38
    },
    "costPerConversion": [
      {
        "goalName": "Бронирование беседки",
        "reaches": 28,
        "totalCost": 8540.50,
        "costPerReach": 305.02
      }
    ],
    "cachedAt": "2026-04-15T12:30:00Z"
  }
}
```

### 4. `GET /api/analytics/health` -- Health check модуля

**Доступ:** Публичный (по конвенции проекта)

**Response (200):**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "module": "analytics",
    "timestamp": "2026-04-15T12:00:00Z",
    "checks": {
      "yandexToken": { "status": "healthy" },
      "redis": { "status": "healthy" }
    }
  }
}
```

При отсутствии `YANDEX_OAUTH_TOKEN` -- `status: "degraded"`, `yandexToken.status: "unhealthy"`.

---

## Zod-схемы валидации

```typescript
// src/modules/analytics/validation.ts

import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const periodSchema = z.enum(["today", "7d", "30d"]).default("7d");

export const analyticsQuerySchema = z
  .object({
    dateFrom: z
      .string()
      .regex(dateRegex, "Формат даты: YYYY-MM-DD")
      .optional(),
    dateTo: z
      .string()
      .regex(dateRegex, "Формат даты: YYYY-MM-DD")
      .optional(),
    period: periodSchema.optional(),
    forceRefresh: z.preprocess(
      (val) => val === "true" || val === true,
      z.boolean().default(false)
    ),
  })
  .refine(
    (data) => {
      if (data.dateFrom && data.dateTo) {
        return data.dateFrom <= data.dateTo;
      }
      return true;
    },
    { message: "dateFrom не может быть позже dateTo" }
  )
  .refine(
    (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.dateTo && data.dateTo > today) return false;
      if (data.dateFrom && data.dateFrom > today) return false;
      return true;
    },
    { message: "Даты не могут быть в будущем" }
  );

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
```

---

## Типы

```typescript
// src/modules/analytics/types.ts

export type DateRange = {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
};

// --- Метрика ---

export type TrafficSummary = {
  visits: number;
  pageviews: number;
  users: number;
  bounceRate: number;       // процент, 0-100
  avgVisitDuration: number; // секунды
};

export type GoalConversion = {
  goalId: number;
  goalName: string;
  reaches: number;
  conversionRate: number;   // процент
  costPerConversion?: number; // рубли (рассчитывается сервисом)
};

export type TrafficSource = {
  source: string;     // "ad", "organic", "direct", "referral", "social"
  visits: number;
  percentage: number; // процент от общего трафика
};

// --- Директ ---

export type CampaignStats = {
  campaignId: number;
  campaignName: string;
  status: string;       // "ACCEPTED", "DRAFT", "ARCHIVED", etc.
  impressions: number;
  clicks: number;
  ctr: number;          // процент
  cost: number;         // рубли
  avgCpc: number;       // рубли
};

export type AdvertisingSummary = {
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  avgCpc: number;
};

// --- Агрегаты ---

export type ConversionCost = {
  goalName: string;
  reaches: number;
  totalCost: number;
  costPerReach: number;
};

export type OverviewData = {
  period: DateRange;
  traffic: TrafficSummary;
  advertising: AdvertisingSummary;
  conversions: GoalConversion[];
  summary: {
    totalConversions: number;
    totalCost: number;
    avgCostPerConversion: number;
  };
  cachedAt: string; // ISO timestamp
};

export type CampaignsData = {
  period: DateRange;
  campaigns: CampaignStats[];
  totals: AdvertisingSummary;
  cachedAt: string;
};

export type ConversionsData = {
  period: DateRange;
  goals: GoalConversion[];
  funnel: {
    totalVisits: number;
    totalGoalReaches: number;
    overallConversionRate: number;
  };
  costPerConversion: ConversionCost[];
  cachedAt: string;
};

// --- Кэш ---

export type CacheOptions = {
  forceRefresh: boolean;
  ttlSeconds: number;
};
```

---

## Клиенты внешних API

### `src/modules/analytics/metrika-client.ts`

HTTP-клиент для Яндекс.Метрика Stat API v1.

```typescript
// Ключевые решения:
// 1. Все запросы через GET https://api-metrika.yandex.net/stat/v1/data
// 2. Авторизация: заголовок Authorization: OAuth {token}
// 3. Параметры: ids (counter), metrics, dimensions, date1, date2
// 4. Ответ: JSON { data: [...], totals: [...], query: {...} }

const METRIKA_BASE_URL = "https://api-metrika.yandex.net/stat/v1/data";

export class MetrikaClient {
  constructor(
    private readonly oauthToken: string,
    private readonly counterId: string
  ) {}

  /**
   * Получить сводку по трафику: визиты, просмотры, пользователи, отказы, длительность.
   * Метрики: ym:s:visits, ym:s:pageviews, ym:s:users, ym:s:bounceRate, ym:s:avgVisitDurationSeconds
   */
  async getTrafficSummary(dateFrom: string, dateTo: string): Promise<TrafficSummary>;

  /**
   * Получить конверсии по целям.
   * Метрики: ym:s:goal<goalId>reaches, ym:s:goal<goalId>conversionRate
   * Для получения списка целей: GET /management/v1/counter/{id}/goals
   */
  async getGoalConversions(dateFrom: string, dateTo: string): Promise<GoalConversion[]>;

  /**
   * Получить разбивку по источникам трафика.
   * Dimensions: ym:s:trafficSource
   * Метрики: ym:s:visits
   */
  async getTrafficSources(dateFrom: string, dateTo: string): Promise<TrafficSource[]>;

  /**
   * Получить список целей счётчика (для маппинга goalId -> goalName).
   * GET /management/v1/counter/{id}/goals
   * Кэшируется на 1 час (цели редко меняются).
   */
  async getGoals(): Promise<Array<{ id: number; name: string }>>;
}
```

**Обработка ошибок:**
- HTTP 403 -- невалидный/просроченный токен -> `YANDEX_AUTH_ERROR`
- HTTP 429 -- превышен лимит запросов -> `YANDEX_RATE_LIMIT` (retry через 60с)
- Таймаут 10с на каждый запрос

### `src/modules/analytics/direct-client.ts`

HTTP-клиент для Яндекс.Директ Reports API v5.

```typescript
// Ключевые решения:
// 1. POST https://api.direct.yandex.com/json/v5/reports
// 2. Авторизация: Authorization: Bearer {token}, Client-Login: {login}
// 3. Ответ: TSV (tab-separated values), требует парсинга
// 4. Асинхронный протокол:
//    - HTTP 201: отчёт поставлен в очередь, retry через retryIn секунд
//    - HTTP 202: отчёт формируется, retry через retryIn секунд
//    - HTTP 200: отчёт готов, тело -- TSV
// 5. Суммы в микроединицах (returnMoneyInMicros: false для удобства)

const DIRECT_REPORTS_URL = "https://api.direct.yandex.com/json/v5/reports";

export class DirectClient {
  constructor(
    private readonly oauthToken: string,
    private readonly clientLogin: string
  ) {}

  /**
   * Получить статистику по кампаниям за период.
   *
   * Report Definition:
   *   SelectionCriteria: { DateFrom, DateTo }
   *   FieldNames: [CampaignId, CampaignName, CampaignStatus, Impressions, Clicks, Ctr, Cost, AvgCpc]
   *   ReportType: CAMPAIGN_PERFORMANCE_REPORT
   *   DateRangeType: CUSTOM_DATE
   *   ReportName: "analytics-{dateFrom}-{dateTo}"
   *   Format: TSV
   *   IncludeVAT: YES
   *   IncludeDiscount: NO
   *
   * Retry logic: до 5 попыток с экспоненциальным backoff (5s, 10s, 20s, 40s, 60s).
   */
  async getCampaignStats(dateFrom: string, dateTo: string): Promise<CampaignStats[]>;

  /**
   * Парсинг TSV-ответа Директа в типизированный массив.
   * Пропускает строки-заголовки (начинаются с "CampaignId" или содержат "Total").
   * Конвертирует Cost и AvgCpc из микроединиц в рубли (если returnMoneyInMicros: true).
   */
  private parseTsvReport(tsv: string): CampaignStats[];
}
```

**Обработка ошибок:**
- HTTP 400 -- невалидный запрос (логировать тело ответа)
- HTTP 201/202 -- retry (не ошибка, штатный асинхронный протокол)
- HTTP 500/502/503 -- `DIRECT_API_ERROR`, retry 1 раз
- Таймаут 30с (отчёты могут формироваться долго)

---

## Сервисный слой

```typescript
// src/modules/analytics/service.ts

import { redis, redisAvailable } from "@/lib/redis";
import { MetrikaClient } from "./metrika-client";
import { DirectClient } from "./direct-client";
import type { OverviewData, CampaignsData, ConversionsData, DateRange } from "./types";

const CACHE_TTL = 900; // 15 минут в секундах

/**
 * Разрешает period/dateFrom/dateTo в конкретный DateRange.
 */
export function resolveDateRange(params: {
  dateFrom?: string;
  dateTo?: string;
  period?: "today" | "7d" | "30d";
}): DateRange;

/**
 * Обзорная панель: трафик + расходы + конверсии.
 * Параллельно запрашивает Метрику (трафик, цели) и Директ (расходы).
 * Вычисляет стоимость конверсии = totalCost / reaches.
 */
export async function getOverview(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<OverviewData>;

/**
 * Статистика по кампаниям Директа.
 */
export async function getCampaigns(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<CampaignsData>;

/**
 * Детализация конверсий: все цели, воронка, стоимость.
 */
export async function getConversions(
  dateRange: DateRange,
  forceRefresh: boolean
): Promise<ConversionsData>;

// --- Кэширование ---

/**
 * Обёртка для кэширования результатов.
 * Ключ: analytics:{endpoint}:{dateFrom}:{dateTo}
 * TTL: 900 секунд (15 минут).
 * При forceRefresh -- удаляет ключ перед запросом.
 * При недоступности Redis -- запрос идёт напрямую.
 */
async function withCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  options: { forceRefresh: boolean; ttl: number }
): Promise<{ data: T; cachedAt: string }>;
```

**Ключевое решение -- параллельные запросы:**

В `getOverview` данные из Метрики и Директа запрашиваются через `Promise.all`:
```
const [traffic, goals, campaigns] = await Promise.all([
  metrikaClient.getTrafficSummary(...),
  metrikaClient.getGoalConversions(...),
  directClient.getCampaignStats(...),
]);
```
Это сокращает время ответа с ~3с (последовательно) до ~1.5с (параллельно).

**Вычисление стоимости конверсии:**

`costPerConversion = totalDirectCost / goalReaches`. Если `goalReaches = 0`, то `costPerConversion = null` (не Infinity).

---

## Redis-кэширование: детали

```
Ключи:
  analytics:overview:{dateFrom}:{dateTo}
  analytics:campaigns:{dateFrom}:{dateTo}
  analytics:conversions:{dateFrom}:{dateTo}
  analytics:metrika-goals                     // TTL 1 час (список целей)

Формат значения: JSON.stringify({ data, cachedAt })
TTL: 900 секунд (15 минут)
```

**Инвалидация:**
- Автоматическая по TTL (15 мин)
- Принудительная: `forceRefresh=true` -> `redis.del(key)` перед запросом
- Разные периоды = разные ключи (не конфликтуют)

**Graceful degradation:**
- Если `redisAvailable === false` -- запросы идут напрямую в API, без кэширования
- Если Redis упал между запросами -- `try/catch`, fallback на прямой запрос

---

## Структура файлов модуля

```
src/modules/analytics/
  types.ts              -- TypeScript типы (DateRange, TrafficSummary, CampaignStats, etc.)
  validation.ts         -- Zod-схемы (analyticsQuerySchema, periodSchema)
  metrika-client.ts     -- HTTP-клиент для Яндекс.Метрика Stat API
  direct-client.ts      -- HTTP-клиент для Яндекс.Директ Reports API
  service.ts            -- Бизнес-логика (getOverview, getCampaigns, getConversions, withCache)
  __tests__/
    service.test.ts
    validation.test.ts
    metrika-client.test.ts
    direct-client.test.ts

src/app/api/analytics/
  overview/
    route.ts            -- GET /api/analytics/overview
  campaigns/
    route.ts            -- GET /api/analytics/campaigns
  conversions/
    route.ts            -- GET /api/analytics/conversions
  health/
    route.ts            -- GET /api/analytics/health

src/app/(admin)/admin/analytics/
  page.tsx              -- Страница дашборда
  loading.tsx           -- Skeleton loader

src/components/admin/analytics/
  overview-cards.tsx    -- Карточки: трафик, расходы, конверсии
  campaigns-table.tsx   -- Таблица кампаний Директа
  conversions-table.tsx -- Таблица конверсий по целям
  period-selector.tsx   -- Выбор периода (сегодня / 7д / 30д / произвольный)
  refresh-button.tsx    -- Кнопка обновления + timestamp "данные обновлены ..."
```

---

## Route Handler (пример)

```typescript
// src/app/api/analytics/overview/route.ts

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiResponse, apiError, requireAdminSection, apiServerError } from "@/lib/api-response";
import { analyticsQuerySchema } from "@/modules/analytics/validation";
import { getOverview, resolveDateRange } from "@/modules/analytics/service";

export async function GET(request: NextRequest) {
  const session = await auth();
  const denied = await requireAdminSection(session, "analytics");
  if (denied) return denied;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = analyticsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 422);
  }

  const { dateFrom, dateTo, period, forceRefresh } = parsed.data;

  if (!process.env.YANDEX_OAUTH_TOKEN) {
    return apiError("YANDEX_TOKEN_MISSING", "Не настроен YANDEX_OAUTH_TOKEN", 503);
  }

  try {
    const dateRange = resolveDateRange({ dateFrom, dateTo, period });
    const data = await getOverview(dateRange, forceRefresh);
    return apiResponse(data);
  } catch (error) {
    if (error instanceof Error && error.message.includes("YANDEX_")) {
      return apiError("EXTERNAL_API_ERROR", error.message, 502);
    }
    return apiServerError();
  }
}
```

---

## Интеграция с существующим кодом

### Минимальные изменения

1. **`src/lib/permissions.ts`** -- добавить `"analytics"` в `ADMIN_SECTIONS`:
   ```typescript
   { slug: "analytics", label: "Аналитика", icon: "📈" },
   ```

2. **Sidebar** -- добавить пункт меню "Аналитика" (аналогично существующим пунктам).

3. **`.env.example`** -- переменные уже есть (`YANDEX_OAUTH_TOKEN`, `YANDEX_DIRECT_CLIENT_LOGIN`, `YANDEX_METRIKA_COUNTER_ID`).

4. **`prisma/seed.ts`** -- зарегистрировать модуль:
   ```typescript
   await prisma.module.upsert({
     where: { slug: "analytics" },
     create: {
       slug: "analytics",
       name: "Аналитика рекламы",
       description: "Дашборд рекламной аналитики: Яндекс.Директ + Метрика",
       isActive: true,
     },
     update: {},
   });
   ```

### Нулевое влияние на:
- Prisma schema (нет новых моделей)
- Существующие API routes
- Существующие компоненты
- Auth/middleware

---

## Безопасность

1. **Только SUPERADMIN** -- все эндпоинты через `requireAdminSection(session, "analytics")`
2. **OAuth-токен** -- хранится в `.env`, не передаётся клиенту, не логируется
3. **Нет мутаций** -- модуль read-only, данные из внешних API, нет записи в БД
4. **Rate limiting** -- стандартный `rateLimit(request, "authenticated")` на эндпоинтах
5. **Нет пользовательского ввода, передаваемого во внешние API** -- только даты, валидированные Zod
6. **AuditLog** -- логируется доступ к дашборду (action: `analytics.view`)

---

## Тестирование

### Unit-тесты (Vitest)

- **`validation.test.ts`**: analyticsQuerySchema -- valid periods, custom dates, edge cases (dateFrom > dateTo, future dates, missing params)
- **`metrika-client.test.ts`**: мок fetch, проверка формирования URL с правильными параметрами, парсинг JSON-ответа, обработка ошибок (403, 429, таймаут)
- **`direct-client.test.ts`**: мок fetch, async retry logic (201 -> 202 -> 200), парсинг TSV, обработка ошибок
- **`service.test.ts`**: getOverview (happy path, кэш hit, кэш miss, forceRefresh, Redis недоступен), getCampaigns, getConversions, resolveDateRange (все варианты period)

### Моки

```typescript
vi.mock("@/lib/redis");          // redisAvailable = true, redis.get/set/del
vi.mock("global.fetch");         // Мок HTTP-запросов к Яндекс API
```

Не нужен мок Prisma -- модуль не обращается к БД.

---

## Последовательность реализации

1. **Типы и валидация** -- `types.ts`, `validation.ts` + тесты
2. **Клиенты** -- `metrika-client.ts`, `direct-client.ts` + тесты
3. **Сервис** -- `service.ts` (оркестрация, кэширование) + тесты
4. **API routes** -- 4 эндпоинта (`overview`, `campaigns`, `conversions`, `health`)
5. **Permissions** -- добавить `"analytics"` в `ADMIN_SECTIONS`
6. **UI** -- `page.tsx`, компоненты (карточки, таблицы, period-selector)
7. **Seed** -- регистрация модуля
8. **Smoke test** -- проверка с реальным токеном на staging

Ожидаемый объём: ~800-1000 строк кода + ~400 строк тестов.

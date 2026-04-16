# QA Report: Панель аналитики рекламы (Яндекс.Директ + Метрика)

**Дата**: 2026-04-15
**Версия**: 1e60e00 (feat(analytics): add advertising analytics dashboard)
**Статус**: FAIL (3 блокирующих бага, 3 замечания)

---

## Результаты тестов

```
npm test: 869 tests passed / 0 failed
Test Files: 52 passed (52)
Duration: 1.65s
```

Тесты зелёные. Модуль analytics покрыт 4 тест-файлами:
- `src/modules/analytics/__tests__/validation.test.ts` (8 кейсов)
- `src/modules/analytics/__tests__/service.test.ts` (4 кейса)
- `src/modules/analytics/__tests__/metrika-client.test.ts` (4 кейса)
- `src/modules/analytics/__tests__/direct-client.test.ts` (3 кейса)

Однако `npx tsc --noEmit --strict` выявляет **4 TS-ошибки** в модуле analytics (см. BUG-1, BUG-2).

---

## Проверка acceptance criteria

| AC | Описание | Статус | Комментарий |
|----|----------|--------|-------------|
| US-1.1 | Страница `/admin/analytics` доступна SUPERADMIN | PASS | `requireAdminSection(session, "analytics")` в каждом route handler, sidebar содержит пункт "Аналитика" с `section: "analytics"` |
| US-1.2 | Блок трафика: визиты, просмотры, отказы | PASS | Карточки "Визиты", "Просмотры страниц", "Ср. время на сайте" рендерятся из `overview.traffic` |
| US-1.3 | Блок рекламы: показы, клики, CTR, расход, CPC | PASS | Карточки "Показы рекламы", "CTR", "Расход на рекламу" из `overview.advertising` |
| US-1.4 | Блок конверсий: 6 целей | PASS | Таблица "Конверсии по целям" рендерит все goals из Метрики. Фильтрация по `type === "action"` |
| US-1.5 | Загрузка < 5 сек | N/A | Нельзя проверить без production API. Архитектурно: 3 параллельных fetch + Redis-кэш 15 мин |
| US-1.6 | Если API не настроен -- понятное сообщение | **FAIL** | См. BUG-3: если Метрика настроена, а Директ нет -- overview/conversions падают целиком вместо graceful degradation. Также при невалидных параметрах роуты крашатся (BUG-1) |
| US-2.1 | Переключатель: сегодня/7д/30д | PASS | 3 кнопки, состояние в `useState<Period>("7d")` |
| US-2.2 | По умолчанию 7д | PASS | `useState<Period>("7d")`, серверный fallback: `params.period ?? "7d"` |
| US-2.3 | Данные обновляются без перезагрузки | PASS | `useEffect(() => fetchData(period), [period, fetchData])` -- при смене периода fetch без reload |
| US-3.1 | Разбивка по кампаниям Директа | PASS | Таблица "Кампании Яндекс.Директ": campaignName, status, impressions, clicks, CTR, cost, CPC |
| US-3.2 | Сортировка по расходу | PASS | `[...campaigns].sort((a, b) => b.cost - a.cost)` в `getCampaigns` |
| US-3.3 | Подсветка лучшего/худшего CTR | PASS | `text-green-600` для best CTR, `text-orange-500` для worst (>0). Но bestCtr/worstCtr пересчитываются в каждой итерации map -- см. NOTE-1 |
| US-6.1 | Расход, конверсии, стоимость конверсии по направлениям | PASS | Карточки "Всего конверсий" и "Ср. стоимость конверсии" + таблица конверсий по целям со столбцом "Стоимость" |
| US-6.2 | Если конверсий 0 -- прочерк | PASS | `costPerConversion: g.reaches > 0 ? ... : null` + `formatCurrency(null)` возвращает "—" |
| US-7.1 | Кэш 15 мин | PASS | `CACHE_TTL = 900` (15 мин), `redis.setex(cacheKey, options.ttl, ...)` |
| US-7.2 | Кнопка "Обновить" | PASS | Кнопка "Обновить" вызывает `fetchData(period, true)` с `forceRefresh=true` |
| US-7.3 | Timestamp "данные обновлены" | PASS | `overview?.cachedAt` рендерится как "Данные обновлены: ..." |

---

## Баги

### BUG-1 (Blocker): `parsed.error.errors` не существует -- runtime crash при невалидных параметрах

**Файлы**: `src/app/api/analytics/overview/route.ts:15`, `campaigns/route.ts:15`, `conversions/route.ts:15`

**Проблема**: Все 3 route handler-а обращаются к `parsed.error.errors[0].message`, но `ZodError` не имеет свойства `.errors`. Правильное свойство -- `.issues`. Проверено: `node -e "const {z}=require('zod'); console.log(!!z.string().safeParse(123).error.errors)"` => `false`.

**Воспроизведение**: `GET /api/analytics/overview?dateFrom=invalid` -- вместо 422 с сообщением об ошибке вернёт 500.

**Исправление**: Заменить `parsed.error.errors[0].message` на `parsed.error.issues[0].message` (как в остальных route handler-ах проекта).

**tsc output**:
```
src/app/api/analytics/overview/route.ts(15,54): error TS2339: Property 'errors' does not exist on type 'ZodError<...>'.
src/app/api/analytics/campaigns/route.ts(15,54): error TS2339: ...
src/app/api/analytics/conversions/route.ts(15,54): error TS2339: ...
```

---

### BUG-2 (Minor): Пропущен импорт `afterEach` в тесте

**Файл**: `src/modules/analytics/__tests__/service.test.ts:1`

**Проблема**: Импортируется `{ describe, it, expect, vi, beforeEach }`, но на строке 38 используется `afterEach` без импорта. Vitest предоставляет `afterEach` глобально, поэтому тесты проходят, но `tsc --strict` выдаёт ошибку:
```
src/modules/analytics/__tests__/service.test.ts(38,3): error TS2304: Cannot find name 'afterEach'.
```

**Исправление**: Добавить `afterEach` в импорт из vitest.

---

### BUG-3 (Major): overview и conversions падают если Директ не настроен

**Файлы**: `src/modules/analytics/service.ts:74`, `src/app/api/analytics/overview/route.ts:18-19`

**Проблема**: В `getOverview` и `getConversions` вызывается `getDirectClient()`, который бросает синхронное исключение если `YANDEX_DIRECT_CLIENT_LOGIN` не задан. Однако:

1. Route handler `/api/analytics/overview` проверяет только `YANDEX_OAUTH_TOKEN`, но НЕ проверяет `YANDEX_DIRECT_CLIENT_LOGIN`
2. Route handler `/api/analytics/conversions` аналогично
3. `.catch(() => [])` на `direct.getCampaignStats(...)` ловит только async-ошибки, но `getDirectClient()` бросает ДО вызова async-метода

**Результат**: Если Метрика настроена, а Директ нет -- вместо показа трафика с пустым блоком рекламы пользователь получает 502 ошибку на всю страницу.

**Исправление**: Обернуть создание DirectClient и его вызов в try/catch внутри fetcher-а, или вынести проверку `YANDEX_DIRECT_CLIENT_LOGIN` в route handler overview (как сделано в campaigns), или создавать DirectClient lazy:
```typescript
const directResult = await (async () => {
  try {
    const direct = getDirectClient();
    return await direct.getCampaignStats(...);
  } catch { return []; }
})();
```

---

## Замечания (не блокирующие)

### NOTE-1: bestCtr/worstCtr пересчитываются в каждой строке таблицы

**Файл**: `src/app/admin/analytics/page.tsx:200-201`

Внутри `campaigns.campaigns.map(...)` на каждой итерации вычисляются `Math.max(...)` и `Math.min(...)` по всему массиву. При 100+ кампаниях -- O(n^2). Рекомендуется вынести вычисление за пределы `.map()`.

---

### NOTE-2: Стоимость конверсии по целям -- неточная атрибуция

**Файл**: `src/modules/analytics/service.ts:89`

```typescript
costPerConversion: g.reaches > 0 ? Math.round((totalCost / g.reaches) * 100) / 100 : null
```

Весь рекламный бюджет делится на reaches каждой цели независимо. Если 2 цели по 10 reaches и бюджет 1000 руб., каждая покажет 100 руб./конверсию, хотя общая стоимость конверсии = 50 руб. Для MVP допустимо, но стоит уточнить бизнес-требования.

---

### NOTE-3: Health endpoint не требует авторизации

**Файл**: `src/app/api/analytics/health/route.ts`

Health check `/api/analytics/health` не проверяет сессию. Любой может узнать, настроены ли Yandex-токены и доступен ли Redis. Для внутреннего мониторинга это может быть допустимо (другие модули тоже так делают), но стоит зафиксировать решение.

---

## Качество кода

| Критерий | Статус | Детали |
|----------|--------|--------|
| No `any` | PASS | Ни одного `any` в модуле analytics и route handlers |
| apiResponse/apiError | PASS | Все 4 route handler-а используют `apiResponse()` / `apiError()` / `apiServerError()` |
| Zod validation | PASS | `analyticsQuerySchema` с `.safeParse()` на входе каждого route handler-а. Валидация дат, формата, периодов, forceRefresh |
| RBAC | PASS | `requireAdminSection(session, "analytics")` в overview, campaigns, conversions. Секция "analytics" зарегистрирована в permissions.ts |
| Sidebar | PASS | Пункт "Аналитика" добавлен в sidebar с `section: "analytics"` и href `/admin/analytics` |
| TypeScript strict | **FAIL** | 4 TS-ошибки (BUG-1 + BUG-2) |
| Error handling | PARTIAL | Yandex API ошибки отлавливаются корректно (502), но Zod validation crash (BUG-1) и partial config crash (BUG-3) |
| Caching | PASS | Redis кэш с TTL 15 мин, forceRefresh для принудительного обновления, graceful fallback если Redis недоступен |
| Test coverage | PASS | 4 тест-файла покрывают validation (8 кейсов), service (4), metrika-client (4), direct-client (3). Happy path + error path + edge cases |

---

## Тестовое покрытие -- детали

| Тест-файл | Кейсы | Покрытие |
|-----------|-------|----------|
| validation.test.ts | 8 | Валидный period, пустой объект, custom range, невалидный формат, dateFrom>dateTo, будущие даты, forceRefresh string->boolean, невалидный period |
| service.test.ts | 4 | resolveDateRange: custom range, default 7d, today, 30d |
| metrika-client.test.ts | 4 | Traffic summary, goals list (фильтрация action), API error, traffic sources |
| direct-client.test.ts | 3 | TSV parsing, retry на 201/202, API error |

**Отсутствует**: тесты на `getOverview`, `getCampaigns`, `getConversions` (интеграция Metrika+Direct+Cache). Тестируется только `resolveDateRange` из service.ts. Рекомендуется добавить мок-тесты для основных функций сервиса.

---

## Резюме

Реализация архитектурно качественная: правильная модульная структура, типизация, RBAC, кэширование, Zod-валидация. Однако обнаружены 3 бага, из которых BUG-1 -- блокер (runtime crash при невалидных параметрах), BUG-3 -- major (невозможность показать данные при частичной конфигурации API).

**Рекомендация**: исправить BUG-1 и BUG-3 перед мержем. BUG-2 и NOTE-1..3 можно взять в следующую итерацию.

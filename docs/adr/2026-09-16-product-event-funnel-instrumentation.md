# ADR: ProductEvent — first-party события воронки и точки инструментирования

**Дата:** 2026-09-16 · **Статус:** предложено · **Issue:** #725 (US-1 эпика #583)
**PRD:** `docs/requirements/2026-08-21-product-loop-prd.md`
**Закрывает открытые вопросы PRD:** №1 (дом данных) и №4 (где фиксируются промежуточные шаги)

---

## 1. Контекст

`src/modules/analytics` сегодня — read-through к Яндекс.Метрике и Директу: это
данные о **рекламе**. Своей воронки продукта нет: 4 финальные конверсии уже
уходят с сервера в Метрику (`src/lib/metrika-server.ts` → `trackServerGoal`
в `POST /api/rental/inquiries`, `/api/gazebos/book`, `/api/ps-park/book`,
`/api/cafe/checkout`), но в нашей БД не остаётся ничего, и промежуточные шаги
(«посмотрел» → «выбрал слот» → «отправил» → «оплатил») не фиксируются нигде.
Исторический инцидент — `docs/analytics/2026-04-29-metrika-tracking-gap.md`:
126 платных визитов → 1 конверсия в Метрике, нашли вручную.

US-1 требует: писать шаги воронок в свою БД, без PII, так, чтобы сбой записи
никогда не задевал бронирование/заказ/заявку, и чтобы данные выбирались по
воронке + шагу + периоду (AC-1.1 … AC-1.7).

Жёсткие рамки: **новый модуль запрещён** (Scope guard CLAUDE.md #1 и рамка
эпика) — данные живут либо в `analytics`, либо в `monitoring`.

Что проверено по коду перед решением:

- `src/modules/analytics/` — `service.ts` (Метрика/Директ + кэш в Redis),
  `metrika-client.ts`, `direct-client.ts`, `types.ts`, `validation.ts`;
  владеет настройкой `primaryGoalId` в `Module.config` (slug `analytics`);
  собственных Prisma-моделей нет.
- `src/modules/monitoring/` — `service.ts` (чтение `SystemEvent`/`AuditLog`,
  запись client-beacon), `system-status-service.ts`, `architect-*.ts`;
  де-факто владеет `SystemEvent` (level/source/message — телеметрия
  работоспособности, вход в алертинг: ERROR/CRITICAL → Telegram).
- Публичные страницы `/gazebos`, `/ps-park`, `/cafe`, `/rental` — все
  `export const dynamic = "force-dynamic"`, то есть рендерятся на сервере
  на каждый запрос.
- `src/lib/rate-limit.ts` — прецедент обезличивания:
  `createHash("sha256").update(subject).digest("hex").slice(0, 16)`; ключ —
  доверенный IP из `getClientIp()` (`X-Real-IP` от nginx).
- `src/app/api/monitoring/client-error/route.ts` — прецедент публичного
  анонимного ingest-эндпоинта (rate-limit тир `client-error` 10/мин, жёсткая
  Zod-схема, запись через нешвыряющий `log.warn`).
- `src/lib/auth.config.ts` — публичные POST-роуты перечислены точным
  allowlist'ом (`isPublicPostRoute`), тест на allowlist —
  `src/lib/__tests__/auth.config.test.ts`.
- `src/modules/payments/service.ts` → `markSucceeded()` — единственная точка,
  где платёж становится `SUCCEEDED` (вебхук ЮKassa + reconciliation-cron).

---

## 2. Решение 1 — дом данных: модуль `analytics`

### Варианты

**A. `src/modules/monitoring/` (рядом с `SystemEvent`).**
- Плюсы: там уже живёт «поток событий» и публичный бикон-эндпоинт —
  механика похожа; можно было бы вообще писать в `SystemEvent`.
- Минусы: у `monitoring` семантика **наблюдаемости платформы** — `level`,
  `source`, `message`, спайк-детекция (`scripts/lib/pattern-extractor.ts`),
  алерты в Telegram при ERROR/CRITICAL, `backlog-intake.yml` заводит issues по
  паттернам. Поток поведения посетителей (на порядок больше строк, ни одного
  инцидента внутри) размывает эти сигналы: либо шумит в спайк-детекции, либо
  требует исключений в каждом потребителе. Потребитель данных воронки —
  владелец и недельный product-analyst, а не дежурный по инцидентам.

**B. `src/modules/analytics/` (рядом с `metrika-client.ts`). ВЫБРАНО.**
- Плюсы: совпадает **потребитель и назначение** — конверсии, воронка,
  недельный отчёт владельцу; US-2/US-4 читают отсюда же и сравнивают
  first-party шаги с визитами/целями Метрики в одном отчёте; `primaryGoalId`
  (US-4) уже лежит в `Module.config` слага `analytics`; админ-раздел `analytics`
  и его RBAC (`requireAdminSection(session, "analytics")`) уже существуют —
  новый read-эндпоинт получает готовую авторизацию и место в админке.
- Минусы: сегодняшний фактический скоуп модуля — «реклама», добавляем второй
  подраздел «продукт»; модуль перестаёт быть чисто read-through (появляется
  запись в свою таблицу) и начинает вызываться из публичных роутов других
  модулей. Оба минуса — вопрос внутренней структуры файлов, а не архитектуры;
  снимаются отдельным файлом `product-events.ts` и каталогом `funnels.ts`.

**C. Писать в существующий `SystemEvent` (`level: INFO`, `source: "funnel"`).**
- Отвергнуто: нет типизированных колонок `funnel`/`step`/`sessionKey` →
  агрегация AC-1.7 превращается в запросы по JSON без индексов; смешивает
  продуктовые данные с операционными в одной таблице с чужой ретенцией; любой
  потребитель `SystemEvent` (log-reader, спайк-детектор, админ-мониторинг)
  вынужден фильтровать наш шум.

### Выбор

**Вариант B — `src/modules/analytics/`.** Определяющий аргумент: `monitoring`
отвечает на вопрос «платформа жива?», `analytics` — на вопрос «сколько людей
дошло до денег и где отвалилось». ProductEvent — второй вопрос. Совпадение
механики (поток строк + бикон) слабее совпадения домена и потребителя.

Раскладка файлов (новые файлы, без нового модуля):

```
src/modules/analytics/
├── funnels.ts          # каталог воронок и шагов (источник истины порядка шагов)
├── product-events.ts   # recordFunnelStep / recordFunnelStepAsync / getFunnelStats
├── validation.ts       # + productEventIngestSchema, funnelStatsQuerySchema
├── types.ts            # + FunnelKey, FunnelStepKey, FunnelStats
└── __tests__/product-events.test.ts, __tests__/funnels.test.ts
src/lib/funnel-beacon.ts   # клиентский хелпер sendBeacon (единственная клиентская часть)
src/app/api/analytics/events/route.ts   # публичный ingest (POST, без auth)
src/app/api/analytics/funnel/route.ts   # админское чтение (GET, раздел analytics)
```

---

## 3. Схема данных

```prisma
/// First-party событие воронки (US-1 эпика #583, ADR 2026-09-16).
/// Домен — модуль analytics (см. ADR §2). PII не хранит: sessionKey — это
/// невосстановимый хэш (соль + доверенный IP + user-agent + календарная дата
/// МСК), сырые IP/UA/имя/телефон/email/ИНН в таблицу не попадают НИКОГДА,
/// включая metadata (валидируется allowlist'ом ключей в product-events.ts).
model ProductEvent {
  id         String   @id @default(cuid())
  /// Ключ воронки: gazebos | ps-park | cafe | rental (см. funnels.ts)
  funnel     String
  /// Ключ шага: view | slot_selected | cart_item_added | form_started | submitted | paid
  step       String
  /// Обезличенный идентификатор посетителя-дня. null — серверное событие без
  /// браузерного контекста (например, вебхук оплаты, когда унаследовать не удалось).
  sessionKey String?
  /// Слаг модуля-владельца шага — для фильтров и связи с таблицей Module.
  moduleSlug String
  /// Id брони/заказа/заявки. Связывает шаг submitted с шагом paid
  /// (у вебхука ЮKassa нет браузерного контекста).
  entityId   String?
  /// Только неперсональные примитивы из allowlist'а (amountRub, slotCount, ...).
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([funnel, step, createdAt]) // основной паттерн AC-1.7
  @@index([createdAt])               // ретенция/уборка и общие срезы по периоду
  @@index([entityId])                // наследование sessionKey на шаге paid
}
```

**Почему именно так (отличия от формы, предложенной PRD):**

- `sessionKey` сделан **nullable**: шаг `paid` приходит из вебхука провайдера,
  где браузерного контекста нет; null честнее фиктивного значения.
- Добавлен `entityId` — без него шаг оплаты невозможно связать с сессией,
  которая создала бронь/заказ, и невозможно отсечь оплаты админских броней
  (см. §5.4).
- Порядок шагов **не хранится в БД** — он в каталоге `funnels.ts`. Иначе
  переименование/перестановка шага требует миграции данных; при каталоге в коде
  отчёт всегда рисует актуальный порядок, а осиротевшие строки старых шагов
  просто не попадают в отчёт (осознанный компромисс, зафиксирован здесь).
- `funnel` и `moduleSlug` оба остаются (как в PRD): сегодня они совпадают, но
  `funnel` — аналитический ключ (в одном модуле может появиться вторая воронка),
  `moduleSlug` — связь с `Module`/RBAC-фильтрами.
- Enum'ов Postgres нет намеренно: добавление шага не должно требовать
  `ALTER TYPE` (деструктивный класс миграций). Валидация — Zod + каталог.

### Миграция

`prisma/migrations/20260916000000_add_product_event/migration.sql` — **чисто
аддитивная**: `CREATE TABLE "ProductEvent"` + три `CREATE INDEX`. Ни одной
существующей таблицы не трогает, данные не переносятся (PRD прямо исключает
ретроспективное восстановление воронки — события считаются только вперёд).
Блокировок на живых таблицах нет, откат = `DROP TABLE`.

### Объём и ретенция

Порядок трафика (данные из `docs/analytics/2026-04-29-metrika-tracking-gap.md`)
— сотни визитов в месяц, то есть тысячи строк в месяц. Отдельная уборка в v1
**не делается** (решение «не переусложняй»); когда/если таблица перевалит
~1 млн строк, добавляется cron-задача удаления по `createdAt` (индекс уже есть)
— отдельной задачей, не в этом PR.

---

## 4. `sessionKey`: как получается обезличенный идентификатор (AC-1.5)

### Варианты

**A. Новая first-party cookie (случайный id).** Точнее всех склеивает сессию,
но: PRD прямо обещает «без нового UI/куки», появляется вопрос согласия
(152-ФЗ / баннер), и это новая сущность в проде. Отвергнуто.

**B. Переиспользовать `_ym_uid` Метрики.** Отвергнуто по двум причинам:
(1) у части посетителей cookie заблокирована — ровно та аудитория, ради которой
строится first-party воронка; (2) Метрика ставит cookie **на первом рендере**,
поэтому шаг `view` нового посетителя пришёлся бы на «нет cookie», а последующие
шаги — на «есть cookie»: воронка разваливалась бы именно для новых визитов.

**C. Хэш от доверенного IP + user-agent + даты. ВЫБРАНО.**

```
salt       = process.env.PRODUCT_EVENT_SALT   // ops-env; см. ниже
subject    = `${getClientIp(request)}|${userAgent ?? ""}|${moscowDate}`  // YYYY-MM-DD
sessionKey = sha256(`${salt}|${subject}`).slice(0, 32)
```

- Прецедент тот же, что в `src/lib/rate-limit.ts` (`log429Sampled`): в БД
  уходит только хэш, сырой IP/UA — никогда.
- Стабилен с самого первого запроса, не зависит ни от cookie, ни от JS, ни от
  блокировщиков — то есть удовлетворяет и AC-1.5, и духу US-1.
- Секрет: `PRODUCT_EVENT_SALT` (32+ байт), раскатывается через `ops-env`.
  Если переменной нет — генерируется случайная соль на процесс и один раз
  пишется WARNING; события продолжают писаться, но склейка сессий не переживает
  рестарт. Без соли хэш от IP+UA перебираем (пространство мало) — поэтому
  соль обязательна для свойства «нельзя установить личность».
- Бакет — календарная дата МСК (`toISODate` из `src/lib/format.ts`): визит
  через полночь распадётся на две «сессии». Парк закрывается в 22:30, кафе
  работает днём — эффект пренебрежимо мал.
- **Известное ограничение (в ADR явно):** CGNAT мобильных операторов РФ —
  несколько посетителей за одним IP с одинаковым UA склеятся в один
  `sessionKey`. Счётчики событий по шагам это не искажает; конверсия «по
  уникальным сессиям» занижается. Смещение систематическое и стабильное во
  времени, поэтому недельные сравнения (US-2) остаются корректными. Отчёт
  должен показывать И число событий, И число уникальных sessionKey.

---

## 5. Решение 2 — где фиксируется каждый шаг (открытый вопрос PRD №4)

### 5.1 Каталог воронок (`src/modules/analytics/funnels.ts`)

Имена шагов унифицированы между воронками (`view` → интент → `submitted` →
`paid`), чтобы отчёт и агрегация были одним кодом, а человеческие подписи брались
из каталога:

| Воронка | Шаги (в порядке) |
|---------|------------------|
| `gazebos` | `view` → `slot_selected` → `submitted` → `paid` |
| `ps-park` | `view` → `slot_selected` → `submitted` → `paid` |
| `cafe` | `view` (меню) → `cart_item_added` → `submitted` → `paid` |
| `rental` | `view` → *(`form_started`, опционально)* → `submitted` (шага оплаты нет — это лид, AC-1.4) |

Каталог хранит для каждого шага: человеческую подпись, `dedupeWindowSec`
(0 = не дедуплицировать) и флаг `clientRecordable`.

### 5.2 Таблица точек записи

| Воронка | Шаг | Где фиксируется | Точный колл-сайт | Почему так |
|---------|-----|-----------------|------------------|------------|
| gazebos | `view` | **сервер (RSC)** | `src/app/(public)/gazebos/page.tsx`, `after(...)` | страница `force-dynamic` → рендер на каждый запрос; не зависит от JS/блокировщиков |
| gazebos | `slot_selected` | **клиент, sendBeacon** | `src/components/public/gazebos/booking-flow.tsx` → `toggleSlot()` / `selectFullDay()`, один раз за сессию | серверный `GET /api/gazebos/availability` есть, но он срабатывает по кнопке «показать», а не по выбору слота — и у Плей Парка симметричной точки нет (первый набор слотов приезжает пропсами из RSC). Симметрия воронок важнее «бесплатной» серверной точки |
| gazebos | `submitted` | **сервер** | `src/app/api/gazebos/book/route.ts`, рядом с `trackServerGoal` | уже работающая точка конверсии (AC-1.1) |
| gazebos | `paid` | **сервер** | `src/modules/payments/service.ts` → `markSucceeded()`, после транзакции | единственное место перехода в `SUCCEEDED` (вебхук + reconcile) |
| ps-park | `view` | **сервер (RSC)** | `src/app/(public)/ps-park/page.tsx`, `after(...)` | то же |
| ps-park | `slot_selected` | **клиент, sendBeacon** | `src/components/public/ps-park/dark-availability-grid.tsx` → `toggleSlot()` | начальный набор слотов приходит пропсами, `/api/ps-park/availability` дёргается только при смене даты — серверной точки «выбрал слот» нет |
| ps-park | `submitted` | **сервер** | `src/app/api/ps-park/book/route.ts`, рядом с `trackServerGoal` | AC-1.1 |
| ps-park | `paid` | **сервер** | `markSucceeded()` | то же |
| cafe | `view` | **сервер (RSC)** | `src/app/(public)/cafe/page.tsx`, `after(...)` | просмотр меню = рендер страницы (в т.ч. по QR) |
| cafe | `cart_item_added` | **клиент, sendBeacon** | `src/components/public/cafe/menu-list.tsx` → `addToCart()`, один раз за сессию (там уже есть флаг `startGoalFired`) | корзина — чистое состояние браузера, серверного следа нет по определению |
| cafe | `submitted` | **сервер** | `src/app/api/cafe/checkout/route.ts`, рядом с `trackServerGoal` | AC-1.1 |
| cafe | `paid` | **сервер** | `markSucceeded()` (`PaymentSubjectType.ORDER`) | то же |
| rental | `view` | **сервер (RSC)** | `src/app/(public)/rental/page.tsx`, `after(...)` | AC-1.4 |
| rental | `form_started` *(опц.)* | **клиент, sendBeacon** | `src/components/public/rental/inquiry-form.tsx`, первый фокус в поле (рядом с существующим `reachGoal("office_inquiry_start")`) | прямая реализация рекомендации `docs/analytics/2026-04-29-metrika-tracking-gap.md` §5.4; **сверх AC-1.4** — стоит один вызов в уже правящемся компоненте, даёт сигнал «бросил форму». Если ревью сочтёт лишним — выбрасывается удалением одной строки и одного шага в каталоге |
| rental | `submitted` | **сервер** | `src/app/api/rental/inquiries/route.ts`, рядом с `trackServerGoal` | AC-1.1 |

### 5.3 Правила серверной фиксации `view` (RSC)

- Вызов — через `after()` из `next/server` (Next 16), то есть **после** отдачи
  ответа: рендер страницы не ждёт ни Redis, ни БД.
- Не пишем, если запрос — префетч роутера (`next-router-prefetch` / `purpose:
  prefetch` / `x-purpose: preview`): это не просмотр.
- Не пишем, если user-agent похож на бота: `/(bot|crawl|spider|slurp|headless|
  curl|wget|python-requests|monitoring|uptime|probe|facebookexternalhit)/i`
  (без голого `yandex` — так под фильтр попадёт `YandexBot`, но не Яндекс.Браузер).
- Дедуп: `view` пишется не чаще одного раза на `sessionKey` в 30 минут
  (см. §5.5) — перезагрузка страницы не накручивает верх воронки.

### 5.4 Правила шага `paid`

- Вызывается из `markSucceeded()` **после** `$transaction` (рядом с
  `enqueueNotification`) — внутрь транзакции ничего не добавляем.
- Воронка определяется по `payment.moduleSlug` (`gazebos`/`ps-park`/`cafe`);
  любой другой слаг или `subjectType: SUBSCRIPTION` — тихо пропускаем.
- `sessionKey` **наследуется**: ищем последний `ProductEvent` с
  `entityId = payment.subjectId`, `step = "submitted"` за последние 7 дней и
  берём его `sessionKey`.
- Если такого события нет — `paid` **не пишем**. Это отсекает админские брони с
  ручной ссылкой на оплату (у них нет онлайн-пути) и не даёт получить
  `paid > submitted`. Цена: при сбое записи `submitted` теряется и `paid` —
  принято осознанно.

### 5.5 Дедупликация (Redis)

Ключ `product-event:dedup:{sessionKey}:{funnel}:{step}`, `SET NX EX`, TTL из
каталога (`view`, `slot_selected`, `cart_item_added`, `form_started` — 1800 с;
`submitted` и `paid` — **без дедупа**: две брони в одной сессии это два реальных
события). Redis недоступен → пишем без дедупа (fail-open, как в `rate-limit.ts`):
дубликаты верхних шагов терпимы, отчёт всё равно считает и уникальные
`sessionKey`.

---

## 6. API-контракты

### 6.1 Публичный ingest (только для клиентских шагов)

```
POST /api/analytics/events
Auth: НЕТ (анонимные посетители) — добавить путь в isPublicPostRoute
      (src/lib/auth.config.ts) + в allowlist-тест src/lib/__tests__/auth.config.test.ts
Rate limit: новый статический тир "product-event" = 60 req / 60 s на доверенный IP
            (src/lib/rate-limit.ts STATIC_CONFIGS)

Request (application/json, тело шлётся navigator.sendBeacon):
{ "funnel": "cafe", "step": "cart_item_added" }

Response 200: { "success": true, "data": { "accepted": true } }
Response 422: { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
Response 429: { "success": false, "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "..." } }
```

Zod (`src/modules/analytics/validation.ts`):

```ts
export const productEventIngestSchema = z
  .object({
    funnel: z.enum(FUNNEL_KEYS),        // из каталога funnels.ts
    step: z.enum(CLIENT_STEP_KEYS),     // ТОЛЬКО шаги с clientRecordable: true
  })
  .strict()                              // лишние поля → 422
  .refine(({ funnel, step }) => isClientRecordable(funnel, step), {
    message: "Шаг не принимается от клиента",
  });
```

Защита от накрутки и от PII (обязательные свойства реализации):

1. **Серверные шаги через этот эндпоинт не принимаются** — `submitted`/`paid`
   отсутствуют в `CLIENT_STEP_KEYS`, поэтому подделать конверсию нельзя;
   максимум, что даёт злоупотребление, — шум в верхних шагах.
2. `sessionKey` **всегда** вычисляется на сервере из заголовков запроса;
   клиент не может ни прислать его, ни выдать себя за другую сессию.
3. `metadata` от клиента **не принимается вообще** (`.strict()`): свободных
   строк в теле нет → PII физически некуда просочиться (AC-1.5).
4. Rate limit + дедуп (§5.5) ограничивают и флуд, и повтор одного шага.
5. CORS не добавляем — эндпоинт остаётся same-origin.
6. Тело не интерпретируется (никаких URL/путей/SQL-строк) — SSRF/инъекции
   неприменимы.

Роут (по конвенции CLAUDE.md): парсит, зовёт сервис, возвращает ответ.
`await recordFunnelStepAsync(...)` здесь допустим (это и есть вся работа
запроса), функция по контракту не бросает.

**Риск имени пути.** `/api/analytics/…` теоретически может попасть под
эвристику блокировщика. Смягчение уже заложено: все решающие шаги (`submitted`,
`paid`) и весь верх воронки (`view`) пишутся сервером, поэтому даже полностью
заблокированный бикон не обнуляет воронку — теряется только промежуточный
интент. Если после раскатки окажется, что `slot_selected`/`cart_item_added`
≈ 0 при живых `view`/`submitted` — заводится отдельная задача на переименование
пути (правка в одном хелпере + allowlist).

### 6.2 Админское чтение (AC-1.7)

```
GET /api/analytics/funnel?funnel=gazebos&dateFrom=2026-09-08&dateTo=2026-09-14
Auth: requireAdminSection(session, "analytics")
      → SUPERADMIN/ADMIN: полный доступ (раздел не strict-access);
        MANAGER: только при явном AdminPermission на раздел "analytics";
        USER/аноним: 403/401. hasModuleAccess по модулям воронок НЕ требуется —
        данные агрегированные и обезличенные, владелец раздела один.
Rate limit: нет (админский тир, CLAUDE.md)
Validation: funnelStatsQuerySchema — funnel? ∈ FUNNEL_KEYS, dateFrom/dateTo
            /^\d{4}-\d{2}-\d{2}$/, dateFrom <= dateTo, не в будущем, период <= 180 дней

Response 200:
{
  "success": true,
  "data": {
    "period": { "dateFrom": "2026-09-08", "dateTo": "2026-09-14" },
    "funnels": [{
      "funnel": "gazebos",
      "steps": [
        { "step": "view", "label": "Просмотр страницы", "events": 412, "sessions": 300,
          "conversionFromPrev": null, "conversionFromTop": 100 },
        { "step": "slot_selected", "label": "Выбрал слот", "events": 96, "sessions": 74,
          "conversionFromPrev": 24.7, "conversionFromTop": 24.7 }
      ],
      "biggestDropStep": "slot_selected"
    }]
  }
}
```

Сервис: `getFunnelStats({ funnel?, dateFrom, dateTo })` — один
`$queryRaw` c `COUNT(*)` и `COUNT(DISTINCT "sessionKey")` с `GROUP BY funnel,
step` (Prisma умеет distinct-count только через raw). Параметры передаются
**только** через `Prisma.sql`-плейсхолдеры, значения предварительно сверены с
каталогом — конкатенации строк в SQL нет.

Этот эндпоинт — сервисная функция для US-2: недельный отчёт вызывает
`getFunnelStats()` напрямую из скрипта, эндпоинт нужен для ручной проверки и
будущего дашборда. Отдельного `health` не добавляем — `/api/analytics/health`
уже есть.

---

## 7. AC-1.6: сбой записи не блокирует бизнес-операцию

Контракт сервиса (`src/modules/analytics/product-events.ts`), повторяющий уже
принятый в проекте паттерн `trackServerGoal`:

```ts
/** Fire-and-forget. Возвращается синхронно, НИКОГДА не бросает. */
export function recordFunnelStep(input: RecordFunnelStepInput): void;

/** Та же логика, но промис; резолвится всегда, не реджектится. */
export async function recordFunnelStepAsync(input: RecordFunnelStepInput): Promise<void>;
```

Как это обеспечивается:

1. `recordFunnelStep` внутри делает `void recordFunnelStepAsync(input)` —
   вызывающий код не получает промис, `await` поставить некуда (в ревью
   `await recordFunnelStep(...)` = ошибка: типизация `void` это ловит).
2. Всё тело `recordFunnelStepAsync` обёрнуто в `try/catch`; ошибка Redis/БД
   логируется **семплированно** (не чаще 1 записи в минуту на процесс, как
   `log429Sampled`) через `log.warn(EVENT_SOURCES.ANALYTICS_PRODUCT_EVENT, ...)`,
   который сам не бросает (console-fallback при мёртвой БД).
3. В бизнес-роутах вызов ставится **рядом с существующим `trackServerGoal`,
   после успешной бизнес-операции и до `return apiResponse(...)`** — то есть
   в уже проверенном месте, с той же семантикой.
4. В RSC-страницах вызов идёт через `after()` — выполняется после отдачи
   ответа, рендер не ждёт.
5. В `markSucceeded()` вызов стоит **после** `$transaction`: транзакция платежа
   не удлиняется и не может откатиться из-за аналитики.
6. Timeout-бюджет не нужен: обе операции локальные (Redis/Postgres в docker-сети),
   и они уже вне критического пути ответа.

Тест, фиксирующий AC-1.6: мок `prisma.productEvent.create` реджектится →
хендлер бронирования всё равно отвечает `201` и `recordFunnelStep` не бросает.

---

## 8. Влияние на существующие модули

| Файл | Изменение | Риск |
|------|-----------|------|
| `prisma/schema.prisma` | + модель `ProductEvent` | нет (аддитивно) |
| `prisma/migrations/20260916000000_add_product_event/` | новая миграция | нет |
| `src/modules/analytics/{funnels,product-events}.ts` | новые файлы | нет |
| `src/modules/analytics/{validation,types}.ts` | + схемы/типы | нет |
| `src/lib/rate-limit.ts` | + тир `product-event` в `STATIC_CONFIGS` | нет (аддитивно, существующие тиры не трогаем) |
| `src/lib/event-sources.ts` | + `ANALYTICS_PRODUCT_EVENT: "analytics.product-event"` | нет |
| `src/lib/auth.config.ts` + его тест | + `/api/analytics/events` в `isPublicPostRoute` | **точечный**: новый анонимный POST — защита описана в §6.1; ревью обязано проверить, что добавлен ровно один точный путь, без префикса |
| `src/lib/funnel-beacon.ts` | новый клиентский хелпер (`sendBeacon`, fallback `fetch(..., { keepalive: true })`, защита от повторов в рамках вкладки) | нет |
| `src/app/(public)/{gazebos,ps-park,cafe,rental}/page.tsx` | + `after(() => recordFunnelStepAsync({ step: "view", ... }))` | низкий (после ответа) |
| `src/app/api/{gazebos/book,ps-park/book,cafe/checkout,rental/inquiries}/route.ts` | + 1 вызов рядом с `trackServerGoal` | низкий |
| `src/modules/payments/service.ts` (`markSucceeded`) | + 1 вызов после транзакции | низкий; правится «горячий» файл платежей — вызов обязан быть fire-and-forget и покрыт тестом «ошибка записи не ломает markSucceeded» |
| `src/components/public/{gazebos/booking-flow,ps-park/dark-availability-grid,cafe/menu-list,rental/inquiry-form}.tsx` | + 1 вызов бикона | низкий; существующие `reachGoal` **не трогаем** (PRD: клиентский трекинг Метрики остаётся как есть) |
| `CLAUDE.md` | строка модуля `analytics` в таблице модулей: добавить «+ first-party воронки (`ProductEvent`) — ADR 2026-09-16» | обязателен в том же PR (Scope guard #4) |

Новых npm-пакетов, внешних API и секретов, кроме `PRODUCT_EVENT_SALT`
(значение — только через ops-env, в репозиторий не попадает), не добавляется.

---

## 9. Риски и осознанные ограничения

1. **Промежуточные шаги — best-effort.** `view`/`submitted`/`paid` серверные и
   полные; `slot_selected`/`cart_item_added`/`form_started` клиентские, значит
   систематически недосчитываются (блокировщики, выключенный JS, уход со
   страницы до отправки). Абсолютная конверсия «view → интент» занижена;
   смещение стабильно, поэтому недельная динамика (US-2, ради чего всё) верна.
   Отчёт обязан помечать эти шаги как оценочные.
2. **CGNAT-склейка сессий** (§4) — занижает число уникальных сессий.
3. **Мультиплексирование `view`:** одна и та же страница может открываться из
   Mini App/админки — такие запросы отсекаются ботом-фильтром лишь частично.
   Если в данных появится перекос, добавляется отсечка по `Referer`
   (`/admin`, `/webapp`) — отдельной задачей, не в v1.
4. **Каталог шагов в коде, не в БД** — переименование шага делает старые строки
   невидимыми для отчёта. Сознательная цена за отсутствие `ALTER TYPE`-миграций.
5. **Ретенция не автоматизирована** в v1 (§3).

---

## 10. Чеклист для Developer

- [ ] `ProductEvent` в `schema.prisma` + аддитивная миграция `20260916000000_add_product_event`
- [ ] `src/modules/analytics/funnels.ts` — каталог (4 воронки, порядок шагов, подписи, `dedupeWindowSec`, `clientRecordable`)
- [ ] `src/modules/analytics/product-events.ts` — `deriveSessionKey`, `recordFunnelStep` (void), `recordFunnelStepAsync` (не реджектится), `getFunnelStats`
- [ ] `validation.ts` — `productEventIngestSchema` (`.strict()`, только клиентские шаги), `funnelStatsQuerySchema`
- [ ] `POST /api/analytics/events` + `isPublicPostRoute` + тир `product-event` в `rate-limit.ts` + правка `src/lib/__tests__/auth.config.test.ts`
- [ ] `GET /api/analytics/funnel` c `requireAdminSection(session, "analytics")`
- [ ] 4 серверных `view` через `after()`, с отсечкой префетча и ботов
- [ ] 4 серверных `submitted` рядом с `trackServerGoal`
- [ ] `paid` в `markSucceeded()` после транзакции, с наследованием `sessionKey` по `entityId`
- [ ] Клиентский `src/lib/funnel-beacon.ts` + 3 (или 4 с `form_started`) колл-сайта
- [ ] `EVENT_SOURCES.ANALYTICS_PRODUCT_EVENT`, `PRODUCT_EVENT_SALT` в `.env.example` + ops-env
- [ ] Тесты: каталог; `deriveSessionKey` (стабильность в пределах дня, отсутствие сырого IP/UA в результате, разные соли → разные ключи); `recordFunnelStepAsync` не бросает при падении Redis и Prisma; дедуп срабатывает/не срабатывает по каталогу; `getFunnelStats` (конверсии, пустой период); ingest-роут (happy path, серверный шаг → 422, лишнее поле → 422, 429); по одному route-тесту «ошибка записи не ломает ответ» на бронирование и на `markSucceeded`
- [ ] Синк `CLAUDE.md` в том же PR

## 11. Трассировка AC → решение

| AC | Где закрыт |
|----|-----------|
| AC-1.1 | §5.2, строки `submitted` (4 существующих колл-сайта `trackServerGoal`) |
| AC-1.2 | §5.2, воронки `gazebos`/`ps-park` (view → slot_selected → submitted → paid) |
| AC-1.3 | §5.2, воронка `cafe` (view → cart_item_added → submitted → paid) |
| AC-1.4 | §5.2, воронка `rental` (view → submitted, без оплаты) |
| AC-1.5 | §3 (никаких PII-колонок), §4 (солёный хэш), §6.1 п.3 (клиентская metadata не принимается) |
| AC-1.6 | §7 целиком |
| AC-1.7 | §3 (индекс `funnel, step, createdAt`), §6.2 (`getFunnelStats`) |

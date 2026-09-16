# Review: first-party funnel events (ProductEvent) — issue #725, PR #896

## Вердикт: PASS

## Артефакты, использованные для проверки
- ADR: `docs/adr/2026-09-16-product-event-funnel-instrumentation.md`
- PRD: `docs/requirements/2026-08-21-product-loop-prd.md` (AC-1.1–AC-1.7)
- Ветка: `claude/issue-725-product-event-funnels` (commit `7c7a9bc`) против `origin/main`
- `npm test -- --run`: **332 файла / 4639 тестов — все зелёные**

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1.1 (4 существующих ключевых события фиксируются сервером) | PASS | `submitted` пишется рядом с уже работающим `trackServerGoal` в `gazebos/book`, `ps-park/book`, `cafe/checkout`, `rental/inquiries`; `paid` пишется в `payments/service.ts::markSucceeded()` после `$transaction`. Проверено кодом и тестами (`payments/__tests__/service.test.ts`). |
| AC-1.2 (беседки/Плей Парк: view → slot_selected → submitted → paid) | PASS | Каталог `funnels.ts` содержит ровно эти 4 шага для обеих воронок; `view` — серверный RSC (`after()`), `slot_selected` — клиентский бикон из `booking-flow.tsx`/`dark-availability-grid.tsx`, один раз за визит (`useRef`-флаг). |
| AC-1.3 (кафе: view меню → cart_item_added → submitted → paid) | PASS | Реализовано аналогично, `menu-list.tsx` шлёт бикон на первое добавление в корзину. |
| AC-1.4 (аренда: view → submitted, без оплаты) | PASS | В каталоге `rental` нет шага `paid`; `recordPaidStep` тихо игнорирует `funnel="rental"` (тест это подтверждает). Доп. шаг `form_started` — явно помечен в ADR §5.2 как «сверх AC-1.4», обоснован ссылкой на существующую рекомендацию (`docs/analytics/2026-04-29-metrika-tracking-gap.md` §5.4) и снабжён путём отката «одна строка» — не считаю это неконтролируемым scope creep, т.к. решение зафиксировано и обосновано в самом ADR этого же рана, а не тайно добавлено разработчиком. |
| AC-1.5 (нет PII, только обезличенный sessionKey) | PASS | См. раздел Security ниже — отдельная проверка sessionKey/metadata. |
| AC-1.6 (сбой записи не блокирует бизнес-операцию) | PASS | `recordFunnelStep`/`recordFunnelStepAsync`/`recordPaidStep` полностью обёрнуты в try/catch, включая путь логирования ошибки (`getSalt()` → `log.warn` — обёрнут в try/catch, `logRecordFailureSampled` → `log.warn` — тоже обёрнут). Проверено тестами: `product-events.test.ts` (create/findFirst реджектятся → resolves.toBeUndefined()), route-тесты для gazebos/book, cafe/checkout, ps-park/book, rental/inquiries (`mockProductEventCreate` реджектится по умолчанию в `beforeEach` — весь happy-path прогоняется через реальный сбойный путь и роут всё равно отвечает 200/201), `payments/__tests__/service.test.ts` — новый тест «сбой записи шага paid не ломает подтверждение брони и уведомление». |
| AC-1.7 (выборка по воронке/шагу/периоду) | PASS | `GET /api/analytics/funnel` + `getFunnelStats()` — один `$queryRaw` с параметризацией через `Prisma.sql`-плейсхолдеры (нет конкатенации строк), индекс `[funnel, step, createdAt]` покрывает паттерн запроса. Тесты покрывают конверсии, пустой период, свод по всем воронкам. |

---

## Scope Check
- Scope creep: **Нет.**
- Новый модуль `src/modules/{slug}/` не создан — все новые файлы лежат внутри существующего `src/modules/analytics/` (`funnels.ts`, `product-events.ts`, дополнения `validation.ts`/`types.ts`), в точности как решено в ADR §2.
- `CLAUDE.md` синхронизирован в этом же PR (строка модуля `analytics` дополнена упоминанием `ProductEvent` и ссылкой на ADR).
- `.env.example` синхронизирован (`PRODUCT_EVENT_SALT` с комментарием и инструкцией генерации).
- Issue #726 (недельный product-analyst отчёт) и #590 (миграционный дрейф) не затронуты — сервис `getFunnelStats()` существует как переиспользуемая функция для будущего US-2, но сам отчёт не реализован в этом PR — соответствует границе задачи.
- Единственный самостоятельно оговорённый в ADR выход за буквальный текст AC-1.4 — шаг `form_started` — задокументирован, обоснован и легко откатываем; не прячется под видом чего-то другого.

## Архитектура
- Бизнес-логика — в `src/modules/analytics/product-events.ts` (сервис), route handlers только парсят/валидируют/вызывают сервис/отвечают (`src/app/api/analytics/events/route.ts`, `.../funnel/route.ts`) — соответствует конвенции.
- Схема `ProductEvent` в `prisma/schema.prisma` совпадает с ADR §3 один в один (поля, индексы, комментарии о PII).
- Миграция `prisma/migrations/20260916050324_add_product_event/migration.sql` содержит **только** `CREATE TABLE "ProductEvent"` + 3 `CREATE INDEX` — никакого постороннего дрейфа, полностью аддитивна, откат — `DROP TABLE`.
- API-контракты (`POST /api/analytics/events`, `GET /api/analytics/funnel`) соответствуют §6 ADR: пути, коды ответов, форма запроса/ответа.

## Качество кода
- TypeScript strict: OK, `any` не встречается в новых файлах.
- Zod валидация: OK — `productEventIngestSchema` (`.strict()` + `.refine()` на `clientRecordable`), `funnelStatsQuerySchema` (формат даты, `dateFrom <= dateTo`, не в будущем, период ≤ 180 дней).
- API формат: OK — `apiResponse()`/`apiError()`/`apiValidationError()`/`apiServerError()` используются последовательно, `GET /api/analytics/funnel` не протекает деталями ошибки наружу (`catch { return apiServerError(); }`).
- Тесты: OK — 3 новых test-файла в `src/modules/analytics/__tests__/` (funnels, product-events, validation) + route-тесты для обоих новых эндпоинтов + обновлены route-тесты 4 бизнес-эндпоинтов + `payments/__tests__/service.test.ts`. Полный прогон `npm test -- --run` зелёный (4639/4639).

## Безопасность

### PII / sessionKey (AC-1.5)
- `sessionKey` вычисляется **только на сервере** (`deriveSessionKeyFromHeaders`) из `sha256(salt|ip|userAgent|moscowDate).slice(0,32)` — необратимый хэш, длина/формат проверены тестом (`toMatch(/^[0-9a-f]{32}$/)`), сырые IP/UA явно проверены на отсутствие в результате (`not.toContain("203.0.113.7")`, `not.toContain("Mozilla")`).
- `metadata` со стороны клиента **не принимается вообще** — `productEventIngestSchema` объявлена `.strict()` без поля `metadata`, лишние поля → 422 (подтверждено тестом «игнорирует sessionKey и metadata, присланные клиентом»).
- `metadata` со стороны сервера (только 2 колл-сайта: `cafe/checkout` через… нет, только `payments/service.ts` передаёт `{ amountRub }`) проходит через `sanitizeMetadata()` с allowlist `["amountRub", "slotCount", "itemCount", "currency"]`, только примитивы `string|number|boolean`; тест подтверждает, что `guestEmail`/вложенные объекты отфильтровываются, а пустой результат превращается в `undefined`, а не `{}`.
- Публичный ingest не может форсировать серверные шаги: `submitted`/`paid` отсутствуют среди `clientRecordable`, схема их отклоняет через `.refine()` — подтверждено тестом (422, `recordFunnelStepAsync` не вызывается).

### Анти-фрод периметр публичного ingest (`POST /api/analytics/events`)
- Клиент не может подделать `sessionKey` (сервер игнорирует любое поле `sessionKey` в теле благодаря `.strict()` — лишнее поле роняет всю валидацию в 422, что даже строже, чем «тихо отбросить»).
- Rate limit `product-event` = 60/мин на доверенный IP (Redis sliding window, тир зарегистрирован в `STATIC_CONFIGS`).
- Путь добавлен в `isPublicPostRoute` **точным совпадением** (`pathname === "/api/analytics/events"`), не префиксом — соответствует явному требованию ADR §8; allowlist-тест обновлён (`auth.config.test.ts`, включая проверку, что GET на тот же путь **не** публичен).

### RBAC на `GET /api/analytics/funnel`
- `requireAdminSection(session, "analytics")` вызывается ДО обращения к сервису; `USER`/аноним получают 401/403 (проверено тестом, сервис не вызывается). Обоснование в ADR, почему не нужен доп. `hasModuleAccess` по модулям воронок (данные агрегированы и обезличены, владелец раздела один) — принято, соответствует существующей практике раздела `analytics`.

### Fire-and-forget гарантия (весь файл `product-events.ts` + вызовы)
- `recordFunnelStepAsync` — весь блок обёрнут в try/catch, ошибка идёт в `logRecordFailureSampled`, которая семплирует (1/мин) и логирует через `console.error` + `log.warn`, **сама обёрнутая в try/catch** — не может пробросить исключение дальше по цепочке (это и была ранее найденная в этой сессии проблема с `getSalt()`, она исправлена; при повторной проверке других мест в файле такого же незащищённого throw-пути не найдено).
- `recordPaidStep` — аналогично полностью в try/catch.
- Redis-дедуп (`isDuplicate`) — fail-open по паттерну `rate-limit.ts` (ошибка Redis → `return false`, событие всё равно пишется).
- Все 4 бизнес-роута вызывают `recordFunnelStep` (не `await`, синхронный `void`) сразу после успешной операции, до `return apiResponse(...)` — при падении записи ответ всё равно 201 (подтверждено тестами с `mockProductEventCreate` реджектящимся по умолчанию).
- `markSucceeded()` вызывает `void recordPaidStep(...)` после `$transaction`, не внутри неё — транзакция платежа не может откатиться из-за аналитики (подтверждено новым тестом в `payments/__tests__/service.test.ts`).
- **Минорное наблюдение (не блокирует):** `deriveSessionKeyFromHeaders(...)` вызывается синхронно в теле обработчиков API-роутов (`gazebos/book`, `ps-park/book`, `cafe/checkout`, `rental/inquiries`) вне try/catch самого `product-events.ts` — формально это чистая локальная операция (хэш строки, без сети/БД), поэтому AC-1.6 («сбой сети/БД») её не касается по духу, и место вызова буквально совпадает с уже существующим `trackServerGoal(...)` (тот же файл, та же незащищённость, тот же принятый в проекте паттерн). Блокирующим замечанием не считаю, но если Developer хочет подстраховаться на будущее — можно обернуть тело `deriveSessionKeyFromHeaders` в try/catch с фолбэком на `sessionKey: null`, по аналогии с защитой `getSalt()`.

### Supply chain
- Новых npm-зависимостей нет (`package.json`/`package-lock.json` не изменены).

### Injection
- `getFunnelStats()` использует `prisma.$queryRaw` с template-literal — Prisma сериализует интерполированные значения (`${from}`, `${to}`, `${params.funnel}`) как параметризованные плейсхолдеры, а не конкатенацию строк; `params.funnel` дополнительно ограничен Zod-enum'ом до вызова сервиса. Конкатенации SQL-строк нет.
- Нет `dangerouslySetInnerHTML`, нет рендеринга пользовательского ввода как HTML в затронутых файлах.

### Secrets leakage
- `grep -riE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по полному диффу — единственное совпадение относится к уже существующему (не новому) тесту редактирования `manageToken` в ответе брони, не имеет отношения к этому PR по существу и подтверждает корректное поведение (токен НЕ попадает в ответ).
- `PRODUCT_EVENT_SALT` — только имя переменной и placeholder `""` в `.env.example`, значение не закоммичено.

**Итог по Security: инцидентов не найдено.**

## Что исправить
Блокирующих замечаний нет. Опционально (не требуется для PASS): обернуть `deriveSessionKeyFromHeaders` защитным try/catch на случай будущих правок (см. минорное наблюдение выше).

## Что хорошо
- Реализация практически дословно повторяет ADR — редкий случай, когда каждое архитектурное решение (схема, дом данных, sessionKey, дедуп, anti-fraud периметр, fire-and-forget) прослеживается 1:1 в коде.
- Тесты не просто «зелёные», а реально бьют по замеченным ранее в этой же сессии рискам (сбойный `log.warn` внутри `getSalt()`, сбой записи `paid` в вебхуке ЮKassa) — `beforeEach` в route-тестах даже намеренно держит мок `productEvent.create` реджектящимся по умолчанию, так что happy-path тесты сами по себе доказывают fire-and-forget гарантию, а не полагаются на отдельный "special case" тест.
- Явная фиксация в ADR/коде границы «что сверх PRD и почему» (`form_started`) — образцовая практика для избежания споров о scope creep постфактум.

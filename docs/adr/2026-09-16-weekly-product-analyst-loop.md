# ADR: Недельный product-analyst — отчёт по воронке, гипотезы-задачи и блок в вечерней сводке

**Дата:** 2026-09-16 · **Статус:** предложено · **Issue:** #726 (US-2 + US-3 эпика #583)
**PRD:** `docs/requirements/2026-08-21-product-loop-prd.md`
**Зависит от:** #725 / ADR `docs/adr/2026-09-16-product-event-funnel-instrumentation.md` (таблица `ProductEvent`, каталог `funnels.ts`, `getFunnelStats()`)
**Закрывает открытые вопросы PRD:** №2 (машиночитаемая метка гипотезы) и №5 (расписание Routine + как дайджест узнаёт о свежем отчёте)
**Вне скоупа этого ADR:** US-4 (дневной детектор обвала) — отдельная задача 3 декомпозиции PRD.

---

## 1. Контекст

После #725 в БД копятся first-party события воронки, и `getFunnelStats({funnel?,
dateFrom, dateTo})` уже считает по каждой из 4 воронок число событий, уникальных
сессий, `conversionFromPrev`, `conversionFromTop` и `biggestDropStep`. Данные
есть — петли нет: никто их регулярно не смотрит, гипотез из них не рождается, а
владелец, который единственный может дать ход продуктовому изменению, не
открывает GitHub и файлы репозитория (ADR `2026-08-20-owner-out-of-github`).

US-2 требует: раз в неделю — отчёт с конверсией по шагам, изменением к прошлой
неделе, явным указанием шага с наибольшим оттоком, сверкой с релизами недели, не
больше 3 гипотез (каждая — с baseline), честным «данных мало» вместо выдумок и
без PII. Каждая гипотеза становится задачей, которая **не уходит в работу сама**.
US-3 требует: в день выхода отчёта вечерняя сводка владельца содержит краткую
выжимку и список гипотез, ждущих его решения; в остальные дни блока нет.

Жёсткие рамки: нового модуля `src/modules/{slug}/` не создаём (Scope guard #1 и
рамка эпика) — всё, что относится к аналитике, живёт в `src/modules/analytics/`;
новую инфраструктуру автоматизации не изобретаем — переиспользуем Routine,
`issue-queue.ts`, `owner-digest.yml` и SSH-psql-дамп.

Что проверено по коду перед решением:

- `src/modules/analytics/product-events.ts` — `getFunnelStats()` делает один
  `$queryRaw` (`COUNT(*)`, `COUNT(DISTINCT "sessionKey")`, `GROUP BY funnel,
  step`) и потом считает конверсии в TypeScript; `FunnelStatsData` описан в
  `types.ts`; каталог шагов — `funnels.ts` (чистый, без БД).
- `scripts/lib/owner-digest.ts` — чистая `buildOwnerDigest(input): string`,
  тесты в `scripts/lib/__tests__/owner-digest.test.ts`; сбор данных —
  `scripts/owner-digest.ts` (merged PR за 24 ч, дельта бэклога, решения с
  сайта, фидбек из файла); отправка — отдельный шаг `owner-digest.yml`
  (cron `0 18 * * *` = 21:00 МСК). Все секции уже работают в окне «за сутки».
- `.github/workflows/backlog-intake.yml` — эталон «данные прода → раннер»:
  прод-Postgres раннерам недоступен, дамп приезжает `ssh → docker exec
  delovoy-postgres psql -Atc`, дальше детерминированный скрипт без AI.
- `deploy.yml` пишет repo variable (`gh variable set DEPLOYED_SHA_CURRENT` под
  `secrets.GITHUB_TOKEN`), `owner-digest.ts` её читает — готовый, проверенный
  канал «workflow → переменная → потребитель».
- `scripts/lib/issue-queue.ts` — `laneOf()` (лейбл → lane), `isUntriaged()`
  (lane === 'untriaged' + исключения), `isEligible()` (lane === 'ready'),
  `assertClaimable()`, `snapshot().byLane`. Лейбл `auto:blocked` **сам по себе**
  порождает Telegram-кнопки владельцу (`decisions-sync`, шаг A2) — это важно
  ниже. `scripts/issue-queue.ts create` умеет `--label X` и без `--ready/--epic`
  создаёт issue вообще без `auto:*`, но такая issue попадает в `untriaged` и
  будет триажирована следующей сессией.
- `classifyMergeGate()` требует маркеры обоих ревью-агентов на **любом** PR;
  `HOLD_PATTERNS` включает `scripts/lib/issue-queue.ts`, `scripts/issue-queue.ts`
  и `.claude/commands/next-issue.md`.
- `autoMergeSkipReason()` мержит любой PR ветки `claude/**`, даже если он не
  закрывает issue очереди (сирота) — свипер доведёт недельный PR до мержа, даже
  если сессия умрёт сразу после открытия PR.
- `scripts/seeds/legal.ts` импортирует функцию из `src/modules/...` по
  относительному пути — прецедент «скрипт использует доменный код» есть.

---

## 2. Обзор решения

```
  пн 08:40 МСК   analytics-funnel-export.yml (cron, без AI)
                 ssh → psql: агрегаты ProductEvent за 2 закрытые недели (по дням)
                 → repo variable FUNNEL_WEEKLY_STATS  (~1–15 КБ, только счётчики)
                          │
  пн 09:00 МСК   Routine «Product Analyst: недельный отчёт по воронке»
                 → сессия → .claude/commands/weekly-funnel.md
                          │
                 scripts/funnel-weekly.ts stats   (читает переменную; протухла — дёргает workflow и ждёт)
                 scripts/funnel-weekly.ts build   (buildWeeklyFunnelReport → .md + .json сайдкар)
                 субагент product-analyst          (интерпретация + ≤3 гипотезы)
                 scripts/funnel-weekly.ts hypothesis ×N  (issue с auto:hypothesis + baseline из сайдкара)
                 PR claude/weekly-funnel-<дата> → вердикты → мерж (или свипер)
                          │
  пн 21:00 МСК   owner-digest.yml → scripts/owner-digest.ts
                 видит сайдкар, доехавший в main за последние 24 ч → блок в сводке
```

Три решения, которые нужно принять и обосновать: **(A)** кто считает числа и кто
пишет текст, **(B)** как данные прода доезжают до сессии, **(C)** как гипотеза
машинно отличается от обычной задачи, **(D)** как вечерний job узнаёт «сегодня
вышел отчёт». Ниже — по порядку.

---

## 3. Решение A — числа считает код, текст пишет агент

### Варианты

**A1. Отчёт целиком пишет агент** (читает `getFunnelStats`, сам считает дельты,
сам верстает markdown). Плюс: ноль нового кода. Минусы: арифметика конверсий и
дельт становится недетерминированной — два прогона дадут разные цифры при тех же
данных; проверить отчёт тестами невозможно; правило «baseline обязателен» и порог
«данных мало» остаются пожеланием промпта; дайджест не из чего строить (нечего
парсить). Отвергнуто.

**A2. Отчёт целиком генерирует скрипт**, агента нет вообще. Плюс: полностью
детерминированно. Минус: US-2 требует не таблицу, а суждение — где отток, связано
ли падение с релизом недели, какие 3 вещи стоит попробовать. Детерминированный
генератор гипотез — это либо шаблонный шум («конверсия упала, сделайте лучше»),
либо экспертная система, которой у нас нет. Отвергнуто.

**A3. Гибрид с жёсткой границей. ВЫБРАНО.** Все числа, дельты, вердикт
«достаточно ли данных», список релизов недели и весь сайдкар — чистая функция
`buildWeeklyFunnelReport()`; агент дописывает **только прозу** в два раздела с
фиксированными заголовками («Интерпретация», текст гипотез) и регистрирует
гипотезы через CLI, который сам подставляет baseline из сайдкара и сам отказывает,
если гипотез уже 3 или по воронке мало данных.

Граница проверяема: любой числовой факт в отчёте либо выведен функцией, покрытой
тестами, либо его там нет. Агент физически не может опубликовать гипотезу без
baseline — baseline подставляет не он.

### Где живёт код (без нового модуля)

```
src/modules/analytics/
├── funnel-stats.ts       # НОВЫЙ: чистая математика воронки (без БД)
│                         #   aggregateFunnelStats(rows, period, funnel?) → FunnelStatsData
├── product-events.ts     # getFunnelStats() теперь = $queryRaw + aggregateFunnelStats()
├── weekly-report.ts      # НОВЫЙ: buildWeeklyFunnelReport / сайдкар / парсер / freshness /
│                         #        шаблон тела гипотезы / PII-guard  — всё чистое, без БД
├── types.ts              # + типы сайдкара и недельной сводки
└── __tests__/funnel-stats.test.ts, __tests__/weekly-report.test.ts

scripts/funnel-weekly.ts        # тонкий CLI: stats | build | hypothesis | pr
scripts/lib/owner-digest.ts     # + рендер блока воронки (чистая функция, как и всё в файле)
scripts/owner-digest.ts         # + сбор «есть ли свежий отчёт»
.github/workflows/analytics-funnel-export.yml   # НОВЫЙ: ssh→psql→repo variable
.claude/commands/weekly-funnel.md               # НОВЫЙ: программа недельной сессии
```

**Почему `funnel-stats.ts` отделяется от `product-events.ts`.** Отчёт строится в
скрипте (`tsx`), а `product-events.ts` тянет `@/lib/db`, `@/lib/redis`,
`@/lib/logger` — в CLI это лишний граф модулей и требование живых env. Математика
конверсий при этом нужна обоим. Выносим её в файл без единого импорта из
`src/lib/`: `product-events.ts` импортирует `aggregateFunnelStats` и делегирует
(поведение `getFunnelStats` и его тесты не меняются), `weekly-report.ts`
импортирует её же и считает по данным из дампа. Одна реализация математики,
ни одного шанса на расхождение «эндпоинт показывает одно, отчёт другое».

```ts
// src/modules/analytics/funnel-stats.ts
export type FunnelStatsRow = { funnel: string; step: string; events: number; sessions: number };

/** Чистая: те же conversionFromPrev/FromTop/biggestDropStep, что были в getFunnelStats. */
export function aggregateFunnelStats(
  rows: FunnelStatsRow[],
  period: { dateFrom: string; dateTo: string },
  funnel?: FunnelKey,
): FunnelStatsData;
```

---

## 4. Решение B — как агрегаты прода доезжают до недельной сессии

Сессия Claude Code не держит ни VPS-секретов, ни доступа к прод-Postgres: её
единственный внешний канал — GitHub API через agent-proxy (`scripts/lib/gh-api.ts`).

### Варианты

**B1. Сессия сама ходит в прод** (SSH или новый эндпоинт с shared secret). Требует
выдать сессии секрет прода или завести новый публичный секретный эндпоинт с
данными. Дороже по риску, чем вся задача. Отвергнуто.

**B2. Экспорт-workflow кладёт JSON артефактом**, сессия скачивает. Минус: скачивание
артефакта — редирект на blob-URL + распаковка zip через agent-proxy; хрупкий путь,
прецедента в репозитории нет. Отвергнуто.

**B3. Экспорт-workflow коммитит агрегаты в репозиторий.** Ни один workflow здесь не
пушит в `main` (проверено), а пуш веткой породил бы второй PR в неделю ради данных,
которые через неделю не нужны. Отвергнуто.

**B4. Экспорт-workflow пишет repo variable, сессия читает её по API. ВЫБРАНО.**
Точно тот же канал, которым уже пользуются `deploy.yml` (пишет
`DEPLOYED_SHA_CURRENT` под `secrets.GITHUB_TOKEN`) и `owner-digest.ts` (читает).
Полезная нагрузка — сотни строк вида `{funnel, step, day, events, sessions}`,
единицы килобайт при лимите 48 КБ на переменную. Ни одного нового секрета, ни
одного нового протокола.

### `.github/workflows/analytics-funnel-export.yml`

```yaml
on:
  schedule:
    - cron: "40 5 * * 1"   # 08:40 МСК, понедельник — за 20 минут до Routine
  workflow_dispatch:        # сессия может дёрнуть руками, если переменная протухла
permissions:
  contents: read
  actions: write            # gh variable set (тот же приём, что в deploy.yml)
```

Шаг дампа (паттерн `backlog-intake.yml`: SQL без одинарных кавычек, `$$…$$`,
`make_interval`; период — две **закрытые** недели относительно МСК):

```sql
SELECT COALESCE(json_agg(t), $$[]$$::json) FROM (
  SELECT funnel, step,
         ((("createdAt" AT TIME ZONE $$UTC$$) AT TIME ZONE $$Europe/Moscow$$)::date)::text AS day,
         COUNT(*)::int AS events,
         COUNT(DISTINCT "sessionKey")::int AS sessions
  FROM "ProductEvent"
  WHERE "createdAt" >= date_trunc($$week$$, now() AT TIME ZONE $$Europe/Moscow$$) - make_interval(days => 14)
    AND "createdAt" <  date_trunc($$week$$, now() AT TIME ZONE $$Europe/Moscow$$)
  GROUP BY 1, 2, 3
) t;
```

`sessionKey` в выборке присутствует **только** внутри `COUNT(DISTINCT …)` — ни
хэш, ни какой-либо идентификатор посетителя переменную не покидает (см. §8).

Переменная `FUNNEL_WEEKLY_STATS`:

```json
{ "schemaVersion": 1,
  "generatedAt": "2026-09-21T05:42:11.000Z",
  "periods": { "current":  { "dateFrom": "2026-09-14", "dateTo": "2026-09-20" },
               "previous": { "dateFrom": "2026-09-07", "dateTo": "2026-09-13" } },
  "rows": [ { "funnel": "gazebos", "step": "view", "day": "2026-09-14", "events": 42, "sessions": 31 } ] }
```

Дневная гранулярность (а не сразу две суммы) — чтобы отчёт сам нарезал периоды и
не ломался, если Routine отработает во вторник; плюс это задел для US-4, который
сможет читать ту же переменную. Падение экспорта — `if: failure()` → Telegram в
**админскую** группу (не владельцу): паттерн `backlog-intake.yml`, молчащий
экспорт неотличим от «данных нет».

`scripts/funnel-weekly.ts stats`: читает переменную; если её нет или
`generatedAt` старше 36 ч — `POST /actions/workflows/analytics-funnel-export.yml/
dispatches` и опрос раз в 30 с до 12 минут; успех → пишет файл и печатает путь,
неудача → exit 4 (сессия заводит задачу очереди и завершается, см. §6).

---

## 5. Решение C — машиночитаемая метка гипотезы (открытый вопрос PRD №2)

Требование AC-2.4: гипотеза становится задачей, но обычный триаж `/next-issue`
**не имеет права** сам перевести её в `auto:ready`; ход даёт только владелец.

### Варианты

**C1. Issue без `auto:*` (как сейчас делает `create` без `--ready`).** Именно так
работает `owner-idea`. Минус ровно тот, который назвал PRD: такая issue попадает
в `untriaged`, и ближайшая сессия по шагу 0 добросовестно назначит ей `prio:*` +
`auto:ready` — то есть гипотеза уедет в работу без владельца. Отвергнуто.

**C2. Лейбл `needs-owner` + договорённость в промпте.** Лейбл не влияет на
`isUntriaged()`/`isEligible()` вообще: issue всё равно в списке входящих, и
защита держится на том, что сессия прочитает текст и догадается. PRD прямо
требует машинного отличия, а не догадки. Отвергнуто.

**C3. Переиспользовать `auto:blocked`.** Семантика близка («ждёт решения
владельца»), но `decisions-sync` на каждую `auto:blocked` issue заводит запрос
решения и шлёт владельцу персональное сообщение с кнопками — а PRD явным пунктом
«Вне скоупа» запрещает кнопочный флоу одобрения гипотез. Отвергнуто.

**C4. Переиспользовать `auto:parked`.** Технически сработало бы (lane ≠ untriaged,
≠ ready, `claim` откажет), но `parked` означает «взяли и не вытянули»: гипотезы
засоряли бы дашборд и отчёт очереди ложными провалами. Отвергнуто.

**C5. Новый lane `auto:hypothesis`. ВЫБРАНО.**

```ts
// scripts/lib/issue-queue.ts
export type Lane = 'ready' | 'wip' | 'review' | 'blocked' | 'prod-apply'
                 | 'epic' | 'parked' | 'hypothesis' | 'untriaged';

export function laneOf(labels: string[]): Lane {
  …
  if (labels.includes('auto:parked')) return 'parked';
  // Гипотеза недельного аналитика: ждёт явного «делай» владельца.
  // Не входящая (триаж её не трогает) и не очередь (воркер её не берёт).
  if (labels.includes('auto:hypothesis')) return 'hypothesis';
  …
}
```

Что это даёт **без единой новой проверки**:

| Функция | Поведение с `auto:hypothesis` | Следствие |
|---------|-------------------------------|-----------|
| `isUntriaged()` | `false` (lane ≠ `untriaged`) | гипотеза не показывается в `untriaged` — шаг 0 её не видит |
| `isEligible()` | `false` (lane ≠ `ready`) | `next` её никогда не выберет |
| `assertClaimable()` | бросает «не в auto:ready (сейчас: hypothesis)» | даже прямой `claim $N` отказывает |
| `snapshot().byLane` | новая корзина `hypothesis` | видно в дашборде отдельной строкой, а не среди parked |

Плюс новая команда — единственный легальный путь «в работу»:

```
npx tsx scripts/issue-queue.ts promote <N> <P0|P1|P2|P3>
  # требует lane === 'hypothesis' (иначе ошибка);
  # снимает auto:hypothesis, ставит prio:<P> + auto:ready,
  # комментирует: «Владелец дал ход гипотезе — задача в очереди.»
```

### Правка шага 0 `.claude/commands/next-issue.md` (точная формулировка)

В блок «по каждой реши приоритет и судьбу» добавляется пункт, а после правила
гранулярности — абзац:

> - **гипотеза недельного аналитика** (лейбл `auto:hypothesis`) — в списке
>   `untriaged` её нет и быть не должно: она ждёт владельца, а не приоритета.
>   Увидел такую issue (по ссылке из другой задачи, в поиске, в теле PR) —
>   **не триажируй и не бери**. Единственный способ дать ей ход:
>   `npx tsx scripts/issue-queue.ts promote <N> <P1|P2>` — и только если
>   владелец сказал это явно (его «идея: делаем гипотезу #N» пришла отдельной
>   issue от контура owner-decisions). Тогда `promote`, а исходную
>   owner-idea issue закрой комментарием «→ #N».

Формулировка сознательно дублирует машинную защиту словами: код — источник
истины, промпт — объяснение, почему сессия не должна пытаться её обойти.

### Как владелец даёт ход (нового механизма не строим)

Владелец пишет боту «идея: делаем гипотезу #812» → контур owner-decisions заводит
обычную issue без `auto:*` → ближайший шаг 0 видит её во входящих, видит ссылку
на гипотезу, выполняет `promote 812 P2` и закрывает owner-idea issue. Ровно путь,
который PRD описывает в «Вне скоупа» («владелец даёт им ход так же, как любой
другой идее — свободным текстом боту»).

### Тело issue-гипотезы: шаблон в коде, документация в роли агента

Шаблон **нормативно живёт в коде** — `buildHypothesisIssueBody()` в
`src/modules/analytics/weekly-report.ts`; отдельного справочного документа не
заводим (лишний файл, который разъедется с кодом). В `agents/analytics.md`
добавляется короткий раздел «Недельный отчёт по воронке», который описывает
правила и ссылается на CLI — но не переписывает шаблон целиком.

```markdown
## Гипотеза недели <период>

**Воронка:** Беседки · **Шаг:** «Выбрал слот» (`gazebos/slot_selected`)

### Что предлагается изменить
<текст агента>

### Ожидаемый результат и почему
<текст агента>

### Как измеряем
Конверсия `view → slot_selected` по воронке `gazebos` (шаг `slot_selected`,
поле `conversionFromPrev` в `GET /api/analytics/funnel`), сравнение недели
после раскатки с baseline ниже. Без изменения ≥ N п.п. гипотеза считается
неподтверждённой.

### Baseline (подставлен автоматически из отчёта, не редактировать)
- Период: 2026-09-14 … 2026-09-20
- Сессий на входе воронки: 312
- Конверсия шага от предыдущего: 24.7 % (к прошлой неделе: −3.1 п.п.)
- Отчёт: `docs/analytics/2026-09-21-funnel-weekly.md`

---
Это **гипотеза**, а не задача: в работу не берётся, пока владелец не скажет
«делай». Дать ход: `npx tsx scripts/issue-queue.ts promote <N> P2`.
<!-- funnel-hypothesis: 2026-09-21 gazebos/slot_selected -->
```

Лейблы issue: `auto:hypothesis` + `from-analytics` (второй — для поиска и
статистики «сколько гипотез дошло до деплоя», метрика успеха эпика). Приоритет
**не назначается**: его выберет `promote` в момент решения владельца.

---

## 6. Артефакты недели: отчёт + сайдкар

### Файлы

```
docs/analytics/2026-09-21-funnel-weekly.md     # отчёт (для человека и истории)
docs/analytics/2026-09-21-funnel-weekly.json   # сайдкар (для дайджеста, машинный)
```

Имя фиксировано: `<дата публикации>-funnel-weekly.{md,json}` — по нему сайдкар
находится глобом без индексов и реестров. Дата публикации — понедельник выхода
отчёта; **отчётный период** — предыдущая закрытая неделя Пн–Вс (лежит внутри).

### Сайдкар (контракт с дайджестом)

```ts
// src/modules/analytics/weekly-report.ts
export const WEEKLY_SIDECAR_SCHEMA_VERSION = 1;

export type WeeklyFunnelSummary = {
  funnel: FunnelKey;
  label: string;                        // «Беседки» — из funnels.ts
  topSessions: number;                  // сессий на первом шаге за неделю
  endToEndConversion: number;           // % последнего шага от первого
  endToEndDeltaPp: number | null;       // изменение к прошлой неделе, п.п.; null — не считаем
  biggestDropStep: string | null;
  biggestDropLabel: string | null;
  biggestDropConversion: number | null; // conversionFromPrev худшего шага, %
  insufficientData: boolean;            // по этой воронке выводы не делаем
};

export type WeeklyHypothesisRef = {
  issue: number; title: string; funnel: FunnelKey; step: string; baseline: string;
};

export type WeeklyFunnelSidecar = {
  schemaVersion: 1;
  reportDate: string;                   // YYYY-MM-DD — день публикации
  reportPath: string;                   // docs/analytics/…-funnel-weekly.md
  period: { dateFrom: string; dateTo: string };          // закрытая неделя Пн–Вс
  previousPeriod: { dateFrom: string; dateTo: string };
  publishedAt: string;                  // ISO — момент генерации
  insufficientData: boolean;            // весь отчёт: выводов и гипотез нет
  funnels: WeeklyFunnelSummary[];
  hypotheses: WeeklyHypothesisRef[];    // максимум 3
};

export function buildWeeklyFunnelReport(input: {
  current: FunnelStatsData;
  previous: FunnelStatsData;
  reportDate: string;
  publishedAt: string;
  releases: { date: string; prs: { number: number; title: string }[] }[];
}): { markdown: string; sidecar: WeeklyFunnelSidecar };

export function parseWeeklySidecar(raw: unknown): WeeklyFunnelSidecar | null;  // Zod, не бросает
export function toDigestSummary(s: WeeklyFunnelSidecar): WeeklyFunnelDigest;
export function isFreshSidecar(i: { landedAt: string | null; publishedAt: string; now: Date }): boolean;
export function buildHypothesisIssueBody(i: HypothesisInput): string;
export function findPii(text: string): string | null;   // null — чисто
```

Сайдкар **неизменяем после мержа**: гипотезы регистрируются до открытия PR, и
md + json + все ссылки на issues уезжают одним коммитом. Это не косметика — на
этом стоит правило «блок в сводке не повторяется» (§7).

### Разделы отчёта (markdown)

1. **Период и источники** — даты обеих недель, таблица `ProductEvent`, оговорка
   про оценочность клиентских шагов (ADR #725 §9.1) и CGNAT-склейку сессий.
2. **Воронки** — по таблице на каждую: шаг, сессии, события, % от предыдущего,
   % от входа, **Δ п.п. к прошлой неделе**; строка «Наибольший отток: …».
3. **Релизы недели (AC-2.2)** — merged PR по дням МСК (через `ghApi`, тот же
   приём, что `mergedPrsLast24h` в `owner-digest.ts`, с постраничным обходом
   периода) + машинная строка на каждую воронку с |Δ| ≥ `NOTABLE_DELTA_PP` (5):
   «заметное изменение X п.п.; релизы на неделе: даты» либо «релизов на неделе
   не было — изменение не объясняется выкаткой». Суждение о связи пишет агент,
   но сам факт сопоставления в отчёте есть всегда.
4. **Достаточность данных (AC-2.5)** — см. ниже.
5. **Интерпретация** — раздел агента (при `insufficientData` — одна честная
   фраза, см. ниже).
6. **Гипотезы** — пункты дописывает CLI при регистрации каждой issue; при
   `insufficientData` раздел содержит фиксированную строку «Данных за неделю
   недостаточно — гипотезы не формулируются».
7. **Приватность** — фиксированная строка: отчёт построен на агрегатах, ни одной
   записи о конкретном посетителе.

### AC-2.5 «данных недостаточно» — в контракте функции, не в промпте

Пороги — именованные константы в `weekly-report.ts`, одно место, покрыты тестами:

```ts
export const MIN_TOP_SESSIONS_FOR_CONCLUSIONS = 30; // сессий на входе воронки за неделю
export const MIN_STEP_SESSIONS_FOR_DELTA = 10;      // ниже — дельту шага не показываем
export const NOTABLE_DELTA_PP = 5;                  // «заметное изменение» для сверки с релизами
```

- `topSessions < 30` → `funnel.insufficientData = true`: цифры в таблице
  остаются (это факты), но помечены «мало данных — выводы не делаем», дельты
  по шагам с `sessions < 10` печатаются как «—», а `endToEndDeltaPp = null`.
- Все 4 воронки недостаточны → `sidecar.insufficientData = true`: раздел
  «Гипотезы» закрыт, `hypothesis` CLI отказывает (exit 5), дайджест показывает
  одну строку «данных мало» вместо разбора.
- Обоснование порога: при ~30 сессиях один посетитель двигает конверсию более
  чем на 3 п.п., то есть шум превышает `NOTABLE_DELTA_PP`. Масштаб взят из
  реального трафика (`docs/analytics/2026-04-29-metrika-tracking-gap.md`: 126
  платных визитов за 15 дней). Константа, а не магия в коде: подкрутить = одна
  строка + тест.

### AC-2.6 «без PII» — подтверждено и подстраховано

`getFunnelStats()` / `aggregateFunnelStats()` возвращают **только**
`funnel`, `step`, `label`, `events`, `sessions` и проценты — ни одного поля, куда
персональные данные могли бы попасть физически (`sessionKey` и то не покидает БД:
и SQL экспорта, и `$queryRaw` используют его только внутри `COUNT(DISTINCT …)`).
Значит и отчёт, и сайдкар, и блок дайджеста PII-свободны по построению — это
свойство типа, а не дисциплины.

Единственная поверхность, куда PII может попасть **текстом**, — проза агента.
Поэтому `funnel-weekly.ts hypothesis` прогоняет `--body-file` через
`findPii(text)` (email, телефон в российском формате, 10/12-значный ИНН) и при
попадании отказывается создавать issue (exit 6). Дёшево, детерминированно,
тестируемо.

---

## 7. Решение D — как вечерний дайджест узнаёт про свежий отчёт (вопрос PRD №5)

### Варианты

**D1. Сравнивать дату в имени файла с сегодняшней (МСК).** Просто, но ломается
ровно в том случае, ради которого всё делается: PR с отчётом замержился в
00:20 вторника (медленный CI, свипер) — блок не выйдет никогда, потому что во
вторник «сегодняшнего» файла нет, а в среду он уже вчерашний. Отвергнуто.

**D2. Repo variable-флаг «отчёт опубликован», который дайджест гасит.** Дайджесту
пришлось бы писать состояние (`actions: write` в job, который сейчас read-only) и
уметь откатывать флаг при падении отправки. Состояние вне git ради того, что и так
видно в git. Отвергнуто.

**D3. Маркер-коммит / специальный тег.** Лишняя сущность: сайдкар и есть маркер.

**D4. «Сайдкар доехал в `main` за последние 24 часа». ВЫБРАНО.**

```ts
// scripts/owner-digest.ts
const path = latestSidecarPath('docs/analytics');                 // глоб *-funnel-weekly.json, max по имени
const sidecar = parseWeeklySidecar(JSON.parse(readFileSync(path)));
const landedAt = gitCommittedAt(path);                             // git log -1 --format=%cI -- <path>, null при ошибке
const weeklyFunnel = sidecar && isFreshSidecar({ landedAt, publishedAt: sidecar.publishedAt, now })
  ? toDigestSummary(sidecar)
  : null;                                                          // null ⇒ блока нет (AC-3.3)
```

Почему это правильный критерий:

- Ровно та же семантика «за сутки», что и у всех остальных секций дайджеста
  (merged PR, дельта бэклога, фидбек) — окна суток стыкуются, поэтому один и тот
  же отчёт попадает ровно в один дайджест: ни пропуска, ни повтора (AC-3.1/3.3).
- Это честный момент «отчёт существует для репозитория»: не когда агент его
  сгенерировал, а когда он доехал в `main`. Задержка мержа до суток обрабатывается
  сама собой — блок просто выйдет вечером того дня, когда отчёт доехал.
- Ноль записи состояния: job остаётся read-only, тестировать нечего, кроме одной
  чистой функции `isFreshSidecar`.
- Фолбэк `publishedAt` (если `git log` не отдал коммит — например, в локальном
  прогоне или при слишком мелком checkout) не создаёт ложных срабатываний:
  у старого отчёта `publishedAt` тоже старый.

Единственная правка workflow — глубина checkout: `fetch-depth: 50` (сейчас
дефолтная `1`, при ней истории для `git log` нет вовсе). Пятидесяти коммитов
заведомо хватает: «свежий» по определению значит «близко к HEAD», а недостающая
история для старого файла даёт правильный ответ «не свежий».

Известное ограничение: GitHub-cron дрожит на минуты, поэтому отчёт, доехавший в
пределах ±несколько минут от границы суток, теоретически может попасть в два
дайджеста или ни в один. Расписание уводит нас на ~11 часов от границы (§9),
так что практического окна для этого нет; фиксируем как осознанный остаток.

### Блок в сводке (AC-3.1, 3.2, 3.4)

`scripts/lib/owner-digest.ts` — расширение существующей чистой функции:

```ts
export interface WeeklyFunnelDigest {
  period: { dateFrom: string; dateTo: string };
  reportPath: string;
  insufficientData: boolean;
  funnels: { label: string; endToEndConversion: number; endToEndDeltaPp: number | null;
             biggestDropLabel: string | null; biggestDropConversion: number | null;
             insufficientData: boolean }[];
  hypotheses: { issue: number; title: string }[];
}

export interface OwnerDigestInput {
  … // существующие поля без изменений
  /** null — свежего недельного отчёта сегодня нет; блок не рендерится вовсе. */
  weeklyFunnel: WeeklyFunnelDigest | null;
}
```

Вид блока (вставляется после секции «Ждут твоего решения», перед «Пользователи»):

```
📊 <b>Воронка за неделю 14–20 сентября</b>
• Беседки: до брони доходит 6.2% (−1.8 пп); сильнее всего теряем на «Выбрал слот» — 24.7%
• Плей Парк: 9.4% (+0.6 пп); слабое место — «Выбрал слот» (31.0%)
• Кафе: 4.1% (−0.2 пп); слабое место — «Товар в корзине» (18.5%)
• Аренда: мало данных за неделю — выводов не делаем
💡 <b>Гипотезы недели (3)</b> — ждут твоего «делай», сами в работу не уйдут:
• Показывать свободные слоты прямо на странице беседок (#812)
• Убрать обязательный e-mail из формы заявки (#813)
• Дублировать кнопку «Оплатить» внизу меню кафе (#814)
Полный отчёт — docs/analytics/2026-09-21-funnel-weekly.md
```

Правила рендера (все — под тесты):

- `weeklyFunnel === null` → блока нет ни строкой (AC-3.3).
- `insufficientData` на уровне отчёта → одна строка «Данных за неделю мало —
  разбора и гипотез нет» и ничего больше (никаких выдуманных процентов).
- `hypotheses` пуст → строка «Гипотез на этой неделе нет.» — отсутствие гипотез
  тоже информация.
- Заголовки гипотез проходят `escapeHtml()` (они пришли из прозы агента).
- Полный отчёт **не** пересказывается — только путь к файлу (AC-3.4); ссылок на
  GitHub нет намеренно: владелец туда не ходит.
- Формулировка «ждут твоего "делай", сами в работу не уйдут» — прямое выполнение
  AC-3.2; она же объясняет владельцу, что делать.

---

## 8. Расписание Routine и программа недельной сессии (вопрос PRD №5)

### Routine

| Параметр | Значение |
|----------|----------|
| Имя | `Product Analyst: недельный отчёт по воронке` |
| Расписание | `0 6 * * 1` UTC — **понедельник 09:00 МСК** |
| Механизм | `create_trigger` (`mcp__Claude_Code_Remote__create_trigger`) из сессии с примонтированным репозиторием — наследует `environment_id`, как Routine автоочереди (ADR 2026-08-10) |
| Промпт | `ls /home/user/Platform-Delovoy/CLAUDE.md` — нет файла, заверши сессию, ничего не делая. Есть — прочитай и выполни `.claude/commands/weekly-funnel.md` |

Почему именно понедельник 09:00 МСК:

1. Отчётный период — **закрытая** неделя Пн–Вс: выходные (пик парка) целиком
   внутри, сравниваются две полные недели, границы не плавают.
2. Экспорт (08:40 МСК) отработал 20 минутами раньше — переменная свежая.
3. До вечернего дайджеста (21:00 МСК) ~12 часов: хватает на прогон ревью-агентов,
   CI и мерж, включая один-два круга «красный CI → правка». Если сессия умрёт —
   PR ветки `claude/**` домержит свипер (каждые 15 минут), запас всё равно есть.
4. Понедельник утром очередь задач обычно пустая — недельная сессия не конкурирует
   с воркером за лок (`maxOpenPrs = 2`).

AI в GitHub Actions не заводим — вариант отвергнут в ADR 2026-08-10 и
пересмотру в этой задаче не подлежит; Actions здесь делают только
детерминированную работу (экспорт данных и отправка сводки).

### `.claude/commands/weekly-funnel.md` (программа сессии)

```
0. ls CLAUDE.md; git checkout main && git pull    # нет репозитория — выход
1. npx tsx scripts/funnel-weekly.ts stats --out /tmp/funnel-stats.json
   exit 4 → npx tsx scripts/issue-queue.ts create --title "Недельный экспорт
   воронки не отработал" --prio P2 --ready --dedup-key funnel-export-failed
   и завершить сессию (владельцу не писать — CLAUDE.md §9 /next-issue)
2. npx tsx scripts/funnel-weekly.ts build --stats-file /tmp/funnel-stats.json
   exit 3 «отчёт за этот период уже есть» → завершить сессию (идемпотентность)
   stdout: { reportPath, sidecarPath, insufficientData, funnels: [{funnel, insufficientData}] }
3. insufficientData === true → дописать в «Интерпретация» одну честную фразу,
   гипотезы НЕ формулировать, перейти к шагу 5
4. Субагент product-analyst (agents/analytics.md):
   — читает отчёт, пишет «Интерпретацию» (включая вывод по релизам недели);
   — предлагает НЕ БОЛЬШЕ 3 гипотез, каждая по воронке/шагу из отчёта;
   — на каждую: npx tsx scripts/funnel-weekly.ts hypothesis --report-date <D>
       --funnel <f> --step <s> --title "…" --body-file <f.md>
     (CLI сам подставит baseline, откажет при 4-й, при insufficientData воронки
      и при PII в теле)
5. git checkout -b claude/weekly-funnel-<reportDate>; commit отчёта и сайдкара;
   npx tsx scripts/funnel-weekly.ts pr --branch <b> --report-date <D>
6. Субагенты code-reviewer → qa-engineer (как шаг 5 /next-issue);
   npx tsx scripts/issue-queue.ts verdict $PR code-reviewer
   npx tsx scripts/issue-queue.ts verdict $PR qa-engineer
   — без обоих маркеров гейт вернёт hold, и отчёт не доедет до дайджеста
7. pr-wait $PR 30 → pr-merge $PR (не успел — домержит свипер)
8. Владельцу ничего не писать: сводку доставит owner-digest.yml
```

Идемпотентность (шаг 2): `build` отказывается писать второй отчёт, если в
`docs/analytics/` уже есть сайдкар с тем же `period.dateFrom`. Повторный запуск
Routine, ретрай, ручной вызов — всё это не создаёт ни второго отчёта, ни второго
комплекта гипотез.

### Дополнения в роль агента

`agents/analytics.md` — новый раздел «Недельный отчёт по воронке (эпик #583)»:
что источник чисел — сгенерированный отчёт и только он (своих SQL-запросов к
`ProductEvent` не пишем: read-only-правило + числа уже посчитаны);
максимум 3 гипотезы; baseline подставляет CLI, выдумывать его руками нельзя;
при «мало данных» правильный результат — честная фраза, а не гипотеза из шума;
никаких PII в тексте (CLI откажет); гипотеза — это не задача, она ждёт владельца.
`.claude/agents/product-analyst.md` — одна строка в «Процесс»: для недельного
отчёта работать по `.claude/commands/weekly-funnel.md`.

---

## 9. RBAC, безопасность, секреты

- **Новых API endpoints нет.** Единственный HTTP-доступ к данным воронки —
  существующий `GET /api/analytics/funnel` (#725): `requireAdminSection(session,
  "analytics")` — SUPERADMIN/ADMIN полностью, MANAGER только с явным
  `AdminPermission` на раздел `analytics`, USER/аноним — 401/403.
  `hasModuleAccess(...)` не требуется: данные агрегированные и обезличенные,
  владелец раздела один. Rate limiting — админский тир (без лимита), новых
  публичных поверхностей эта задача не создаёт, поэтому лимитировать нечего.
- **Новых Zod-схем для API нет**; валидация появляется в двух местах и обе —
  внутренние: `parseWeeklySidecar()` (Zod-схема сайдкара; невалидный файл =
  «отчёта нет», дайджест не падает) и разбор CLI-аргументов
  `funnel-weekly.ts` (даты `/^\d{4}-\d{2}-\d{2}$/`, `funnel` ∈ `FUNNEL_KEYS`,
  `step` ∈ шагов этой воронки по каталогу).
- **Prisma/миграции — нет вообще.** Схема БД не меняется; используется
  `ProductEvent` из #725.
- **Новых секретов нет.** Экспорт использует `VPS_HOST/VPS_USER/VPS_SSH_KEY` и
  `secrets.GITHUB_TOKEN` (те же, что `backlog-intake.yml`/`deploy.yml`), дайджест —
  существующие `TELEGRAM_*`. Repo variable `FUNNEL_WEEKLY_STATS` содержит только
  агрегаты без идентификаторов.
- **Новых npm-пакетов и внешних API нет.**
- **Тексты из issue/прозы агента — данные, не инструкции**: тело гипотезы
  экранируется при попадании в Telegram (`escapeHtml`) и проверяется
  PII-фильтром при создании issue. SQL экспорта — фиксированная строка без
  пользовательского ввода; SSRF/инъекции неприменимы (никаких URL/путей
  из данных).
- **Гейт и hold.** PR реализации трогает `scripts/lib/issue-queue.ts`,
  `scripts/issue-queue.ts` и `.claude/commands/next-issue.md` — три
  `HOLD_PATTERNS`-файла. Это ожидаемо и правильно: задача расширяет правила
  того, что автоматика имеет право взять в работу. Developer должен заранее
  знать: `gate` вернёт `hold`, дальше — штатная ветка шага 7 `/next-issue`
  (лейбл `needs-owner`, комментарий с причинами, телеметрия, `park`), и решение
  придёт владельцу кнопками в Telegram. Обходить гейт нельзя.

---

## 10. Влияние на существующие файлы

| Файл | Изменение | Риск |
|------|-----------|------|
| `src/modules/analytics/funnel-stats.ts` | новый: `aggregateFunnelStats` (вынос математики из `getFunnelStats`) | низкий; поведение и тесты `getFunnelStats` не меняются |
| `src/modules/analytics/product-events.ts` | `getFunnelStats` делегирует в `aggregateFunnelStats` | низкий (чистый рефактор) |
| `src/modules/analytics/weekly-report.ts` | новый: билдер отчёта/сайдкара, парсер, freshness, шаблон гипотезы, PII-guard | нет |
| `src/modules/analytics/types.ts` | + типы сайдкара и `WeeklyFunnelDigest` | нет |
| `scripts/funnel-weekly.ts` | новый CLI: `stats` / `build` / `hypothesis` / `pr` | нет |
| `scripts/lib/owner-digest.ts` | + поле `weeklyFunnel` в `OwnerDigestInput` и рендер блока | **точечный**: правится боевой дайджест — обязателен тест «нет отчёта → нет ни одной новой строки» |
| `scripts/owner-digest.ts` | + поиск сайдкара, `git log` для `landedAt`, передача в билдер | низкий; при любой ошибке — `null`, дайджест едет без блока |
| `.github/workflows/owner-digest.yml` | `fetch-depth: 50` у checkout | низкий |
| `.github/workflows/analytics-funnel-export.yml` | новый workflow (cron + dispatch, `actions: write`) | низкий; падение алертит в админскую группу |
| `scripts/lib/issue-queue.ts` | + lane `hypothesis` в `Lane`/`laneOf`/`snapshot().byLane` | **hold-файл**; ломать порядок проверок в `laneOf` нельзя — `wip`/`review` остаются первыми |
| `scripts/issue-queue.ts` | + команда `promote`, + lane в дашборд/usage | **hold-файл** |
| `.claude/commands/next-issue.md` | + правило шага 0 про `auto:hypothesis` | **hold-файл** |
| `.claude/commands/weekly-funnel.md` | новый | нет |
| `agents/analytics.md`, `.claude/agents/product-analyst.md` | + раздел про недельный отчёт | нет |
| `CLAUDE.md` | строка модуля `analytics` (+ недельный отчёт и гипотезы, ADR 2026-09-16-weekly-product-analyst-loop); в блоке «Состояние очереди = лейблы issue» — `auto:hypothesis`; в списке автоматики — `analytics-funnel-export.yml` | обязателен в том же PR (Scope guard #4) |

Новых модулей, таблиц, миграций, секретов и зависимостей — ноль.

---

## 11. Риски и осознанные ограничения

1. **Routine — единственный стартер** (тот же SPOF, что у автоочереди; риск
   принят в ADR 2026-08-10). Если она не сработает, отчёта за неделю не будет и
   никто об этом не крикнет. Смягчение в v1 — дешёвое: экспорт-workflow идёт по
   своему крону и алертит в админскую группу при падении, то есть «данные не
   собрались» видно всегда. Явный watchdog «отчёта нет вторую неделю» сознательно
   не делаем — ещё один сигнал ради механизма, который пока не обкатан.
2. **Качество гипотез не гарантировано** — это суждение LLM на малых числах.
   Защита процедурная и достаточная: baseline из кода, порог «мало данных»,
   максимум 3, и ни одна гипотеза не уходит в работу без владельца.
3. **Пороги достаточности данных — оценка, не статистика.** Настоящая проверка
   значимости на десятках сессий невозможна; 30/10/5 — прагматичные константы в
   одном месте. При росте трафика перенастраиваются одной правкой.
4. **Repo variable как транспорт** ограничена 48 КБ. При нынешнем масштабе запас
   десятикратный; если трафик вырастет на порядок — переключаемся на
   недельные бакеты вместо дневных (та же переменная, меньше строк).
5. **Дрожание cron** у границы суток может теоретически сдвинуть блок сводки
   (§7); расписание уводит на ~11 часов от границы.
6. **Отчёт врёт ровно настолько, насколько врут данные #725**: клиентские шаги
   (`slot_selected`, `cart_item_added`, `form_started`) систематически
   недосчитываются, сессии склеиваются CGNAT. Оговорка печатается в отчёте
   всегда — чтобы владелец не читал абсолютную конверсию как точную.
7. **PR реализации уйдёт в `hold`** (§9) — это не сбой, а ожидаемый разовый шаг
   с решением владельца.

---

## 12. Чеклист для Developer

**Аналитика (домен):**
- [ ] `src/modules/analytics/funnel-stats.ts` — `aggregateFunnelStats(rows, period, funnel?)`, вынос математики из `getFunnelStats`; `product-events.ts` делегирует
- [ ] `src/modules/analytics/weekly-report.ts` — `buildWeeklyFunnelReport`, `parseWeeklySidecar`, `toDigestSummary`, `isFreshSidecar`, `buildHypothesisIssueBody`, `findPii`, константы `MIN_TOP_SESSIONS_FOR_CONCLUSIONS`/`MIN_STEP_SESSIONS_FOR_DELTA`/`NOTABLE_DELTA_PP`/`WEEKLY_SIDECAR_SCHEMA_VERSION`
- [ ] `src/modules/analytics/types.ts` — типы сайдкара и `WeeklyFunnelDigest`
- [ ] Ни один новый файл не импортирует `@/lib/db`/`@/lib/redis` (иначе CLI не запустится)

**CLI и автоматика:**
- [ ] `scripts/funnel-weekly.ts` — `stats` (repo variable + dispatch+poll, exit 4), `build` (идемпотентность по `period.dateFrom`, exit 3; релизы недели через `ghApi`), `hypothesis` (≤3 → exit 7, `insufficientData` → exit 5, PII → exit 6; issue через `issue-queue.ts create --label auto:hypothesis --label from-analytics --dedup-key funnel-hyp-<дата>-<funnel>-<step>`; дописывает сайдкар и раздел «Гипотезы»), `pr`
- [ ] `.github/workflows/analytics-funnel-export.yml` — cron `40 5 * * 1` + dispatch, SSH→psql (SQL без одинарных кавычек), `gh variable set FUNNEL_WEEKLY_STATS`, summary, Telegram-алерт в админскую группу при падении
- [ ] `scripts/lib/issue-queue.ts` — lane `hypothesis` в `Lane`, `laneOf` (после `parked`, до `ready`), корзина в `snapshot().byLane`
- [ ] `scripts/issue-queue.ts` — команда `promote <N> <P0..P3>` (только из lane `hypothesis`, комментарий), lane в дашборде и в строке usage
- [ ] Лейбл `auto:hypothesis` и `from-analytics` создаются идемпотентно (как `gh label create … || true` в интейке)

**Дайджест (US-3):**
- [ ] `scripts/lib/owner-digest.ts` — поле `weeklyFunnel: WeeklyFunnelDigest | null` + рендер блока (порядок: после «решений», до «пользователей»), `escapeHtml` на заголовках гипотез
- [ ] `scripts/owner-digest.ts` — поиск последнего `docs/analytics/*-funnel-weekly.json`, `git log -1 --format=%cI -- <файл>`, `isFreshSidecar`, любая ошибка → `null`
- [ ] `.github/workflows/owner-digest.yml` — `fetch-depth: 50`

**Промпты и документация:**
- [ ] `.claude/commands/weekly-funnel.md` — программа сессии (§8), включая шаг с обоими ревью-агентами и вердиктами
- [ ] `.claude/commands/next-issue.md` — правило шага 0 про `auto:hypothesis` (§5, точная формулировка)
- [ ] `agents/analytics.md` + `.claude/agents/product-analyst.md` — раздел про недельный отчёт
- [ ] `CLAUDE.md` — синк в том же PR (строка `analytics`, лейбл `auto:hypothesis`, новый workflow)
- [ ] Routine создана из сессии с примонтированным репозиторием: `0 6 * * 1` UTC, промпт из §8 (это не код — отметить в теле PR, что сделано)

**Тесты (обязательны в том же коммите):**
- [ ] `src/modules/analytics/__tests__/funnel-stats.test.ts` — конверсии, пустой период, `biggestDropStep`; существующие тесты `getFunnelStats` остаются зелёными без правок
- [ ] `src/modules/analytics/__tests__/weekly-report.test.ts`:
      дельты п.п. (рост/падение/`null` при малых числах); `biggestDrop*` попадают в сайдкар;
      `insufficientData` по одной воронке и по всему отчёту (порог 30);
      в markdown и сайдкаре нет ни одного поля с идентификатором (AC-2.6);
      сверка с релизами: |Δ| ≥ 5 п.п. + релизы на неделе / без релизов;
      `parseWeeklySidecar` на мусоре и на чужой `schemaVersion` → `null`;
      `isFreshSidecar`: доехал 2 ч назад → true; 25 ч → false; `landedAt = null` +
      свежий/старый `publishedAt`; `buildHypothesisIssueBody` содержит все 4 секции
      AC-2.3 и baseline-числа из сайдкара; `findPii` ловит email/телефон/ИНН и не
      ложится на обычный русский текст с процентами
- [ ] `scripts/lib/__tests__/owner-digest.test.ts` — блок рендерится (конверсии, Δ, шаг оттока, гипотезы с номерами, путь к отчёту); `weeklyFunnel: null` → в тексте нет ни одной строки блока (AC-3.3); `insufficientData` → одна честная строка без процентов; гипотез нет → явная строка; HTML в заголовке гипотезы экранируется
- [ ] `scripts/lib/__tests__/issue-queue.test.ts` (существующий) — `laneOf` для `auto:hypothesis`; `isUntriaged` → false; `isEligible` → false; `assertClaimable` бросает; `snapshot().byLane.hypothesis`
- [ ] `npm test && npx tsc --noEmit && npm run lint` зелёные

---

## 13. Трассировка AC → решение

| AC | Где закрыт |
|----|-----------|
| AC-2.1 (конверсия по шагам, Δ к прошлой неделе, шаг оттока) | §3 (`aggregateFunnelStats` ×2 периода), §6 раздел 2 отчёта, сайдкар `funnels[]` |
| AC-2.2 (сверка с релизами недели) | §6 раздел 3: merged PR периода через `ghApi` + машинная строка при \|Δ\| ≥ `NOTABLE_DELTA_PP`, суждение — проза агента |
| AC-2.3 (≤3 гипотез, 4 обязательных поля, baseline) | §5 шаблон `buildHypothesisIssueBody` + CLI: baseline подставляется из сайдкара, 4-я гипотеза отвергается (exit 7) |
| AC-2.4 (гипотеза не уходит в работу сама) | §5: lane `auto:hypothesis` → невидима для `untriaged`, невыбираема `next`, `claim` отказывает; ход даёт только `promote` после слова владельца; правка шага 0 `next-issue.md` |
| AC-2.5 (мало данных → честный отчёт, а не гипотезы) | §6: пороги-константы, `insufficientData` на воронку и на отчёт, CLI отказывает в гипотезах (exit 5) |
| AC-2.6 (нет PII) | §6: типы `FunnelStatsData`/сайдкара физически без полей о человеке, `sessionKey` только внутри `COUNT(DISTINCT)`; `findPii` на прозе агента |
| AC-3.1 (блок в сводке в день отчёта) | §7: сайдкар, доехавший в `main` за 24 ч, → `weeklyFunnel` → блок |
| AC-3.2 (гипотезы названы и явно ждут решения) | §7: строка «Гипотезы недели (N) — ждут твоего "делай", сами в работу не уйдут» + номера issues |
| AC-3.3 (в другие дни блока нет) | §7: `weeklyFunnel === null` → ни одной строки; окна суток стыкуются, повтора нет |
| AC-3.4 (выжимка, не весь отчёт) | §7: ≤4 строк по воронкам + ≤3 гипотезы + путь к файлу; полный отчёт остаётся в `docs/analytics/` |

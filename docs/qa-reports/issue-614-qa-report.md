# QA-отчёт: Issue #614 — Decimal `pricePerHour` пересекает границу Server → Client в ps-park Timeline

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-614-timeline-decimal`, 2 коммита поверх `main` (`b9c8002`):
  `1181442` (feat) + `ba1250f` (test-quality follow-up: реальный `Prisma.Decimal` вместо
  самодельного мока в тесте).
- Формальной PRD в `docs/requirements/` для этого issue нет (баг-фикс, не фича) — эталон:
  текст issue #614, как задано в постановке задачи на проверку. `docs/qa-reports/issue-614-review.md`
  на момент проверки не найден (`ls docs/qa-reports/ | grep 614` — пусто), учитывать нечего.
- `git diff main...claude/issue-614-timeline-decimal --stat`: **3 файла**, `+51/-2`:
  `src/modules/ps-park/types.ts`, `src/modules/ps-park/service.ts`,
  `src/modules/ps-park/__tests__/service.test.ts`. Ни одного файла в `src/app/api/**`,
  `prisma/schema.prisma`, роутов или auth-конфига — RBAC/security-поверхность не затронута.

## Регрессия
```
npm test -- --run     → 269 test files, 3822/3822 passed, 0 failed   (совпадает с базовой линией)
npx tsc --noEmit       → чисто, пустой вывод
npm run lint           → 0 errors, 16 warnings — все pre-existing (messenger/*, notifications/service.ts,
                          telephony/novofon-client.ts, auth/vk-community-banner.tsx), ни один не в ps-park
npx vitest run src/modules/ps-park → 2 test files, 161/161 passed
```
Числа полностью совпадают с заявленной базовой линией (~3822/0/16).

## Acceptance Criteria (из текста issue #614)

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | `getTimeline()` не передаёт сырой Prisma `Resource` (с `Decimal`-полями) напрямую в `TimelineData.resources`, отдаваемый Client Components | PASS | `service.ts:1506-1514` теперь маппит `resources.map((r) => ({...}))` в plain-объект вместо `resources` as-is. Живо воспроизвёл исходный баг на `main` (см. раздел «Воспроизведение исходного дефекта» ниже) — до фикса `result.resources[0].pricePerHour` был реальным экземпляром `Decimal` (видны внутренние поля `d`/`e`/`s` decimal.js), не числом. |
| 2 | `pricePerHour` приведён к `number`/`string` тем же паттерном, что и в остальном модуле (`Number(...)`) | PASS | `pricePerHour: r.pricePerHour != null ? Number(r.pricePerHour) : null` — идентичный паттерн `Number(...)` из `page.tsx`/`resources/page.tsx`, `null` явно сохраняется вместо `Number(null) === 0` (не искажает бизнес-смысл «цена не задана»). |
| 3 | Прочие Decimal-поля модели `Resource`, если есть, тоже конвертированы | PASS | Независимо перечитал `model Resource` в `prisma/schema.prisma`: единственное Decimal-поле — `pricePerHour Decimal?`. Остальные поля, попадающие в `TimelineResource` (`description String?`, `capacity Int?`, `isActive Boolean`, `metadata Json?`), не являются классами-инстансами и сериализуются нативно. Подтверждено кодом ревью и независимо проверено мной. |
| 4 | Не затронуты `listTables()` / `PSTableResource` / публичный `TableCard`-путь (сознательно вне скоупа) | PASS | `grep -rl PSTableResource src` → только `service.ts`, `types.ts` (объявление), `table-list.tsx` и `(public)/ps-park/page.tsx` — оба публичных файла не изменены диффом и остались на старом `PSTableResource` (со своим уже существующим паттерном `Number(...)` при рендере). Скоуп-крип отсутствует. |

## Независимое воспроизведение исходного дефекта (до фикса)
Не поверил на слово описанию issue — поднял `git worktree` на `main`, скопировал в него **новый**
тест-файл этой ветки (`service.test.ts`) поверх старого `service.ts`/`types.ts` `main`, прогнал
`npx vitest run ... -t getTimeline`:

```
FAIL  ... > getTimeline > converts resource pricePerHour to a plain number, not a Decimal-like object
AssertionError: expected 300.5 to be 300.5 // Object.is equality
- Expected:
300.5
+ Received:
i {
  "constructor": [Function i],
  "d": [ 300, 5000000 ],
  "e": 2,
  "s": 1,
}
```
Это прямое доказательство: на `main` `getTimeline()` действительно возвращает живой `Decimal.js`
инстанс (видны внутренние поля движка decimal.js `d`/`e`/`s`), не примитив — баг реальный, не
гипотетический. Тест на `null`-цену (`keeps resource pricePerHour null...`) на `main` при этом
**проходил** и там — ожидаемо, `null` не является Decimal-инстансом ни до, ни после фикса, так что
этот конкретный кейс не был бы регрессионным индикатором сам по себе; ценность несёт именно тест на
ненулевую цену. После применения фикса (переключился обратно на ветку) оба новых теста зелёные.

## Качество новых тестов — не тавтологичны
- `mockTable()` (дефолтный хелпер) уже задаёт `pricePerHour: 300` как **plain number**, а не
  `Decimal` — то есть большинство существующих тестов `getTimeline` в файле эту дыру не поймали бы
  ни до, ни после фикса. Новый тест явно переопределяет `pricePerHour: new Prisma.Decimal(300.5)` —
  осознанный выбор, ловит именно этот баг.
- `ba1250f` заменил самодельный fake-Decimal на настоящий `new Prisma.Decimal(...)` из
  `@prisma/client` — проверил: в тест-файле замокан только `@/lib/db` (сам Prisma Client instance),
  `@prisma/client` (включая `Prisma.Decimal`) остаётся немоканным реальным модулем. Т.е. тест
  использует байт-в-байт тот же класс, что вернёт настоящий `prisma.resource.findMany()` в проде —
  не suffers from "мок ведёт себя иначе, чем реальность".
- Самостоятельно (temporary patch, откачен после прогона, `git status` подтверждает чистое дерево)
  добавил третий сценарий: `capacity: null, description: null, pricePerHour: new Prisma.Decimal(150)`
  → `result.resources[0].capacity === null`, `.description === null`, `.pricePerHour === 150`. Все три
  прошли — `null`-поля, не участвующие в Decimal-конверсии, проходят маппинг без искажения (не
  превращаются в `0`/`""`/`undefined`).

## Server → Client граница — подтверждено чтением реального рендер-пути
Не поверил утверждению ревью на слово, перечитал сам:
- `src/components/admin/ps-park/timeline-grid.tsx:1` — `"use client"`, пропс
  `TimelineGridProps = { initialData: TimelineData; initialDate: string }`.
- `src/components/admin/ps-park/mobile-timeline.tsx:1` — `"use client"`, пропс
  `Props = { initialData: TimelineData; initialDate: string }`.
- `src/app/admin/ps-park/page.tsx:59` — `export default async function PSParkManagerPage()`, **без**
  `"use client"` → настоящий async Server Component. Строка 77: `getTimeline(todayStr)` в
  `Promise.all([...])`, результат (`timelineData`) передаётся как `initialData` в оба клиентских
  компонента (строки 151, 163).
Итого: это подлинная Server→Client сериализационная граница Next.js App Router (RSC payload), а не
no-op — до фикса через неё утекал живой class-инстанс `Decimal`, что и вызывало консольный
React-warning на каждой загрузке `/admin/ps-park`, описанный в issue.

Побочный положительный эффект (не заявлен как AC, но заметил): тот же `getTimeline()` используется в
`src/app/api/ps-park/timeline/route.ts` — JSON-эндпоинт, на который клиентские компоненты дергают
`fetch()` при смене даты (`loadTimeline`). `JSON.stringify` на живом `Decimal` даёт нежданный
результат (сериализует внутренние поля `d/e/s`, а не число) — фикс попутно чинит и этот путь, хотя
явно не про него шла речь в issue.

## Edge cases
- [x] `pricePerHour: null` (уже покрыт тестом `ba1250f`, независимо перепроверил — не false-negative:
  без фикса тест тоже проходит, поэтому ценность несёт именно ненулевой-Decimal-тест выше, а не этот)
- [x] `pricePerHour` ненулевой `Decimal` (основной regression-тест, воспроизвёл провал на `main`)
- [x] `capacity: null`, `description: null` — самостоятельно проверено temporary-тестом, поля проходят
  маппинг без искажения
- [x] Скоуп: `listTables()`/`PSTableResource`/публичный `TableCard`-путь не тронуты (подтверждено grep)

## RBAC / Security
Не применимо — `git diff main...claude/issue-614-timeline-decimal --stat` подтверждает: изменения
только в `src/modules/ps-park/{types.ts,service.ts}` и его тест-файле. Ни новых роутов, ни изменений
`auth.ts`/`permissions.ts`/`proxy.ts`, ни новых полей в API-ответах наружу — `getTimeline()` не
публичный endpoint (вызывается только из уже существующего защищённого `/admin/ps-park` дерева и
`/api/ps-park/timeline`, оба вне скоупа этого диффа). Обязательные функциональные security-кейсы
из `agents/qa.md` (RBAC/rate limiting/input validation/data leakage) к этому PR неприменимы — фикс
чисто в типизации данных внутри уже авторизованного пути, самих данных (цена стола) наружу больше не
уходит, чем уходило раньше — просто в другом представлении (`number` вместо `Decimal`-инстанса).

## Что не проверено (честно)
Живого браузера нет — не открывал `/admin/ps-park` в реальном UI и не смотрел консоль DevTools
собственными глазами до/после фикса. Компенсировано: (1) прямым воспроизведением бага на уровне
данных (Decimal-инстанс долетает до `TimelineData.resources` на `main`, не долетает на ветке —
показано выше юнит-тестом), (2) чтением фактического рендер-пути, подтверждающим, что это реальная
RSC-граница, а не мёртвый код. Этого достаточно для функциональной уверенности в фиксе, но
визуальное/консольное подтверждение в браузере не выполнялось и не заявляется как выполненное.

## Итог
- AC из issue #614: 4 (сформулированы из текста issue, PRD нет)
- PASS: 4
- FAIL: 0
- Регрессия: `npm test` 3822/3822, `npx tsc --noEmit` чисто, `npm run lint` 0 ошибок / 16 pre-existing
  предупреждений (совпадает с базовой линией), `npx vitest run src/modules/ps-park` 161/161 (включая
  оба новых теста).
- RBAC/security: не применимо, диффом подтверждено (3 файла, все в `src/modules/ps-park/`).
- Баг реально воспроизведён на `main` до фикса (живой `Decimal`-инстанс на выходе `getTimeline()`,
  показан в assertion diff со внутренними полями decimal.js) и подтверждённо устранён на ветке.
- Новые тесты содержательны (не тавтологичны): используют настоящий `Prisma.Decimal`, дефолтный
  тестовый хелпер модуля их не подстраховывал бы.

**Вердикт: PASS.** Фикс решает заявленную в issue #614 проблему: `getTimeline()` больше не передаёт
сырой Prisma `Decimal` через границу Server → Client Component в `TimelineData.resources`. Дефект
подтверждён как реальный (воспроизведён на `main`), а не гипотетический. Единственное Decimal-поле
модели `Resource` (`pricePerHour`) конвертируется через тот же паттерн `Number(...)`, что и в
остальном модуле; прочих Decimal-полей на модели нет. Скоуп ограничен тремя файлами внутри
`src/modules/ps-park/`, без затрагивания `listTables()`/`PSTableResource`/публичного пути и без
RBAC/security-поверхности. Полный прогон тестов, `tsc` и `lint` не показывает регрессий относительно
заявленной базовой линии. Единственная оговорка — отсутствие живой браузерной проверки консоли,
явно отмечено выше и компенсировано воспроизведением бага на уровне данных.

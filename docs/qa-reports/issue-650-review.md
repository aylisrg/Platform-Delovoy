# Review: batch soft-delete `deletedAt` filter fix — messenger/monitoring/cafe (#650, #660, #661)

## Вердикт: PASS

## Контекст

Батч трёх находок одного класса бага (#489/#557/#620 — count-запрос по
soft-deletable модели в обход сервисного слоя, без `deletedAt: null`),
все обнаруженные в ходе работы над #650 и зафиксированные под собственными
issue до правки (не «тихий» фикс):

- **#650** (исходная) — из QA-отчёта issue #620 (`docs/qa-reports/issue-620-qa-report.md`,
  раздел "находка вне скоупа этого PR"): `messenger.getHealthMetrics()` без `where`
  вообще на `chatMessage.count()`; `admin/dashboard` `order.count()` и
  `admin/cafe` два `order.count()` без `deletedAt: null`.
- **#660** — найдено при правке #650, в той же функции `getDashboardStats()`:
  оба `booking.count()` (gazebo/ps-park `bookingsToday`) тоже не фильтруют
  `deletedAt: null`.
- **#661** — найдено при правке #650, в том же файле `admin/cafe/page.tsx`:
  `ordersWhere`, питающий `prisma.order.findMany` для таблицы заказов в UI
  (`OrderActions` на каждой строке), тоже не фильтрует `deletedAt: null` —
  более заметная версия бага, чем счётчики (мягко удалённый заказ был бы виден
  менеджеру в таблице, а не только искажал цифру).

Нет PRD/ADR — точечный баг-фикс с AC прямо из issues, консистентно с
прецедентом #620.

## Верификация батчинга (CLAUDE.md Scope guard #3, issue #655)

- Ветка `claude/issue-650-soft-delete-batch` — прямой потомок актуального
  `main` (`git merge-base` = HEAD `main`), т.е. уже включает #655
  (`00a3278 docs: правило PR-гранулярности`). Формулировка Scope guard #3 на
  диске отличается от текста, вставленного в системный промпт этой сессии
  (устаревший снэпшот CLAUDE.md с текстом "One PR = one feature") — проверено
  чтением живого файла, а не из контекста.
- Все три issue существуют в GitHub, открыты, помечены `auto:wip`
  (взяты/claimed, не anonymous work): #650, #660, #661 — подтверждено
  `GET /repos/aylisrg/Platform-Delovoy/issues/{650,660,661}`.
- Тексты #660/#661 явно ссылаются на #650 ("найдено при реализации issue
  #650, тот же файл/функция") и на политику батчинга ("батчится в тот же PR
  по правилу CLAUDE.md Scope guard #3") — это не разрозненный grab-bag, а
  одна и та же функция/файл, один и тот же класс бага, найденный в процессе
  одной правки.
- Commit `8bfabf5` содержит `Closes #650, closes #660, closes #661` — все три
  будут закрыты этим PR.
- `git diff main...HEAD --stat` — ровно 6 файлов: `messenger/service.ts` +
  его тест, `admin/dashboard/page.tsx` + новый тест-файл, `admin/cafe/page.tsx`
  + новый тест-файл. Ничего лишнего (ожидалось ровно это в постановке задачи).

Батчинг сделан корректно: каждое изменение имеет собственную задачу, работа
генетически связана (один и тот же баг-класс, найден в тех же файлах/функциях
в процессе одной правки), не «что под руку попалось».

## Acceptance Criteria

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | (#650) `getHealthMetrics()` фильтрует `deletedAt: null` на `chatMessage.count()` | PASS | `src/modules/messenger/service.ts:95` — `prisma.chatMessage.count({ where: { deletedAt: null } })`. `prisma.chat.count()` (строка 94) намеренно не тронут — `Chat` не имеет поля `deletedAt` (см. ниже). |
| 2 | (#650) `admin/dashboard` `order.count()` фильтрует `deletedAt: null` | PASS | `src/app/admin/dashboard/page.tsx` — `deletedAt: null` добавлен в `where` `order.count`. |
| 3 | (#650) `admin/cafe` оба `order.count()` (todayCount/activeCount) фильтруют `deletedAt: null` | PASS | `src/app/admin/cafe/page.tsx:79,82` (внутри `getCafeOrdersData`) — оба добавлены, соседний `order.aggregate` уже был корректен и не менялся. |
| 4 | (#660) оба `booking.count()` в `getDashboardStats()` фильтруют `deletedAt: null` | PASS | `src/app/admin/dashboard/page.tsx` — `deletedAt: null` добавлен в оба `where` (gazebo/ps-park). |
| 5 | (#661) `ordersWhere`, питающий таблицу заказов в UI, фильтрует `deletedAt: null` | PASS | `buildCafeOrdersWhere()` (`admin/cafe/page.tsx:60`) — `deletedAt: null` в базовом объекте, применяется ко всем веткам фильтра (status/paidOnly/без фильтров). |
| 6 | Тесты, воспроизводящие сценарий с мягко удалённой записью | PASS | См. раздел "Тесты" ниже — каждая правка покрыта отдельным assertion'ом, пингующим именно её. |

## Верификация схемы (не доверяя тексту issue)

Прочитал `prisma/schema.prisma` лично:
- `model Booking` (строка 190) — `deletedAt DateTime?` (строка 212), **есть**
  `@@index([deletedAt])` (строка 225). Подтверждено.
- `model ChatMessage` (строка 2080) — `deletedAt DateTime?` (строка 2087).
  Подтверждено.
- `model Chat` (строка 2045) — полей `deletedAt` **нет**. `prisma.chat.count()`
  в `getHealthMetrics()` корректно оставлен без `where` — бага там нет.
- `model Order` (строка 316) — `deletedAt DateTime?` (строка 329). Подтверждено.
- `model Module` (строка 152) — полей `deletedAt` нет (только `isActive`),
  поэтому оба `module.count()` в `getDashboardStats()` (activeModules/
  totalModules) корректно не тронуты — это не баг того же класса, а другой
  механизм (флаг, не soft-delete).

## Рефакторинг `admin/cafe/page.tsx`: поведенческая эквивалентность

Сравнил построчно `git show main:.../page.tsx` с новой версией:

- `buildCafeOrdersWhere(today, statusFilter, paidOnly)` — дословно тот же
  объект, что раньше собирался инлайново (`moduleSlug`, `createdAt`,
  условные spread'ы `status`/`paidAt`), плюс новая строка `deletedAt: null`.
  Три теста покрывают все три ветки (без фильтров / со `status` / с
  `paidOnly`) — идентичны исходным веткам условной логики.
- `getCafeOrdersData(ordersWhere, today)` — тот же `Promise.all` из 4 промисов
  (`findMany`, 2×`count`, `aggregate`) с теми же аргументами (кроме добавленных
  `deletedAt: null`), просто вынесенный из тела компонента в отдельную функцию.
  Порядок и структура возвращаемого объекта (`orders`, `todayCount`,
  `activeCount`, `todayRevenue`) совпадают с тем, что раньше деструктурировалось
  из общего `Promise.all` вместе с `menuItems`.
- В компоненте `CafeManagerPage` конкурентность не изменилась: раньше 5
  промисов (`getMenuAdmin` + 4 order-запроса) шли в одном `Promise.all`;
  теперь внешний `Promise.all([getMenuAdmin(), getCafeOrdersData(...)])`, а
  4 order-запроса — во внутреннем `Promise.all` внутри `getCafeOrdersData`.
  Итоговая степень параллелизма та же (все 5 БД-вызовов стартуют одновременно),
  просто вложенно. Поведенческих различий не найдено.
- Прекомментарий `// Через сервис — чтобы каталог...` над `getMenuAdmin()`
  сохранён на прежнем месте, ничего не потеряно при переносе.

**Пропорциональность рефакторинга**: извлечение — механическое (код
перенесён дословно, добавлена только `deletedAt: null`), не редизайн. Цель
явно документирована в коде (`/** Вынесено из компонента, чтобы
deletedAt-фильтрацию можно было протестировать без рендера. */`) — это прямое
следствие требования "тест на каждый фикс" (CLAUDE.md Tests), а не
самостоятельное "улучшение". Прецедент `getDashboardStats` в этом же PR
корректен: этот файл проверен через `git show main:...` — функция уже
существовала как отдельная (не инлайновая) именованная функция *до* PR,
просто без `export`; PR лишь добавляет `export`. То есть прецедент, на
который ссылается разработчик, сам по себе минимален (только модификатор
`export`), а не новая экстракция — это не индульгенция на больший рефакторинг
в cafe, но и там экстракция ограничена ровно тем объёмом кода, который нужно
протестировать. `npx next build` (см. ниже) подтверждает, что дополнительные
именованные экспорты в `page.tsx` не ломают сборку Next.js — единственный
похожий прецедент в кодовой базе на неё же и ссылается (`grep` по
`^export (async )?function` в `**/page.tsx` — только эти два файла), но это
инфраструктурно безопасно (build прошёл чисто, без предупреждений про эти
файлы).

Вывод: рефакторинг пропорционален P2 баг-фиксу батчу, не overreach.

## Тесты — качество моков и pinning-проверка

- **`messenger/__tests__/service.test.ts`** — новый тест использует
  существующий мок `@/lib/db` файла (без изменений в стратегии мокирования),
  проверяет `chatMessage.count` вызван с `where: { deletedAt: null }`. До
  фикса вызов был вообще без аргументов (`prisma.chatMessage.count()`) —
  `toHaveBeenCalledWith(expect.objectContaining(...))` против `count()` без
  аргументов провалился бы (нет `where` вообще). Тест пингует фикс.
- **`admin/dashboard/__tests__/page.test.ts`** — мокирует только `@/lib/db`
  (компонент/`getDashboardStats` не вызывает `auth()`/`next/navigation`,
  дополнительные моки не нужны — подтверждено чтением `page.tsx`, там нет
  `auth()` вообще). Тест на `booking.count` перебирает оба вызова
  (`toHaveBeenCalledTimes(2)` + цикл по `mock.calls`) и требует
  `deletedAt: null` в обоих — если убрать фильтр из одного или обоих `where`,
  `objectContaining` не найдёт ключ и упадёт. То же для `order.count`. Плюс
  happy-path тест и error-path тест (нулевая статистика при ошибке БД) —
  общая регрессионная гигиена для впервые тестируемой функции.
- **`admin/cafe/__tests__/page.test.ts`** — мокирует `@/lib/auth`,
  `@/lib/permissions`, `@/modules/cafe/service`, `next/navigation` в
  дополнение к `@/lib/db`. Это оправдано: `page.tsx` импортирует эти модули
  на верхнем уровне (`auth`, `hasAdminSectionAccess`, `getMenuAdmin`,
  `forbidden`), и хотя тестируемые функции (`buildCafeOrdersWhere`,
  `getCafeOrdersData`) их не вызывают, сам факт импорта модуля исполнил бы
  реальные `@/lib/auth`/`@/lib/permissions` (тянут NextAuth-конфиг) без
  мока — моки корректно предотвращают это, не подменяя ничего в тестируемой
  логике. `buildCafeOrdersWhere` тесты проверяют возвращаемый объект напрямую
  (`toEqual(expect.objectContaining({ ..., deletedAt: null }))`) — при откате
  фикса ключ `deletedAt` пропал бы из объекта, `objectContaining` провалился
  бы. `getCafeOrdersData` тест по `mockOrderCount` (2 вызова, у обоих
  `deletedAt: null` в `where`) аналогично пингует #650; отдельный тест
  проверяет, что `findMany` получает переданный `ordersWhere` как есть
  (включая `deletedAt: null`) — пингует #661.
- Полный прогон (`npm test -- --run`) подтверждает: **284 test files passed,
  3961 tests passed**, регрессий нет.

Моки не скрывают реальные баги: во всех трёх местах assertion бьёт именно по
добавленной строке `deletedAt: null`, а не по побочному/случайному полю.

## Scope Check
- Scope creep: Нет.
- Диф ровно 6 файлов: `src/modules/messenger/service.ts`,
  `src/modules/messenger/__tests__/service.test.ts`,
  `src/app/admin/dashboard/page.tsx`,
  `src/app/admin/dashboard/__tests__/page.test.ts` (новый),
  `src/app/admin/cafe/page.tsx`,
  `src/app/admin/cafe/__tests__/page.test.ts` (новый). Совпадает с
  ожидаемым скоупом из постановки задачи.
- `CLAUDE.md`, `prisma/schema.prisma`, `package.json` не тронуты (и не
  должны быть — новых полей/моделей/зависимостей фикс не вводит).
- В процессе ревью замечен несвязанный уже существующий трекнутый баг
  (issue #656, `forbidden()` без `experimental.authInterrupts` — затрагивает
  и `admin/cafe/page.tsx`, но использование `forbidden()` в этом файле
  дословно не изменено этим диффом, `next.config.ts` этим PR не трогается).
  Не входит в скоуп #650/#660/#661, уже отслеживается отдельно, не блокирует
  этот вердикт.

## Качество кода
- TypeScript strict / `any`: OK. `grep -n "\bany\b"` по изменённым
  production-файлам — 0 совпадений. В `messenger/__tests__/service.test.ts`
  есть `as any`/`eslint-disable @typescript-eslint/no-explicit-any` — но это
  pre-existing (подтверждено `git show main:...` — директива уже была на
  строке 1 файла до этого PR), новые строки, добавленные этим диффом, `any`
  не используют.
- `apiResponse()`/`apiError()`: не применимо — изменения не в API route
  handlers, а в count-запросах Server Component'ов и сервисной функции,
  используемой health-роутом (сам роут не тронут).
- AuditLog: не применимо — фикс read-only (count/where), мутаций нет.
- Тесты: OK (см. выше).

## Безопасность

### Secrets leakage
`git diff main...HEAD | grep -inE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'`
— 0 совпадений. Диф состоит из `deletedAt: null` в `where`-объектах и
тестовых моков (`vi.fn()`), секретов не содержит.

### RBAC
Не применимо — новых endpoint'ов нет. `admin/cafe/page.tsx` сохраняет
прежнюю RBAC-проверку (`auth()` + `hasAdminSectionAccess(userId, "cafe")`)
без изменений — она просто физически осталась в компоненте, новые
извлечённые функции (`buildCafeOrdersWhere`/`getCafeOrdersData`) её не
дублируют и не обходят (вызываются из компонента уже после проверки).
`messenger.getHealthMetrics()` — внутренняя функция, вызываемая
`/api/messenger/health` (публичный health-check, тот же архитектурный
паттерн, что и `cafe/health` в #620, вне auth-гейта `proxy.ts` по дизайну) —
не регрессия этого PR.

### Supply chain
Новых зависимостей нет. `package.json`/`package-lock.json` не изменены.

### Injection
Нет raw SQL, нет `dangerouslySetInnerHTML`, все запросы — типизированные
Prisma-вызовы с литеральными/параметризованными полями.

### Dangerous ops
Нет деструктивных git/shell/DB операций в диффе.

**Инцидентов не найдено.**

## Регрессия / прогон

```
npm test -- --run   → 284 test files passed (284), 3961 tests passed (3961)
npx tsc --noEmit    → чисто, пустой вывод
npm run lint        → 0 errors, 16 warnings (все pre-existing, ни один не в изменённых файлах —
                        совпадает построчно с baseline из docs/qa-reports/issue-620-qa-report.md)
npx next build      → успешно (exit 0); единственные warning/error в выводе — pre-existing,
                        не связаны с изменёнными файлами (src/instrumentation.ts edge-runtime
                        warnings, Cache-Control warning); ни admin/cafe, ни admin/dashboard
                        не упомянуты в списке проблем
```
`git status --short` после всех прогонов — пусто (рабочее дерево чистое).

## Итог
- Все 6 AC (по трём issue) — PASS.
- Батчинг корректен: три отдельные трекнутые задачи, найденные в процессе
  одной правки, в тех же файлах/функциях, генетически связаны, не
  произвольный набор.
- Схема (`Booking.deletedAt`, `ChatMessage.deletedAt`, `Order.deletedAt`)
  проверена лично по `prisma/schema.prisma`, а не по тексту issue;
  `Chat`/`Module` корректно не тронуты (нет поля `deletedAt`).
- Рефакторинг `admin/cafe/page.tsx` (`buildCafeOrdersWhere`/
  `getCafeOrdersData`) поведенчески эквивалентен исходному инлайн-коду
  (построчно сверено), пропорционален задаче (минимальная экстракция ради
  тестируемости, не редизайн), не ломает `next build`.
- Тесты пингуют каждую из трёх правок независимо (проверено рассуждением о
  том, что произошло бы при откате каждой `deletedAt: null`), мокинг не
  скрывает реальный код и предотвращает побочные импорты NextAuth-машинерии.
- Scope creep не найден — ровно заявленные 6 файлов.
- Security-инцидентов не найдено.
- Регрессия зелёная: тесты/tsc/lint/build.

**Вердикт: PASS.**

## Что хорошо
- Батч образцово документирован: каждый из трёх issue явно ссылается на
  #650 и на политику батчинга, коммит явно закрывает все три (`Closes #650,
  closes #660, closes #661`) — трассируемость идеальная.
- Верификация схемы (`Booking`/`ChatMessage`/`Chat`/`Module`) сделана не
  "на слово", а с явным обоснованием, почему `chat.count()`/`module.count()`
  корректно не тронуты — предотвращает будущий "лишний" фикс там, где бага нет.
- Рефакторинг cafe — минимально необходимый, с докстрингом, объясняющим
  зачем, и явной ссылкой на прецедент в том же PR.
- Тесты не тавтологичны — каждая новая ассерция реально пингует
  соответствующую строку фикса, не общий мок.

## Что исправить
Пунктов нет — вердикт PASS.

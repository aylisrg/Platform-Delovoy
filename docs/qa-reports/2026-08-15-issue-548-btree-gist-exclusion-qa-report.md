# QA Report: #548 — EXCLUDE USING gist DB-backstop против двойного бронирования

## Вердикт: PASS

## Источник правды

Нет отдельного PRD — P2-чор, без нового модуля, scope-guard допускает
fix/chore без product-owner PRD. AC взяты из тела issue #548 и задания на
верификацию. `code-reviewer` дал PASS в двух раундах (`docs/qa-reports/issue-548-round2-review.md`,
раунд 1 — по коммиту `8efd9cc2`, не сохранён отдельным файлом; раунд 2 —
после фикса наблюдаемости backstop'а). Ниже — независимая перепроверка:
код прогнан вживую на реальном Postgres 16, а не пересказан.

## Проверенные ветка/коммиты

- Ветка: `claude/issue-548-btree-gist-exclusion-constraint`
- `8efd9cc2` — миграция `EXCLUDE USING gist` + doc-комментарий в `schema.prisma`
- `e5042c10` — `handleOverlapBackstop()` + логирование ERROR, подключение во всех 9 местах, где `lockSlot()` охраняет запись
- `9e98cb7a` — `docs(qa)`: отчёт code-review раунда 2 (PASS)

`git diff main...HEAD --stat`: **9 файлов** (в задании на верификацию было
указано «7 файлов» — расхождение: фактически туда входят ещё
`docs/qa-reports/issue-548-round2-review.md` (артефакт самого code review,
попал в диапазон коммитов, не код) и `prisma/schema.prisma` (заявлен
отдельно в описании задачи, но не учтён в её же итоговой цифре). Разобрал
файл за файлом — состав ожидаемый, посторонних изменений нет:
`prisma/migrations/20260815000000_booking_no_overlap_exclusion/migration.sql`,
`prisma/schema.prisma` (+6/-0, только doc-комментарий на модели `Booking`,
без реформата остальной схемы), `src/modules/booking/slot-lock.ts`,
`src/modules/booking/restore.ts`, `src/modules/gazebos/service.ts`,
`src/modules/ps-park/service.ts`, `src/modules/booking/__tests__/slot-lock.test.ts`,
`src/modules/booking/__tests__/restore.test.ts`, плюс QA-документ. `CLAUDE.md`
не тронут (закономерно — не новый модуль, `booking`/`gazebos`/`ps-park` уже
в списке). Файлов `src/app/api/*` в диффе нет — подтверждено `grep`.

## Статические проверки

- `npm test -- --run`: **257/257 файлов, 3695/3695 тестов зелёные**.
- `npx tsc --noEmit`: чисто, без вывода.
- `npx eslint` на всех 6 изменённых `.ts`-файлов: 0 замечаний.
- `DATABASE_URL=... npx prisma validate`: `The schema at prisma/schema.prisma is valid`.
- `grep -riE 'password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key'` по всем 5 изменённым исходникам (миграция + 4 `.ts`) — 0 совпадений.

## AC1 — DB-level EXCLUDE constraint существует и зеркалит app-level overlap-семантику

**PASS.** Поднял локальный scratch Postgres 16 (роль `delovoy_test`, БД
`delovoy_test548` — то же имя, что использовали оба раунда code review),
прогнал `npx prisma migrate deploy` с `DATABASE_URL`, указывающим на scratch
БД — применилась вся история миграций, включая
`20260815000000_booking_no_overlap_exclusion` последней, без ошибок.

`\d+ "Booking"` и `pg_get_constraintdef` в psql подтвердили констрейнт
буква в букву как в описании задачи:

```
"booking_no_overlap" EXCLUDE USING gist ("moduleSlug" WITH =, "resourceId" WITH =,
  tsrange("startTime", "endTime") WITH &&)
  WHERE ((status = ANY (ARRAY['PENDING','CONFIRMED','CHECKED_IN']))
    AND ("deletedAt" IS NULL))
```

Колонки `startTime`/`endTime` — `timestamp(3) without time zone` (подтверждено
`\d+`), значит `tsrange` (не `tstzrange`) корректен технически, не просто по
утверждению в комментарии. Статус-лист `PENDING/CONFIRMED/CHECKED_IN`
идентичен `ACTIVE_BOOKING_STATUSES` в `state-machine.ts` (сверено построчно).

Также проверил заявление в комментарии миграции («`btree_gist` — trusted
extension с PG13, доступно без суперюзера»): создал отдельную БД с
владельцем-несуперюзером (`CREATEDB`, без `SUPERUSER`) и выполнил от его
имени `CREATE EXTENSION IF NOT EXISTS btree_gist` — прошло без ошибок,
`\dx` подтвердил установку. Утверждение в коде фактически верно, не просто
правдоподобно.

## AC2 — сценарная матрица: конфликт только на активных статусах, не на CANCELLED/COMPLETED (явное требование issue)

**PASS**, все 7 сценариев из задания на верификацию плюс 5 дополнительных
edge-cases, придуманных самостоятельно, — через прямой `psql` (не через
Prisma Client, не через код review round 1) в транзакциях с `ROLLBACK`
(конфликтные) / `COMMIT`+`DELETE` (неконфликтные):

| # | Сценарий | Ожидание | Факт |
|---|----------|----------|------|
| 1 | Пересекающиеся PENDING+CONFIRMED, тот же module+resource | конфликт | ✅ `ERROR: conflicting key value violates exclusion constraint` |
| 1b | Пересекающиеся CHECKED_IN+PENDING | конфликт | ✅ конфликт |
| 2 | Пересекаются, один CANCELLED | **не** конфликт | ✅ `COMMIT` без ошибки |
| 3 | Пересекаются, один COMPLETED | **не** конфликт | ✅ `COMMIT` без ошибки |
| 4 | Пересекаются, один NO_SHOW | **не** конфликт | ✅ `COMMIT` без ошибки |
| 5 | Пересекаются, оба активны, но один soft-deleted (`deletedAt` задан) | **не** конфликт | ✅ `COMMIT` без ошибки |
| 6 | Впритык (конец одной = начало другой) | **не** конфликт (полуоткрытый интервал) | ✅ `COMMIT` без ошибки |
| 7 | Тот же `resourceId`, разный `moduleSlug` | **не** конфликт (изоляция между модулями в общей таблице) | ✅ `COMMIT` без ошибки |
| 8 (own) | Одна бронь полностью включает другую (containment, не просто overlap границ) | конфликт | ✅ конфликт |
| 9 (own) | Идентичные start/end (полный дубликат интервала) | конфликт | ✅ конфликт |
| 10 (own) | `INSERT` CANCELLED без конфликта, затем `UPDATE status → CONFIRMED` в существующий overlap | конфликт **на UPDATE**, не только INSERT | ✅ конфликт при `UPDATE` |
| 11 (own) | Перенос брони через `UPDATE startTime/endTime` в чужой активный слот (реальный путь `rescheduleBooking`) | конфликт | ✅ конфликт |
| 12 (own) | Равенство `resourceId = ''` (пустая строка) на обеих строках | конфликт (equality-компаратор работает и на граничных значениях) | ✅ конфликт |

Сценарии 10 и 11 отдельно значимы: они подтверждают, что констрейнт
проверяется декларативно Postgres'ом на **любой** операции, меняющей
охваченные `WHERE`-условием строки (не только на `INSERT`) — то есть
реактивация `NO_SHOW → CHECKED_IN` через `UPDATE` (один из 9 подключённых
call-сайтов, `checkInBooking`) и `rescheduleBooking` (`UPDATE startTime/endTime`)
действительно попадают под защиту backstop'а, а не только создание новой
строки. Это прямо относится к заявленному покрытию всех 9 мест.

Явное требование issue («не должно давать ложных конфликтов на статусах
CANCELLED/COMPLETED») выполнено буквально плюс расширено на NO_SHOW и
soft-delete, которые логически входят в тот же принцип («не активная
бронь — не занимает слот»).

## AC3 — DB-backstop корректно взаимодействует с advisory-lock, наблюдаем при срабатывании (round-1→round-2 фикс)

**PASS.** Прочитал `src/modules/booking/slot-lock.ts` целиком —
`handleOverlapBackstop(error, moduleSlug, resourceId)` детектит срабатывание
через `error instanceof Prisma.PrismaClientUnknownRequestError &&
error.message.includes("booking_no_overlap")`, логирует `log.error("booking", ...)`
только при реальном совпадении, возвращает `boolean`. Тесты в
`slot-lock.test.ts` (4 новых кейса: реальная по форме exclusion-ошибка,
доменный `BookingError` — не путается, `PrismaClientKnownRequestError`
(P2002) — не путается, несвязанная `PrismaClientUnknownRequestError` — не
путается) — все зелёные, покрывают ровно матрицу false-positive/true-positive
детекции.

Проверил один call-site целиком (задание п.4) — `gazebos/service.ts`
публичный `createBooking`, строки 312–363: `const booking = await
prisma.$transaction(async (tx) => {...}).catch(async (err) => { if (await
handleOverlapBackstop(err, MODULE_SLUG, resourceId)) { throw new
BookingError("BOOKING_CONFLICT", ...); } throw err; });`. Обычный гоночный
конфликт кидается как `BookingError` **изнутри** callback'а `tx` — Prisma
перебрасывает исходный объект ошибки без обёртки, `.catch` получает
`BookingError`, `instanceof Prisma.PrismaClientUnknownRequestError` для него
`false`, `handleOverlapBackstop` возвращает `false` без логирования, и
`.catch` делает `throw err` — тот же самый `BookingError` летит наверх без
изменений. `booking.id` используется сразу после (строка 368) без
optional chaining — компилируется чисто, значит TS корректно вывел, что
catch-обработчик никогда не резолвится (все ветки — `throw`), тип `booking`
не расширился до `T | undefined`. Тот же паттерн (доменный класс ошибки
своего модуля: `BookingError`/`PSBookingError`/`BookingRestoreError`,
конструктор `(code, message, metadata?)`) — во всех 9 местах, сверено
`git diff` целиком по всем трём изменённым `service.ts`/`restore.ts`.

Единственное расхождение с идеальной наблюдаемостью — если backstop
реально сработает в проде (то есть advisory-lock кто-то обошёл), клиент
всё равно получит `BOOKING_CONFLICT`/`SLOT_TAKEN` как при обычной гонке, а
не отдельный код — это осознанное решение (см. коммит `e5042c10`: скрывать
внутреннюю природу бага от клиента, но не от мониторинга), задокументировано
в комментарии к функции, не баг.

## AC4 — тесты покрывают детекцию/недетекцию, регресс не внесён

**PASS.** `restore.test.ts`: мок `../slot-lock` дополнен
`handleOverlapBackstop: vi.fn(async () => false)` — без этого тест
`restoreBooking` упал бы (реальный экспорт не замокан → `undefined` не
функция). Проверил тест `"блокирует восстановление, если слот успели
пересдать"` — это путь обычного app-level конфликт-чека
(`tx.booking.findFirst` → `BookingRestoreError("SLOT_TAKEN", ...)`), backstop
здесь не участвует (мок возвращает `false`), тест не изменил свою
семантику, просто перестал падать на нехватке мока.

## Полный прогон и cleanup scratch-окружения

- `service postgresql status` перед началом — уже online, посторонних
  scratch БД/ролей от прошлых раундов не осталось (`\l`/`\du` — чисто,
  только `delovoy`/`postgres`).
- Создал `delovoy_test`/`delovoy_test548` (SUPERUSER — для скорости, плюс
  отдельно `delovoy_nosuper`/`delovoy_test548_nosuper` без SUPERUSER — для
  проверки заявления про trusted extension).
- По окончании: `DROP DATABASE delovoy_test548`, `DROP DATABASE
  delovoy_test548_nosuper`, `DROP ROLE delovoy_test`, `DROP ROLE
  delovoy_nosuper` — подтверждено `\l`/`\du` после дропа: осталось ровно то
  же, что было до старта (`delovoy`, `postgres`, `template0/1`). Ничего не
  оставлено висеть.
- `git status` в репозитории — `nothing to commit, working tree clean`
  и до, и после всей проверки (миграция гоняется на scratch БД, репозиторий
  не трогается).

## Security-чеклист (agents/qa.md / SECURITY.md)

Изменение не добавляет и не меняет ни одного HTTP-эндпоинта, RBAC-проверки
не затрагиваются — `src/app/api/*` в диффе нет (подтверждено `grep`).

- **RBAC**: N/A — новых/изменённых route.ts нет, поверхность авторизации не
  тронута.
- **Data leakage**: `handleOverlapBackstop` логирует только `moduleSlug`/
  `resourceId` (внутренние идентификаторы, не PII) на уровне `ERROR` →
  `SystemEvent` → Telegram admin group (см. таблицу мониторинга в
  `CLAUDE.md`) — не публичный канал. `grep` по секретным паттернам — 0
  совпадений во всех изменённых файлах.
- **Injection**: детекция — `error.message.includes("booking_no_overlap")`,
  литеральная подстрока на строке ошибки, которая никуда не идёт обратно в
  запрос к БД; RAW SQL в миграции — статический DDL без пользовательского
  ввода.
- **Supply chain**: новых зависимостей нет.
- **Опасные операции**: миграция аддитивная (`CREATE EXTENSION IF NOT
  EXISTS` + `ADD CONSTRAINT`), не `DROP`/`TRUNCATE`/`DELETE` — не попадает
  под ручной мерж по правилу CLAUDE.md о деструктивных миграциях.

## Регрессия

`npm test -- --run` — 257/257 файлов, 3695/3695 тестов, включая полный
`slot-lock.test.ts` и `restore.test.ts`, а также все смежные
`gazebos`/`ps-park` `service.test.ts` (конфликт-кейсы на обычном
app-level пути не изменили поведение — подтверждено и трассировкой кода, и
тем, что эти тесты прошли без модификаций). `npx tsc --noEmit` и `npx
eslint` на изменённых файлах — чисто.

## Итог

DB-backstop работает буквально как заявлено: EXCLUDE-констрейнт создаётся
миграцией, применяется через `prisma migrate deploy` без ошибок, статусный
`WHERE`-фильтр 1:1 совпадает с `ACTIVE_BOOKING_STATUSES`, полуоткрытый
интервал не даёт ложных срабатываний на стыкующихся бронях, cross-module
изоляция по общей таблице сохранена. Явное требование issue («не должно
давать ложных конфликтов на CANCELLED/COMPLETED») подтверждено на реальном
Postgres 16 прямым `psql`, не косвенно — плюс расширено собственной
проверкой на NO_SHOW, soft-delete, `UPDATE`-путях (реактивация/reschedule) и
containment-overlap; ни одного отклонения от ожидаемого поведения не найдено
ни в одном из 12 сценариев. Round-1→round-2 фикс наблюдаемости backstop'а
(`handleOverlapBackstop` + `log.error`) подключён во всех 9 заявленных
местах, не меняет поведение обычного app-level конфликт-пути (трассировка
типов и рантайм-поведения подтверждают, что `.catch` всегда либо
перебрасывает исходную ошибку без изменений, либо превращает реальное
срабатывание backstop'а в тот же доменный код конфликта, что и обычная
гонка). Тесты/типы/lint/schema validate — все чисто. Единственное найденное
расхождение — цифра «7 файлов» в задании на верификацию против фактических
9 в диффе; не блокер (лишние 2 файла — `schema.prisma`, упомянутый отдельно
в самом задании, и QA-документ раунда 2 review, оба легитимны и без
проблем).

## Результат

- Проверено AC: 4 (DB-констрейнт корректен / сценарная матрица / observability backstop'а / регресс тестов)
- PASS: 4
- FAIL: 0
- Security-кейсы: 5/5 PASS (или N/A с обоснованием)
- Замечания не блокирующие: 1 (расхождение в счёте файлов в задании на верификацию, не в самом коде)

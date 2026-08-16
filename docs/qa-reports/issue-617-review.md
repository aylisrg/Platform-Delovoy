# Review: test(cron) — route-тесты для 9 непокрытых cron-роутов (issue #617)

## Вердикт: PASS

Branch: `claude/issue-617-cron-route-tests`, commit `51fd5bc59b441c5fc7ac40f3ffbdedef77180b7b`, based directly on current `main` (one commit ahead, `main` is an ancestor of HEAD).

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| Все 9 роутов из списка issue покрыты тестами | PASS | `no-show`, `inventory`, `avito-account-sync`, `avito-messenger-poll`, `avito-stats-sync`, `payments-reconcile`, `process-outgoing`, `process-recurring`, `rental-payment-reminders` — все 9 имеют `__tests__/route.test.ts`. `find src/app/api/cron -name route.ts \| wc -l` = 12, `route.test.ts` = 12 — полное покрытие директории. |
| Auth-gate тесты соответствуют реальной логике каждого роута (не скопированы бездумно с соседа) | PASS | Построчно сверил все 9 `route.ts` с их тестами (см. ниже) — каждый auth-паттерн (Bearer-only, `?token=`-only, оба, `safeCompare` vs `!==`, `CRON_SECRET`-only vs `??NEXTAUTH_SECRET` fallback, 401 vs 503) отражён верно. |
| Happy-path + service-error path на каждый роут | PASS | Во всех 9 файлах есть тест на happy path (со значимыми assertions на аргументы вызова сервиса и тело ответа, не только `status===200`) и тест на 500 при исключении в сервисной функции. |
| Zero production code changes | PASS | `git diff main...HEAD --stat`: 9 файлов, все `__tests__/route.test.ts`, 907 insertions, 0 deletions, ни одного `route.ts` не тронуто. |
| Существующие тесты 3 уже покрытых роутов не изменены | PASS | Diff содержит исключительно 9 новых файлов; `avito-reviews-sync`, `notifications`, `overdue-session-reminders`'s existing test files отсутствуют в diff. |
| `npm test` зелёный | PASS | 280 test files / 3912 tests passed — совпадает с заявленным baseline. |
| `tsc --noEmit` чист | PASS | Пустой вывод, без ошибок. |
| `npm run lint` — 0 errors | PASS | `0 errors, 16 warnings` — все 16 warnings в файлах, не относящихся к этому PR (React hooks эффекты в `payments/[id]/page.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, unused vars в `messenger/types.ts`, `telephony/novofon-client.ts` и т.д.) — предсуществующие, не внесены этим диффом. |

## Детальная сверка auth-логики (route.ts vs test)

1. **`no-show`** (`src/app/api/cron/no-show/route.ts:22-28`) — Bearer-only, `!cronSecret || authHeader !== \`Bearer ${cronSecret}\`` → 401. Тест `makeReq()` строит только `Authorization` header, нет `?token=` кейса — верно отражает реальность (роут не читает query param). Missing header → 401, wrong token → 401, missing `CRON_SECRET` → 401 (не 503) — всё совпадает с веткой `!cronSecret || ...` в одном `if`.
2. **`no-show` mock-классы `PSBookingError`/`BookingError`** — сверил с реальными классами в `src/modules/ps-park/service.ts:2192-2201` и `src/modules/gazebos/service.ts:1820-1829`: `constructor(code: string, message: string, metadata?) { super(message); this.code = code; ... }`. Мок в тесте (`constructor(code, message) { super(message); this.code = code; }`) сохраняет ключевое поведение — `.message` действительно устанавливается из **второго** аргумента через `super(message)`, а не из первого (`code`). Тест `"captures a per-candidate PSBookingError..."` (`no-show/__tests__/route.test.ts:109-121`) с ассертом `errors: ["b-ps-1: already checked in"]` — реальное поведение, не артефакт неверного мока.
3. **`inventory`** — `?token=`-only, `CRON_SECRET ?? NEXTAUTH_SECRET`, `!token || token !== cronSecret` → 401. Тест покрывает missing/wrong token, fallback на `NEXTAUTH_SECRET`, условную запись `systemEvent.create` только при `daysUntilExpiry <= 0` (тест с двумя батчами: один `-1`, другой `3` — корректно проверяет фильтр `trueExpired`).
4. **`avito-account-sync`** — `?token=`-only (`CRON_SECRET ?? NEXTAUTH_SECRET`), GET+POST оба вызывают `run()`, гейт `AVITO_CRON_ENABLED==="true"` → `{skipped:true}`. Всё покрыто. Незначительная деталь: `makeReq()` жёстко ставит `method: "GET"` даже в POST-тестах (`avito-account-sync/__tests__/route.test.ts:74-84`) — не баг (роут не читает `request.method`, вызывается явно импортированный `POST`), но стилистически можно было бы сделать честный `method: "POST"` для читаемости. Не блокирует.
5. **`avito-messenger-poll`** — 3 независимых skip-условия (`AVITO_CRON_ENABLED`, `pollEnabled`, `avitoUserId`) все протестированы отдельно с проверкой `body.data.reason`. `idempotent:true` → `skipped++`, иначе `processed++` — тест `"counts idempotent...as skipped, not processed"` проверяет именно это разделение. Тест на sбой роутинга одного сообщения (`route.test.ts:131-150`) — `mockedCreateEvent.mockResolvedValue(undefined)` в `beforeEach`, так что `.catch(()=>undefined)` в самом роуте (`route.ts:84-96`) не маскирует поведение теста; assert `mockedCreateEvent).toHaveBeenCalledTimes(1)` и `processed:0, skipped:0` корректно проверяют, что цикл продолжается после ошибки одного сообщения.
6. **`avito-stats-sync`** — гейт `AVITO_CRON_ENABLED`, `prisma.avitoItem.findMany({where:{status:"ACTIVE",deletedAt:null}})` (тест явно проверяет `where`-clause), `refreshItemSnapshot(id, avitoItemId, period)` для `"7d"`+`"30d"` на каждый item, частичный сбой не прерывает цикл (`snapshotsOk`/`snapshotsFailed`) — все отражено верно.
7. **`payments-reconcile`** — `safeCompare`, secret = `CRON_SECRET ?? NEXTAUTH_SECRET ?? ""`, `!cronSecret || !safeCompare(...)` → единый 401-бранч. Тест `"returns 401 when CRON_SECRET is not configured..."` (комментарий в тесте явно упоминает "no fallback that leaks an empty-secret bypass") — корректно проверяет, что пустой secret не проходит `safeCompare("", "")`-подобный обход. Отдельный тест на Bearer header (не только `?token=`) присутствует.
8. **`process-outgoing`** — единственный роут с явным ранним `if (!cronSecret) return 503` ДО сравнения токена (`route.ts:17-20`), secret = `CRON_SECRET` без fallback. Тест `"returns 503 when CRON_SECRET is not configured"` отдельно от `"returns 401 when token is missing or wrong"` — правильно различает 503 (нет секрета) и 401 (неверный токен при настроенном секрете). Это самый рискованный с точки зрения "copy-paste ошибки" роут в списке, и тест явно НЕ скопирован с соседей.
9. **`process-recurring`** — единственный роут с plain `!==` (без `safeCompare`), secret = `CRON_SECRET ?? NEXTAUTH_SECRET`. Тест не тестирует timing-safety (что и не нужно — раз в проде используется `!==`, тестировать нечего), но покрывает оба способа передачи токена (Bearer/query) и fallback на `NEXTAUTH_SECRET`.
10. **`rental-payment-reminders`** — `safeCompare`, `CRON_SECRET ?? NEXTAUTH_SECRET ?? ""`, тот же 401-для-пустого-секрета паттерн, что и `payments-reconcile`. Корректно отражено.

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — ровно 9 файлов, все `__tests__/route.test.ts`, ни один `route.ts` не тронут (`git diff main...HEAD --stat` подтверждает 0 изменений production-кода)
- Новых зависимостей в `package.json`/`package-lock.json`: нет

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` чист)
- Мокинг: OK — сверил импорты каждого `route.ts` против `vi.mock(...)` в соответствующем тесте, лишних/недостающих моков нет, ни один тест не может случайно попасть в реальный Prisma/Redis/HTTP вызов
- Тесты: OK — happy path + auth-gate + service-error на каждый роут, assertions проверяют не только status code, но и аргументы вызова сервисных функций и точное содержимое `body.data`
- Нет `.only`/`.skip`/`xdescribe` — подтверждено grep'ом (совпадения были только на текст `body.data.skipped`, не на API тест-раннера)

## Безопасность

### Secrets leakage
- Grep по `(password|token|secret|nextauth|telegram.*token|api[_-]key)` в новых тест-файлах — совпадения только на служебные строки типа `"test-cron-secret"`, `"auth-secret"`, имена переменных `cronSecret`/`token` и текст ассертов ("Invalid cron token" и т.п.). Реальных credential'ов не обнаружено.
- `.env*` не затронут

### RBAC
- Не применимо — все 9 роутов используют cron-secret-token авторизацию (не session-based RBAC), в `route.ts` этих роутов нет `hasRole`/`hasModuleAccess`/`session.user` вызовов (подтверждено grep по всем 9 файлам) — это соответствует архитектуре cron-эндпоинтов в остальной кодовой базе (см. уже покрытые `notifications`, `overdue-session-reminders`, `avito-reviews-sync`). PR ничего не меняет в этой области — RBAC-чеклист корректно вне скоупа этой чисто тестовой задачи.

### Supply chain
- Новых зависимостей нет

### Injection
- Не применимо — тесты, продакшн-код не менялся; в самих роутах нет raw SQL/`dangerouslySetInnerHTML`

### Dangerous ops
- Нет опасных команд в новых файлах

**Инцидентов не найдено.**

## Что хорошо
- Тесты не скопированы бездумно — 4 разных auth-паттерна (Bearer-only, `?token=`-only, оба; `safeCompare` vs `!==`; 401-для-всего vs явный 503-для-незаданного-секрета) протестированы каждый под свою реальную реализацию, включая самый рискованный случай (`process-outgoing`'s 503-ранний-выход).
- Assertions содержательные: проверяются аргументы вызова сервисных функций (`toHaveBeenCalledWith`) и точное содержимое `body.data`, а не только `status === 200` — снижает риск "прошёл по случайной причине".
- Мок-классы ошибок в `no-show` тесте реально соответствуют сигнатуре конструктора продакшн-классов — проверено чтением исходников `ps-park/service.ts`/`gazebos/service.ts`, а не доверием к комментарию в issue.
- Diff строго аддитивный, commit message подробно документирует, чем каждый роут отличается от соседей по auth — хорошая трассируемость решений.

## Незначительные замечания (не блокируют)
- В `avito-account-sync`, `avito-messenger-poll`, `avito-stats-sync` тестах общая helper-функция `makeReq()` жёстко прописывает `method: "GET"` даже когда используется для POST-тестов (например `avito-account-sync/__tests__/route.test.ts:74-84`). Функционально не баг — роуты не читают `request.method`, и вызывается явно импортированная `POST`-функция — но стоило бы завести `method: "POST"` для честности читаемого intent'а теста при следующей правке этих файлов.

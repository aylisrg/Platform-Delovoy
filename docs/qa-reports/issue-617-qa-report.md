# QA-отчёт: Issue #617 — route-тесты для 9 непокрытых cron-роутов

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-617-cron-route-tests`, HEAD `100ab19`, поверх `main` (main —
  предок HEAD). Два коммита:
  - `51fd5bc` — фича: 9 новых `__tests__/route.test.ts` (907 insertions, 0 deletions).
  - `100ab19` — фикс по замечанию code review: `makeReq()` в 3 файлах
    (`avito-account-sync`, `avito-messenger-poll`, `avito-stats-sync`) хардкодил
    `method: "GET"` даже внутри `describe("POST ...")`-блоков; теперь параметризован
    (`method: "GET" | "POST" = "GET"`, POST-тесты передают `"POST"` явно).
- Формальной PRD в `docs/requirements/` нет — чистая тестовая инфраструктурная задача
  (аналогично issue #616), не продуктовая фича. Acceptance criteria взяты из текста
  issue #617, как приведено в постановке задачи.
- `docs/qa-reports/issue-617-review.md` уже на диске (написан Reviewer'ом, вердикт
  PASS) — прочитан, использован как ориентир, но не как источник истины: ниже —
  независимая проверка с собственными adversarial-сценариями и намеренной поломкой
  кода, не просто повторение выводов ревью.

## Регрессия (шаг 1)
```
npm test -- --run                    → 280 test files, 3912/3912 passed, 0 failed
                                        (= заявленный baseline, совпадает точно)
npx tsc --noEmit                     → чисто, пустой вывод
npm run lint                         → 0 errors, 16 pre-existing warnings — идентичный
                                        список файлам из issue-615/616/622-отчётов
                                        (session-bill-modal.tsx, sidebar.tsx,
                                        vk-community-banner.tsx, ChatWindow.tsx,
                                        MessageBubble.tsx, useChatList.ts,
                                        messenger/types.ts, notifications/service.ts,
                                        telephony/novofon-client.ts) — ни один не в
                                        файлах этого PR
```

## Cron-директория целиком (шаг 2)
```
npx vitest run src/app/api/cron      → 12 test files, 80/80 passed
```
Совпадает точно с заявленным (9 новых + 3 baseline: `avito-reviews-sync`,
`notifications`, `overdue-session-reminders`). `find src/app/api/cron -name
route.ts | wc -l` = 12, `route.test.ts` = 12 — полное покрытие директории
подтверждено независимо.

## Acceptance Criteria (из текста issue #617)

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | Все 9 роутов покрыты тестами | PASS | `no-show`, `inventory`, `avito-account-sync`, `avito-messenger-poll`, `avito-stats-sync`, `payments-reconcile`, `process-outgoing`, `process-recurring`, `rental-payment-reminders` — все 9 имеют `__tests__/route.test.ts`, все зелёные. |
| 2 | Auth-gate тесты соответствуют реальной логике каждого роута | PASS | Прочитал `route.ts` side-by-side с тестом самостоятельно для 3 из 9 (см. «Пункт 3 задания» ниже), плюс намеренно сломал auth-логику в двух дополнительных роутах и подтвердил, что тесты реально падают на конкретной ветке, а не тавтологичны (см. «Пункт 4 задания»). |
| 3 | Happy-path + service-error path на каждый роут | PASS | Проверено чтением всех 9 файлов: в каждом есть тест на happy path с содержательными assertions (`toHaveBeenCalledWith`, точное содержимое `body.data`) и тест на 500 при исключении сервисного слоя. |
| 4 | Zero production code changes | PASS | `git diff main...HEAD --stat` — 9 файлов, все `__tests__/route.test.ts`, ни одного `route.ts`/`src/modules/**` не тронуто (см. «Пункт 5 задания»). |
| 5 | Существующие тесты 3 уже покрытых роутов не изменены | PASS | Diff не содержит `avito-reviews-sync`, `notifications`, `overdue-session-reminders` — их тесты не в диффе. |
| 6 | `npm test` зелёный | PASS | 280/280 файлов, 3912/3912 тестов — см. «Регрессия». |
| 7 | `tsc --noEmit` чист | PASS | Пустой вывод. |
| 8 | `npm run lint` — 0 errors | PASS | 0 errors, 16 pre-existing warnings, не в файлах PR. |
| 9 (review-фикс, `100ab19`) | `makeReq()` честно передаёт `method` в POST-тестах трёх avito-роутов | PASS | Проверил диф коммита `100ab19` построчно — сигнатура `makeReq(token, method: "GET" | "POST" = "GET")`, все 3 POST-describe вызывают с `"POST"` явно, GET-вызовы не тронуты (используют дефолт). Функционально не меняет поведение (роуты не читают `request.method`, вызывается напрямую импортированная `POST`-функция) — чисто читаемость, как и было заявлено. |

## Пункт 3 задания — самостоятельная построчная сверка (не со слов ревью)

Выбрал 3 самых рискованных роута из подсказки задания и прочитал `route.ts` +
`route.test.ts` side-by-side лично, без доверия к чужому выводу:

1. **`no-show`** (`src/app/api/cron/no-show/route.ts:22-28`) — единственная проверка:
   `!cronSecret || authHeader !== \`Bearer ${cronSecret}\`` → 401. Роут **вообще не
   читает** `request.nextUrl.searchParams` — `?token=` физически не может сработать.
   Существующий тест-файл (`no-show/__tests__/route.test.ts`) при этом не содержит
   явного кейса «валидный `?token=`, без Authorization header → отклонён» — он
   тестирует только missing/wrong Bearer и missing-secret. Написал свой adversarial
   тест (временный файл, удалён после), см. «Пункт 3 задания — свой сценарий» ниже —
   подтвердил экспериментально на реальном коде, что query-токен действительно
   игнорируется и запрос отклоняется 401. **Минорная находка**: это не баг (роут
   ведёт себя как задокументировано в issue — Bearer-only), но существующий тест-файл
   не покрывает этот конкретный сценарий explicitly — не блокирует вердикт, детали в
   разделе «Что не идеально» ниже.

2. **`process-outgoing`** (`src/app/api/cron/process-outgoing/route.ts:16-28`) —
   единственный роут с явным ранним `if (!cronSecret) return 503` **до** вызова
   `safeCompare`. Тест `"returns 503 when CRON_SECRET is not configured"` и
   `"returns 401 when token is missing or wrong"` — два раздельных `it()`-блока с
   разными ожидаемыми `res.status` (503 vs 401) и разными `body.error.code`
   (`SERVICE_UNAVAILABLE` vs `UNAUTHORIZED`). Экспериментально подтвердил (см.
   «Пункт 4 задания»), что это два генуинно разных пути, не тавтология: подменил
   код роута так, чтобы неверный токен тоже возвращал 503 (симулируя ровно тот баг,
   которого опасался reviewer) — тест `"returns 401 when token is missing or
   wrong"` немедленно упал с `expected 503 to be 401`.

3. **`avito-messenger-poll`** (`src/app/api/cron/avito-messenger-poll/route.ts:56-99`)
   — цикл по `chats`, внутри — цикл по `messages`, `routeInboundMessage()` обёрнут в
   `try/catch` **внутри внутреннего цикла** (не снаружи всего роута), сбой одного
   сообщения логируется в `SystemEvent` и не прерывает ни цикл сообщений, ни цикл
   чатов. Существующие тесты покрывают single-chat single-message failure. Написал
   собственный двух-чатовый сценарий (не переиспользуя данные из сьюта — см. ниже) —
   подтвердил на реальном роуте, что чат #2 корректно обрабатывается после падения
   маршрутизации сообщения в чате #1, и итоговые счётчики (`processed`/`skipped`)
   точны.

### Свой adversarial-сценарий для `no-show` (запущен, удалён, `git status` чист)
Временный тест-файл `zzz-adversarial-temp.test.ts` в `no-show/__tests__/`:
запрос `GET /api/cron/no-show?token=test-cron-secret` **без** `Authorization`
header → ожидание 401 + `findAutoNoShowCandidates` не вызван.
**Результат: PASS на реальном (немодифицированном) коде** — подтверждает, что
роут действительно не принимает query-токен ни при каких условиях, соответствует
заявленному в issue поведению «Bearer-only, no `?token=`».

### Свой adversarial-сценарий для `avito-messenger-poll` (запущен, удалён, `git status` чист)
Временный тест-файл: 2 чата (`c1`, `c2`), `listMessages("c1")` возвращает сообщение,
которое `routeInboundMessage` **отклоняет исключением** (`"routing failed for
chat1"`), `listMessages("c2")` возвращает другое сообщение, которое роутится
успешно (`idempotent: false`). Ожидание: цикл не прерывается на `c1`,
`listMessages`/`routeInboundMessage` вызваны **дважды** каждый (по разу на чат),
`systemEvent.create` — 1 раз (для упавшего сообщения), итоговый `body.data` —
`{ chats: 2, processed: 1, skipped: 0 }`.
**Результат: PASS на реальном коде** — подтверждает независимо от существующего
сьюта, что многочатовый частичный сбой обрабатывается корректно, счётчики не
искажаются падением одного сообщения.

## Пункт 4 задания — намеренная поломка кода (3 эксперимента, все обратимы)

Все три эксперимента: правка `route.ts` → прогон `npx vitest run <директория>` →
подтверждение конкретного падения → восстановление файла из копии →
`git status --porcelain` пуст после каждого (кроме untracked
`docs/qa-reports/issue-617-review.md`, не относящегося к экспериментам).

1. **`no-show`: убрал per-candidate `try/catch`** (оставил голый `await
   markNoShowPS(...)`/`markNoShowGazebos(...)` без обёртки). Результат:
   `npx vitest run src/app/api/cron/no-show` → **3 из 7 тестов упали** — именно те
   3, что проверяют error-capturing (`PSBookingError`, `BookingError`, non-Error
   rejection), с реальным необработанным исключением, всплывающим из `GET()`.
   Остальные 4 (happy path, 3 auth-кейса) прошли без изменений — падение точечное,
   не «весь файл красный».

2. **`avito-account-sync`: убрал `AVITO_CRON_ENABLED`-гейт целиком** (условие +
   ранний `return apiResponse({skipped:true,...})` удалены, `syncItemsRegistry()`
   вызывается безусловно). Результат: `npx vitest run
   src/app/api/cron/avito-account-sync` → **1 из 7 тестов упал** — именно
   `"skips sync when AVITO_CRON_ENABLED is not 'true'"`, с `expected undefined to
   be true` на `body.data.skipped` (гейт больше не возвращает `skipped`, роут идёт
   прямо до `syncItemsRegistry`). Остальные 6 прошли.

3. **`process-outgoing`: заменил 401-ветку `safeCompare`-провала на 503**
   (`SERVICE_UNAVAILABLE` вместо `UNAUTHORIZED`, ровно тот тавтологичный баг из
   пункта 3 выше). Результат: `npx vitest run src/app/api/cron/process-outgoing` →
   **1 из 5 тестов упал** — `"returns 401 when token is missing or wrong"`,
   `expected 503 to be 401`. Тест на «503 when CRON_SECRET is not configured»
   продолжил проходить (эта ветка не тронута), что доказывает: тесты
   действительно различают два разных условия, не совпадают случайно.

Все три поломки подтверждают: тесты не тавтологичны, они реально зависят от
конкретной бизнес-логики роута и падают именно на изменённом участке, не на всём
файле целиком. После каждого эксперимента `route.ts` восстановлен из копии в
scratchpad, `git diff --stat` по затронутому файлу — пусто, полный `npm test`
после всех экспериментов — снова 280/280 test files, 3912/3912 tests, `git
status --porcelain` — только untracked `docs/qa-reports/issue-617-review.md`.

## Пункт 5 задания — Zero production code changes

```
git diff main...HEAD --stat
```
9 файлов изменены, все `.../__tests__/route.test.ts`, `907 insertions(+), 0
deletions(-)`. Ни одного файла под `src/app/api/cron/*/route.ts`, ни одного под
`src/modules/**`. `git log main..HEAD --oneline` — 2 коммита (`51fd5bc`,
`100ab19`), оба ограничены теми же 9 тестовыми файлами (второй коммит правит
подмножество из первых трёх avito-файлов — `git show 100ab19 --stat` показывает
3 файла, +10/-10 строк, чистая параметризация `makeReq()`, никакой новой логики).

## Пункт 6 задания — RBAC / Security

- Все 9 роутов — cron-эндпоинты, авторизация исключительно по shared-secret
  токену (`CRON_SECRET`/`NEXTAUTH_SECRET` через query `?token=` и/или Bearer
  header), **не** session-based. Подтверждено независимым grep:
  ```
  grep -rn "hasRole\|hasModuleAccess\|auth()\|session\.user" <все 9 route.ts>
  → NO MATCHES
  ```
  Функциональные RBAC-тест-кейсы из чеклиста `agents/qa.md` (USER/MANAGER/
  SUPERADMIN/анонимный) сюда неприменимы по архитектуре — это не эндпоинты для
  залогиненных пользователей, это внутренние cron-триггеры за общим секретом,
  как и уже покрытые ранее `notifications`/`overdue-session-reminders`/
  `avito-reviews-sync`. Явно фиксирую это, а не молча пропускаю пункт.
- **Rate limiting**: не применимо — cron-роуты не публичные, вызываются только
  host-cron'ом/GitHub Actions с известным секретом, не подпадают под
  `RATE_LIMIT_PUBLIC_PER_MIN`/`RATE_LIMIT_AUTH_PER_MIN` по архитектуре (как и
  остальные 3 baseline-роута в этой же директории).
- **Input validation**: единственный пользовательский вход — сам токен
  (строка). Zod здесь не нужен — сравнение либо `safeCompare` (timing-safe,
  4 роута), либо plain `!==`/`token !== cronSecret` (остальные) — соответствует
  заявленному в issue распределению по роутам, каждое подтверждено чтением.
- **Data leakage**: тесты не логируют и не возвращают реальные секреты — grep
  по `password|secret|token|nextauth|api[_-]key` в новых файлах даёт только
  служебные строки-заглушки (`"test-cron-secret"`, имена переменных). `.env*`
  не затронут.
- **Secrets в артефактах**: сам этот отчёт и `docs/qa-reports/issue-617-review.md`
  не содержат реальных credential'ов — только тестовые строки-заглушки.

## Что не идеально (не блокирует вердикт)

1. Существующий тест-файл `no-show/__tests__/route.test.ts` не содержит explicit
   теста «`?token=` query param с валидным значением, БЕЗ Authorization header →
   отклонён» — этот сценарий существует только в моём временном adversarial-тесте
   (удалён после проверки). Функционально роут ведёт себя корректно (подтверждено
   экспериментально), но если бы кто-то по ошибке добавил query-token fallback в
   `no-show/route.ts` в будущем PR, текущий сьют бы это не поймал — только явное
   отсутствие вызова `findAutoNoShowCandidates` в остальных auth-тестах косвенно
   подразумевает это. Minor gap в explicit-покрытии, не логическая ошибка текущего
   PR — не то же самое, что «тест врёт»; тест просто не проверяет этот конкретный
   негативный сценарий explicitly. Не заводил отдельную issue — слишком мелко для
   отдельного тикета, стоит упоминания только для полноты отчёта.
2. Review уже отметил стилистический nit про `makeReq()` — исправлен в `100ab19`,
   проверено построчно (AC-9 выше), фикс корректен и не меняет поведение тестов
   (все 12/12 файлов cron-директории по-прежнему зелёные после фикса).

## Итог
- AC (из текста issue #617 + review-фикс): 9
- PASS: 9
- FAIL: 0
- Регрессия: `npm test` 3912/3912 (280 файлов), `npx tsc --noEmit` чисто,
  `npm run lint` 0 errors / 16 pre-existing warnings (не в файлах PR),
  `npx vitest run src/app/api/cron` 80/80 (12 файлов) — все baseline-числа
  совпадают точно с заявленными.
- Собственное adversarial-тестирование (не переиспользование тестов PR):
  подтверждено, что `no-show` реально игнорирует `?token=` (Bearer-only);
  подтверждено, что `process-outgoing` реально различает 503 (нет секрета) и
  401 (неверный токен) как два разных кода, не совпадающих случайно;
  подтверждено на своём двух-чатовом сценарии, что `avito-messenger-poll`
  продолжает обработку после падения одного сообщения и держит точные счётчики.
- Намеренная поломка кода (3 эксперимента, все обратимы, `git status` чист
  после каждого): убранный `try/catch` в `no-show` уронил ровно 3 из 7 тестов;
  убранный `AVITO_CRON_ENABLED`-гейт в `avito-account-sync` уронил ровно 1 из 7;
  конфляция 401→503 в `process-outgoing` уронила ровно 1 из 5, не тронув
  соседний 503-тест. Тесты не тавтологичны.
- Production code: `git diff main...HEAD --stat` — 9 файлов, все
  `__tests__/route.test.ts`, 0 изменений в `route.ts`/`src/modules/**`.
- RBAC/Security: session-based RBAC неприменим к этим роутам (подтверждено
  grep — 0 совпадений `hasRole`/`hasModuleAccess`/`auth()`/`session.user` во
  всех 9 файлах), явно отмечено, а не молча пропущено. Rate limiting/Zod/data
  leakage — неприменимы или подтверждены безопасными по тем же причинам, что и
  для 3 baseline-роутов этой директории.
- Единственная находка — минорный gap в explicit-покрытии одного негативного
  сценария в `no-show` (см. «Что не идеально» п.1), функционально не баг,
  не блокирует.

**Вердикт: PASS.** Реализация закрывает issue #617 полностью: все 9 заявленных
роутов покрыты content-содержательными тестами (auth-gate + happy path +
service-error path), auth-логика каждого роута независимо сверена с реальным
кодом (не скопирована бездумно с соседа), тесты доказано не тавтологичны —
подтверждено намеренной поломкой трёх разных участков кода в трёх разных
роутах, каждая поломка уронила ровно ожидаемое подмножество тестов. Production
code не тронут. Review-фикс (честный `method` в `makeReq()`) корректен и не
меняет поведение. RBAC явно неприменим по архитектуре cron-роутов, что
зафиксировано, а не пропущено молча. Регрессия и baseline-числа совпадают
точно с заявленными на каждом шаге.

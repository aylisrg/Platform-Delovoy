# Review: реестр SystemEvent.source и миграция прямых записей на logger.ts (#581)

## Вердикт: PASS

## Контекст

Issue #581 — F4 находка аудита `docs/architecture/2026-08-14-autonomous-dev-pipeline-audit.md`:
`SystemEvent.source` был свободной строкой, имена дрейфовали (`scheduler` vs `rental.scheduler`,
`cron/inventory` vs `cron.notifications`, точки vs слэши), что размывало группировку по source в
спайк-детекции; ~20 колл-сайтов писали напрямую в обход `src/lib/logger.ts`, теряя console-fallback.

Нет отдельного PRD/ADR/context (RUN_ID = `issue-581`) — это задача из автоочереди `/next-issue`,
источник правды — текст issue + F4-находка аудита. Эталон архитектуры — существующий паттерн
ESLint-правила для `toLocaleDateString`/`format.ts` (ADR 2026-04-23) и сам `src/lib/logger.ts`.

Одна коммита ветка `claude/issue-581-event-source-registry` = `main` (`02e9912`) + 1 коммит
(`52209f2`), без расхождений (`git merge-base` совпадает с `main`).

## Acceptance Criteria (из текста issue #581)

| AC | Статус | Комментарий |
|----|--------|-------------|
| Новый `src/lib/event-sources.ts` с типизированными константами (`domain.subdomain`) | PASS | 35 констант, `EVENT_SOURCES` + `EventSource` union. Часть значений намеренно без точки (`client-beacon`, `rate-limit`, `server-error`, `release-notify`, `reviews-parser`) — задокументировано в шапке файла как «НЕ переименовывать», см. AC ниже |
| `logEvent`/`log.*` принимают `EventSource` вместо `string` | PASS | `src/lib/logger.ts:13,68,98-107` — все сигнатуры (`logEvent`, `alertCritical`, `log.info/warn/error/critical`) типизированы через `EventSource` |
| Миграция прямых `prisma.systemEvent.create`/`tx.systemEvent.create` на `logger.ts`, кроме мест внутри `$transaction` | PASS | Независимый grep `.systemEvent` (без `.create`, чтобы поймать многострочный стиль) по всему `src/`, `scripts/`, `bot/`, `landing-delovoy-park.ru/` — единственный оставшийся `prisma.systemEvent.create` в `src/lib/logger.ts:18`, ровно 5 `tx.systemEvent.create` — все 5 внутри `$transaction` (см. Security → RBAC/Injection ниже) |
| ESLint-правило `no-restricted-syntax`, запрещающее `systemEvent.create` вне `logger.ts`, с точечными disable на исключениях | PASS | `eslint.config.mjs` — selector `CallExpression[callee.property.name='create'][callee.object.property.name='systemEvent']`, override для `src/lib/logger.ts`. Проверил вживую: закинул throwaway-файл с `prisma.systemEvent.create` под `src/lib/`, `npx eslint` поймал (`no-restricted-syntax`), файл удалён. Все 5 `eslint-disable-next-line no-restricted-syntax` стоят прямо над соответствующим `tx.systemEvent.create` (`payments/service.ts:238`, `subjects/booking.ts:38`, `subjects/order.ts:36`, `subjects/subscription.ts:18,39`) |
| `tsc --noEmit` ловит опечатку в source | PASS | Временно испортил `"reviews-parser"` → `"reviews-parzer"` в `landing-delovoy-park.ru/lib/parsers/yandex-reviews.ts` (файл, не тронутый диффом) — `tsc --noEmit` тут же выдал `TS2345: Argument of type '"reviews-parzer"' is not assignable to parameter of type 'EventSource'`. Откатил файл (`git status` — чисто). Подтверждает claim, что `landing-delovoy-park.ru` реально попадает в program компилятора несмотря на `exclude` в `tsconfig.json` (reachable через импорт из `src/`, видно в `tsc --listFiles`) |
| Читатели (`monitoring/service.ts`, `notifications/health.ts`, `analyze-errors.ts`) продолжают работать против фактических значений, старые данные в БД не ломаются | PASS | `scripts/lib/log-reader.ts:21` (`WARNING_SOURCES = ['client-beacon', 'rate-limit']`), `scripts/lib/pattern-extractor.ts:58` (`entry.source === 'server-error'`), `src/modules/notifications/health.ts:118` (`where: { source: "cron.processOutgoing" }`) — все три сверены посимвольно с `event-sources.ts`, совпадают. `analyze-errors.ts` группирует по source динамически, не хардкодит конкретные строки — не зависит от переименований. Миграция данных в БД не выполнялась (verified: без изменений в `prisma/`) |
| Тесты обновлены, `npm test` зелёный | PASS | `npm test -- --run`: **269 test files, 3810 tests passed**, 0 failed |

## Scope Check
- Scope creep: Нет.
- `git diff main...HEAD --stat` — ровно 24 файла, все прямо относятся к миграции: реестр
  (`event-sources.ts` + тест), `logger.ts`, ESLint-конфиг, 15 колл-сайтов + их роуты/сервисы, 5
  транзакционных исключений, 2 связанных тестовых файла (`overdue-reminders.test.ts`,
  `client-error/route.test.ts`).
- Нет изменений `package.json`, `package-lock.json`, `prisma/schema.prisma`, `CLAUDE.md` — новых
  зависимостей и новых модулей нет.
- Независимая проверка "~20 vs ~24 колл-сайта": пересчитал сам через `grep -rn "systemEvent"`
  (без `.create` в паттерне, чтобы не пропустить многострочный стиль
  `prisma.systemEvent\n.create(...)`) по всем `src/`, `scripts/`, `bot/` — подтверждаю, что после
  миграции остался ровно 1 прямой writer (`logger.ts`) + 5 задокументированных транзакционных
  исключений, 0 пропущенных мест.
- Единственное, что выходит за рамки буквального текста issue — поведенческое изменение в
  `client-error/route.ts` (см. отдельный разбор ниже). Оцениваю как органичное следствие миграции,
  не отдельную фичу: не расширяет функциональность, не требует отдельного PRD, явно и подробно
  задокументировано в теле коммита отдельным абзацем ("Реальное изменение поведения: ...") — это
  ровно то прозрачное флагирование, которое CLAUDE.md ожидает от подобных побочных эффектов.

## Разбор поведенческого изменения — POST /api/monitoring/client-error

**Было:** `logClientError` писала в БД напрямую; при падении записи исключение всплывало через
`try/catch` в роуте → `apiServerError(...)` → HTTP 500 без деталей в теле.

**Стало:** `logClientError` теперь вызывает `log.warn(...)` из `logger.ts`, который сам оборачивает
`prisma.systemEvent.create` в `try/catch` и **никогда** не бросает (даже сериализация
`metadata` через `JSON.parse(JSON.stringify(...))` — внутри того же try, `src/lib/logger.ts:17-29`).
Значит внешний `try/catch` в роуте стал мёртвым кодом; его убрали, роут теперь всегда отвечает 200
`{ accepted: true }` после прохождения валидации.

Проверил независимо, не завязываясь на объяснение имплементера:
1. **`log.warn` действительно никогда не бросает** — прочитал `logEvent` целиком, весь путь (включая
   сериализацию metadata) внутри одного `try`. Подтверждено также существующим `beforeEach` в
   `__tests__/client-error.test.ts`, который остался нетронутым и зелёным без единой правки — тест
   мокает только `@/lib/db`, реальный `logger.ts` не мокается, и `toHaveBeenCalledWith` всё ещё
   проходит благодаря глубокому сравнению после `JSON.parse(JSON.stringify(...))`-клона.
2. **Браузерный вызывающий код не зависит от статус-кода вообще.** Прочитал
   `src/components/ClientErrorBeacon.tsx:32-39` — `fetch(...)` с `.catch(() => {})`, нет `.then`,
   нет проверки `res.ok`/`res.status`, нет retry. Что 200, что 500 — с точки зрения браузера
   идентичны (fire-and-forget с `keepalive: true`). Никакой другой код в репозитории (grep по всему
   дереву на `client-error`, включая `.github/workflows/`, `scripts/`) не завязан на код ответа этого
   эндпоинта.
3. **Наблюдаемость не ухудшается, а улучшается.** У старого кода при падении записи в БД не было
   вообще никакого server-side лога (просто `catch { return apiServerError(...) }`, без
   `console.error`) — сбой был полностью тихим и на клиенте (браузер игнорирует ответ), и на сервере.
   Новый код хотя бы пишет `console.error` через `logEvent`'s catch-fallback. WARNING-уровень не шлёт
   Telegram-алерт ни в старой, ни в новой версии (это было и остаётся так — не регрессия этой задачи).
4. **Тест обновлён корректно** — `route.test.ts` переименован
   (`"still accepts the beacon when the DB write fails (logger.ts console-fallback, issue #581)"`),
   ассерты `res.status === 200`, `json.success === true`, `json.data.accepted === true`, при этом
   сохранена проверка `expect(JSON.stringify(json)).not.toContain("db down")` — утечки деталей
   ошибки в тело ответа по-прежнему нет.
5. **Прозрачность** — изменение явно названо и объяснено отдельным абзацем в теле коммита
   ("Реальное изменение поведения: ..."), плюс новый doc-комментарий прямо в роуте. Для PR не в рамках
   отдельного 5-стадийного pipeline (issue-queue задача без PRD) это адекватный уровень
   документирования этого побочного эффекта — не потребовалось бы отдельного PR, потому что это не
   новая фича, а неизбежное следствие того, что `log.warn` по контракту не бросает.

Вывод: это корректное, безопасное и хорошо задокументированное следствие миграции, не blocking issue.

## Транзакционные исключения (5 штук)

Проверил, что все пять `tx.systemEvent.create` действительно остались внутри `prisma.$transaction`
коллбэков (не превратились в оторванные от транзакции записи):
- `src/modules/payments/service.ts:238` — внутри `prisma.$transaction(async (tx) => {...})`
  (`service.ts:276/331/483`, конкретно этот case — часть `applySubjectEffectsOnSuccess`, вызываемой
  из транзакции)
- `src/modules/payments/subjects/booking.ts:38`, `order.ts:36`, `subscription.ts:18,39` — все
  принимают `tx: Prisma.TransactionClient` как параметр и вызываются из тех же трёх
  `$transaction`-блоков в `service.ts`

Атомарность не нарушена, `source` во всех пяти — `EVENT_SOURCES.PAYMENTS` вместо строкового литерала
`"payments"`, семантика записи (level/message/metadata) не изменилась ни в одном месте — diff по
каждому файлу ограничен добавлением импорта константы и заменой `"payments"` → `EVENT_SOURCES.PAYMENTS`
плюс disable-комментарием.

## Качество кода
- TypeScript strict: OK. `npx tsc --noEmit` — 0 ошибок (весь проект, включая `landing-delovoy-park.ru/`).
- `any`: не введено (`git diff | grep ": any\|as any"` — пусто). Единственный notable cast —
  `result as unknown as Record<string, unknown>` в `management/service.ts:551` (метаданные для
  `logEvent`, тот же паттерн двойного каста, что и раньше было `as Prisma.InputJsonValue`, не хуже).
- API формат/Zod: не затронуты — задача чисто про логирование, ни один Zod-контракт не менялся.
- Мутации/AuditLog: не применимо — это не user-facing мутации, а внутреннее логирование событий.
- ESLint: `npm run lint` — 0 errors, 16 pre-existing warnings в файлах, не входящих в дифф
  (messenger, notifications/service.ts, telephony/novofon-client.ts) — не связаны с этой задачей.

## Полнота (независимая перепроверка, не по методологии имплементера)
- Grep `.systemEvent` по всему `src/`, `scripts/`, `bot/`, `landing-delovoy-park.ru/` без `.create`
  в паттерне (ловит многострочный стиль) — 0 пропущенных write-сайтов.
- Grep по старым переименованным строкам `"scheduler"`, `"cron/inventory"`, `"cron/process-recurring"`
  по всему репозиторию — единственные совпадения теперь только в комментариях `event-sources.ts`,
  поясняющих факт переименования; ни одного реального читателя, зависящего от старого значения.
- Ручной прогон `tsc --noEmit` после намеренной порчи `reviews-parser` в нетронутом файле landing —
  подтвердил механизм типового контроля работает end-to-end, а не только "чисто, потому что забыли
  проверить".
- Точечная проверка орфанных/неиспользуемых констант в `event-sources.ts` (node-скрипт, сверка
  каждого значения с использованием по всему дереву, с учётом обеих форм — `EVENT_SOURCES.X` и
  голого литерала) — все 35 констант используются хотя бы в одном месте.

## Безопасность

### RBAC
- Изменённые роуты (`avito/webhook/*`, `cron/*`, `tasks/[publicId]/avito/reply`,
  `monitoring/client-error`, `waitlist`) не получили новых прав/эндпоинтов — только заменили способ
  логирования. RBAC/auth-проверки в `tasks/[publicId]/avito/reply/route.ts` (`auth()` +
  `hasModuleAccess`) не тронуты диффом.
- Ни один новый публичный эндпоинт не добавлен.

### Secrets leakage
- `git diff main...HEAD | grep -iE '(password|token|secret|nextauth|telegram_.*token|api[_-]key)'` —
  0 совпадений на утечку (единственные найденные упоминания токенов — не в диффе, уже существующая
  проверка `TELEGRAM_BOT_TOKEN` в env-конфиге не изменена этим PR).
- `.env*` не тронут.

### Supply chain
- Новых зависимостей нет (`package.json`/`package-lock.json` отсутствуют в дифф-статистике).

### Injection
- Raw SQL/`$executeRawUnsafe` не используются. `dangerouslySetInnerHTML` не используется.
  `escapeHtml` в `logger.ts:90` (`alertCritical`) — не тронут этим PR, но проверил, что source/message
  по-прежнему экранируются перед отправкой в Telegram (защита от HTML/XSS-инъекции через
  пользовательские данные в CRITICAL-алертах) сохранена без регрессии.

### Dangerous ops
- Нет деструктивных git/shell/DB операций в диффе. `prisma/schema.prisma` не тронут — миграции нет,
  как и требовалось (issue explicit: "no DB data migration, schema untouched").

**Инцидентов не найдено.**

## Тесты
- `npm test -- --run`: **269 test files, 3810 tests passed**, 0 failed (было 3807 по коммит-месседжу
  имплементера — 3 новых теста в `event-sources.test.ts`, воспроизвёл тот же итог самостоятельным
  прогоном).
- `npx tsc --noEmit`: 0 ошибок.
- `npm run lint`: 0 ошибок (16 pre-existing warnings вне диффа).
- Throwaway-проверка ESLint-правила: файл с сырым `prisma.systemEvent.create` под `src/lib/` поймало
  правило `no-restricted-syntax` с корректным сообщением; файл удалён после проверки, не закоммичен.
- Тестовое покрытие миграции: `event-sources.test.ts` (уникальность значений, неизменность
  "не переименовывать"-констант, непустота всех значений); `overdue-reminders.test.ts` обновлён под
  переименование `scheduler` → `booking.scheduler`; `client-error/route.test.ts` переписан под новый
  HTTP-контракт (200 вместо 500 при падении БД, без утечки деталей).

## Что хорошо
- Методология поиска пропущенных мест реально сработала лучше наивного grep: широкий `systemEvent`-grep
  нашёл многострочные вызовы, а typed `EventSource` + `tsc --noEmit` нашли 9 литералов, не пойманных
  ручным поиском (`auth`, `booking`, `release-notify` ×3, `reviews-parser` ×4) — оба claim'а я
  перепроверил независимо и оба подтвердились.
- Явное, подробное документирование единственного реального поведенческого изменения
  (`client-error/route.ts`) прямо в теле коммита отдельным абзацем — редкий случай, когда "мелкий
  рефакторинг" честно называет свой side effect, а не прячет его в общей формулировке "миграция
  логирования".
- Аккуратная работа с константами, которые нельзя переименовывать: не просто "оставили как было", а
  явно закомментировали причину (какой читатель зависит) и покрыли тестом-контрактом
  (`event-sources.test.ts`), защищающим именно эти 4 значения от случайного переименования в будущем.
- Обошли забавный self-inflicted баг с `eslint-disable-next-line` как буквальной строкой в комментарии
  над самим ESLint-правилом — признак того, что правило действительно тестировалось на самом
  `eslint.config.mjs`, а не только на целевых файлах.
- Diff предельно механический там, где и должен быть: 5 транзакционных исключений — это buy 2-line
  diff (импорт константы + замена литерала), без случайного рефакторинга соседнего кода.

## Что исправить
Нет пунктов — вердикт PASS.

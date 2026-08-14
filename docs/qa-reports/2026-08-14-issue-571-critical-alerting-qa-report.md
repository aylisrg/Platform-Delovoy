# QA Report: #571 — событийный CRITICAL-алертинг: log.critical() → Telegram

## Вердикт: PASS

---

## Источник правды

Ветка `claude/issue-571-critical-alerting`, 2 коммита поверх `origin/main`
(`20582411` feat, `d0883bfe` fix). `code-reviewer` дал PASS за два круга
(round 1 — NEEDS_CHANGES из-за HTML-инъекции в CRITICAL-алертах через
`sendAlert()`/`parse_mode:"HTML"`; round 2 — PASS после эскейпинга). Эта
проверка независимая: собственные тестовые сценарии, собственный обход
кода, отдельный мутационный тест — не пересказ ревью.

Acceptance criteria (issue #571):
1. `log.critical(source, msg)` доставляет Telegram-сообщение в админ-чат.
2. Повторный CRITICAL того же source в течение 300с не дублирует алерт.
3. Ошибка Telegram API не ломает вызывающий код.
4. `routeAlert` удалён; CLAUDE.md соответствует поведению.
5. (добавлено round 2) HTML в source/message экранируется — инъекция невозможна.

## AC — по пунктам

| # | AC | Статус | Доказательство |
|---|----|--------|-----------------|
| 1 | `log.critical()` → Telegram | PASS | Собственный сценарий (a): `prisma.systemEvent.create` вызван с `level:"CRITICAL"`, мокнутый `sendAlert` вызван после `vi.waitFor` (fire-and-forget подтверждён — `log.critical()` не ждёт `sendAlert`). |
| 2 | Троттлинг 300с по source | PASS | Сценарий (b): 2 вызова одного source, второй `redis.set(..., "NX")` замокан на `null` → `sendAlert` вызван 1 раз суммарно, `redis.set` вызван с ключом `critical-alert:${source}`, `"EX", 300, "NX"`. Оба `SystemEvent` всё равно записаны — троттлится только алерт, не лог (соответствует комментарию в коде). |
| 3 | Ошибка Telegram API не ломает вызывающий код | PASS | Сценарий (d): `sendAlert` реджектит — `log.critical()` резолвится (`resolves.toBeUndefined()`), ничего не бросает наружу. `alertCritical()` — независимый `try/catch` вокруг `sendAlert`. |
| 4 | `routeAlert` удалён, CLAUDE.md синхронизирован | PASS | См. «Независимый обход» ниже. |
| 5 | HTML экранируется перед отправкой | PASS | Сценарий (e) + собственный мутационный тест (см. ниже) — регрессия ловится. |

Плюс из задания: разные source не троттлят друг друга — сценарий (c) PASS.

## Независимая рантайм-верификация (свои сценарии, не копия `logger.test.ts`)

Написан отдельный файл `src/lib/__tests__/qa-independent-critical-alert.test.ts`
(смок `@/lib/db`, `@/lib/redis`, `@/lib/notifications`), прогнан через реальный
vitest, затем **удалён** — рабочее дерево осталось чистым (`git status --short`
пусто и до, и после). Прогон:

```
✓ a) writes CRITICAL SystemEvent and calls sendAlert (fire-and-forget)
✓ b) throttling: second call to same source is suppressed (redis.set NX returns null)
✓ c) different sources are not mutually throttled
✓ d) sendAlert rejecting does not reject log.critical()
✓ e) HTML injection: source/message are escaped before reaching sendAlert
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Сценарий (e) — конкретный payload `"name <img src=x onerror=alert(1)> & test"`,
проверено: аргументы, дошедшие до мокнутого `sendAlert`, не содержат сырых
`<`/`>`, каждый `&` — часть известной entity (regex `/&(?!amp;|lt;|gt;)/` не
матчит), итоговое сообщение точно равно
`"name &lt;img src=x onerror=alert(1)&gt; &amp; test"`.

### Мутационный тест (подтверждение, что тест реально ловит регрессию)

Временно откачен эскейпинг в `src/lib/logger.ts` (`escapeHtml(source)` →
`source`, `escapeHtml(message)` → `message`), прогнан существующий тест
`эскейпит HTML в source/message` из `logger.test.ts`:

```
× эскейпит HTML в source/message перед отправкой
  Expected: "Срочное обращение от &lt;a href="http://evil.example"&gt;..."
  Received: "Срочное обращение от <a href="http://evil.example">..."
```

Тест падает ровно на инъекции — не placebo. Файл восстановлен из копии
(`cp` бэкапа), `git status --short` → пусто, полный прогон `logger.test.ts`
снова 10/10 зелёных.

## Независимый обход `routeAlert` и CLAUDE.md

- `grep -rn "routeAlert"` по всему репозиторию (не только диффу) → 2 хита,
  оба в документации, не в исполняемом коде: `docs/context/2026-08-13-miniapp-role-rebuild-context.md`
  (описывает его как «мёртвый код, никем не вызывается» — исторический
  контекст, не инструкция) и `docs/qa-reports/2026-08-14-issue-534-bot-escapehtml-qa-report.md`
  (старый отчёт, ссылается на `bot/handlers/alerts.ts` как на роутер уровней
  в контексте другого issue). 0 совпадений в `.ts`/`.tsx`.
- `bot/handlers/alerts.ts` физически удалён (`git diff --stat` подтверждает
  `-32` строк, файл отсутствует на диске). Не было отдельного тестового файла
  на `routeAlert` (0 call sites → 0 тестов) — удалять было нечего, кроме
  комментария в `bot/__tests__/alerts.test.ts`, который ссылался на него как
  на «тот же паттерн» — комментарий тоже поправлен в диффе.
- CLAUDE.md, секция Monitoring, таблица уровней:
  ```
  | CRITICAL | Telegram admin group (`log.critical()` → `sendAlert()`, throttled per source, 300s — `src/lib/logger.ts`) |
  | ERROR    | Telegram admin group |
  ```
  Упоминание SMS убрано, ERROR-строка не тронута (issue не про неё) —
  подтверждено прямым чтением файла.

## Прослеживание реального вектора инъекции (не просто syntax-проверка)

Прочитан `src/modules/feedback/service.ts:124-130`: при `input.isUrgent`
вызывается `log.critical("feedback", \`Срочное обращение от ${feedback.user.name || "пользователя"}\`, ...)`.
`feedback.user.name` берётся из `include: { user: { select: { name: true } } }` —
имя обычного `USER`, изначально приходящее из Telegram `first_name` при
авторизации (полностью управляется владельцем аккаунта, не санитизируется
Telegram). Путь достижим любым авторизованным `USER` без специальных прав —
создать срочный фидбек не требует ничего, кроме обычного логина. Это
подтверждает, что инъекция была реальной, эксплуатируемой low-privilege
пользователем, а не гипотетической — фикс round 2 закрывает именно этот путь.
Другие вызывающие `log.critical()` (`src/app/api/health/route.ts`,
`src/app/api/auth/providers-status/route.ts`) передают только статические/
серверные строки — не пользовательский ввод, экранирование там избыточно, но
не вредно (те же аргументы просто не содержат спецсимволов).

## Регрессия

- `npm test -- --run` → **255 файлов, 3626 тестов, все зелёные**.
- `npx tsc --noEmit` → чисто, exit 0, без вывода.
- `npm run lint` → **0 errors**, 16 pre-existing warnings, ни один не в файлах
  диффа (`src/lib/logger.ts`, `src/lib/notifications.ts`, `CLAUDE.md`,
  `bot/handlers/alerts.ts`, `bot/__tests__/alerts.test.ts`,
  `src/lib/__tests__/logger.test.ts`) — warnings лежат в `payments/[id]/page.tsx`,
  `messenger/*`, `sidebar.tsx`, `mobile-nav.tsx`, `session-bill-modal.tsx`,
  `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts` и
  т.п., не связаны с этим PR.
- `npx vitest run bot/__tests__/alerts.test.ts` → 2/2 passed — тесты на
  `sendAlert` из `bot/index.ts` (отдельная реализация, не `src/lib/notifications.ts`)
  не задеты удалением `routeAlert`.

## Проверка видимости `sendAlert` (экспорт)

`export async function sendAlert(level, source, message)` в
`src/lib/notifications.ts` — диффом добавлено только ключевое слово `export`,
сигнатура (3 параметра) не менялась. `grep -rn "sendAlert("` по всему репо:
внутренние вызывающие в том же файле (`sendNotification`,
`notifyBookingConfirmed`, `notifyBookingReminder`, `notifyNewBooking`,
`notifyBookingCancelled`) вызывают его с тем же числом аргументов, что и до
диффа — не задеты. `scripts/health-check.ts` и `bot/__tests__/alerts.test.ts`
импортируют **другую** функцию `sendAlert` из `bot/index.ts` — независимая
реализация, вне скоупа этого issue, подтверждено `grep -n "import.*sendAlert" scripts/health-check.ts`
→ `from "../bot/index"`.

## Commit messages

- `20582411` — `feat(monitoring): event-driven CRITICAL alerting — log.critical() → Telegram`,
  тело объясняет мотивацию, содержит `Closes #571`. Conventional commits ✓.
- `d0883bfe` — `fix(monitoring): escape HTML in CRITICAL alert text before sending to Telegram`,
  тело явно ссылается на находку code-reviewer в PR #571. Conventional commits ✓.

## Security (обязательные функциональные кейсы, `agents/qa.md`)

- **Input validation / injection (основной кейс этого issue):** PASS — см.
  сценарий (e) + мутационный тест + трассировка реального вектора
  (`feedback/service.ts` → `user.name` из Telegram `first_name`).
- **RBAC:** N/A для этого PR — не создаётся и не меняется ни один HTTP
  endpoint; изменения внутри `src/lib/logger.ts` (внутренняя инфраструктура
  логирования), вызывается из уже существующего серверного кода. Точки
  вызова (`feedback/service.ts`, `health/route.ts`, `providers-status/route.ts`)
  не изменены в этом диффе — их RBAC вне скоупа.
- **Rate limiting:** N/A для HTTP — но функционально эквивалентный механизм
  (Redis `SET NX EX` троттлинг алертов) — основной AC #2, проверен отдельно
  (сценарий b) и является анти-DoS-мерой против шторма CRITICAL-алертов в
  Telegram-чат.
- **Data leakage:** `git diff origin/main...HEAD | grep -iE "password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN"` →
  пусто. Секреты (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`) читаются из
  `process.env` в `sendAlert()` (не изменено этим диффом) и не попадают в
  ответы/логи.

Все security-кейсы PASS → не блокируют вердикт.

## Итог

Оба AC-набора (исходные 4 пункта issue + добавленный round 2 пункт про
экранирование) независимо перепроверены собственными сценариями, а не
повтором тестов разработчика: fire-and-forget доставка в Telegram, атомарный
`SET NX EX`-троттлинг 300с по source с корректным поведением для разных
source, устойчивость к падению Telegram API, удаление мёртвого `routeAlert`
с синхронизацией CLAUDE.md, и экранирование HTML на реально эксплуатируемом
пользовательском векторе (`feedback.user.name`), подтверждённое мутационным
тестом. Полный прогон `npm test` (255/255 файлов, 3626/3626 тестов),
`npx tsc --noEmit` (чисто) и `npm run lint` (0 errors, warnings вне диффа) —
все зелёные. Экспорт `sendAlert` не сломал существующих вызывающих. Рабочее
дерево осталось чистым после всех временных проверок.

**Вердикт: PASS**

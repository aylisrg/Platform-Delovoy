# QA Report: #480 — гонка `github.sha` vs `resolved_sha` в deploy.yml + галлюцинации Gemini в release notes

## Вердикт: PASS

## Источник правды

Прод-инцидент 11.08.2026, репортован владельцем в issue #480 (label `prio:P1`).
Нет отдельного PRD — 4 явных action item из тела issue = acceptance criteria.
Отдельного `*-review.md` для этой задачи в `docs/qa-reports/` нет (проверено
`Glob`) — задание указывает, что ревью code-reviewer уже PASS, независимая
верификация ниже основана на собственном чтении диффа и рантайм-симуляции,
не на доверии к чужому отчёту.

## Проверенные ветка/коммит

- Ветка: `claude/issue-480-release-notes-sha-race`
- HEAD: `c1f1f74`
- `git diff main...HEAD --stat`: **1 файл**, `.github/workflows/deploy.yml`,
  +64/-23 — ровно заявленный скоуп, никаких посторонних файлов.

## Acceptance Criteria (4 пункта из issue #480 «Что нужно сделать»)

| AC | Статус | Доказательство |
|----|--------|-----------------|
| 1. Заменить `github.sha` на `needs.build-and-push.outputs.resolved_sha` во всех местах формирования текста уведомления/архива релиза в job `deploy` (строки ~682, 695, 787-790, 826 старой нумерации) | PASS | `git diff` показывает замену в **5** местах job `deploy`: (a) `actions/checkout@v7` — впервые получил `with: ref:` (раньше вообще без ref → checkout HEAD main, а не `build-and-push`'ного коммита); (b) Timeweb snapshot comment; (c) `COMMIT_SHA` в payload `release-notify`; (d) "Deploy OK"; (e) "Deploy FAILED". `grep -n "github.sha" deploy.yml` внутри диапазона job `deploy` (строки 172-892) → 0 совпадений. |
| 2. Переписать промпт Gemini: запретить выдумывать функциональность, дать явный fallback для чисто технических коммитов | PASS | Новый `PROMPT_TEXT` убрал ролплей «Ты — AI-ассистент бизнес-парка», добавил явный запрет («Используй ТОЛЬКО факты из... Никогда не придумывай...») и точную fallback-фразу `"Технический релиз — без изменений для пользователей."` для случая, когда все коммиты внутренние/технические. Прогнано рантайм-симуляцией (см. ниже, сценарий A) — модель (мок) действительно выдаёт эту строку и она проходит grounding. |
| 3. Добавить минимальную валидацию перед отправкой в Telegram (grounding-проверку) | PASS | Добавлен `call_gemini()`-based двойной запрос: после генерации второй вызов Gemini спрашивает строго YES/NO «следует ли каждый пункт из коммитов»; ответ нормализуется (`tr -d whitespace`, `tr upper`) и сравнивается **строго** с `"YES"` — любой другой ответ (включая пустой при сбое) → `NOTES="$COMMITS"` (raw fallback). Подтверждено рантайм-симуляцией: сценарий B (галлюцинация + verdict NO) действительно откатывается на сырой список коммитов **до** отправки в `/api/admin/release-notify` (проверено фактическим телом POST-запроса в моке, не только логами). |
| 4. Проверить job `deploy` (checkout) на ту же гонку | PASS | `actions/checkout@v7` в job `deploy` получил `ref: ${{ needs.build-and-push.outputs.resolved_sha }}` — раньше был вообще без `ref:`, что означало неявный checkout `github.sha` (ещё хуже, чем прямое использование — по умолчанию GH checkout берёт SHA события, триггернувшего job, что в контексте `workflow_run` также «HEAD main на момент старта», а не `resolved_sha`). Теперь checkout детерминированно тянет тот же коммит, что был собран `build-and-push`. |

## Независимая трассировка графа зависимостей и гонки (не на доверии к code-reviewer)

Прочитан весь `deploy.yml` (892 строки) целиком, включая `on:`, `concurrency`,
и все 3 job'а (`guard`, `build-and-push`, `deploy`).

- `build-and-push.outputs.resolved_sha` = `steps.resolve.outputs.sha`
  (строки 108-121): для `workflow_run` берётся `github.event.workflow_run.head_sha`
  — **точный** коммит, на котором завершилась CI. Это единственное место,
  где SHA резолвится из события; вычисляется один раз, до начала работы
  `build-and-push`.
- Job `deploy` объявлен `needs: [guard, build-and-push]` (строка 175) —
  GitHub Actions job-outputs **фиксируются** в момент завершения продюсирующего
  job'а и остаются неизменными для всех steps job'а-потребителя, сколько бы
  времени ни занял `deploy` и что бы ни случилось с `main` тем временем.
  Поэтому `needs.build-and-push.outputs.resolved_sha` в любом из 5 мест
  job `deploy` (checkout, snapshot comment, COMMIT_SHA → персональный
  Telegram-анонс через `/api/admin/release-notify` → `formatReleaseBody()`
  → `🔗 ${shortSha}`, "Deploy OK", "Deploy FAILED") — гарантированно
  **одно и то же значение**, независимо от того, сколько релизов release-please
  успел смержить в main, пока `deploy` был в очереди/выполнялся.
- Прослежен путь `COMMIT_SHA` дальше кода workflow: `src/app/api/admin/release-notify/route.ts`
  (`commitSha: z.string().min(1)`, без доп. трансформаций) →
  `announceRelease()` (`src/modules/notifications/release-notify.ts`) →
  `buildReleasePayload()` → `formatReleaseBody()`, строка 262:
  `const shortSha = info.commitSha.slice(0, 7)` — именно это значение
  подписчики видят как `🔗 07c7fdd` в личном анонсе. Подтверждено, что
  ровно тот сегмент кода, который показал несовпадающий SHA в инциденте,
  теперь получает `resolved_sha`, а не `github.sha`.
- Пункты `concurrency.group` (строка 55, `workflow_run.head_sha || github.sha`),
  `guard` job (строки 85/88/120 — все внутри `if: github.event_name == 'push'`,
  где `github.sha` **корректен** по определению push-события) намеренно не
  тронуты — согласовано с описанием issue («… fallback push-event resolve
  step … deliberately left unchanged»). Проверено, что это единственные
  оставшиеся вхождения `github.sha` в файле (grep, см. ниже) и все — вне
  `workflow_run`-контекста или вне текста, видимого человеку.

Вывод: гонка из инцидента (v2.9.0 + SHA от v2.10.0) закрыта структурно —
не эвристикой, а тем, что job-output вычисляется один раз и переиспользуется
как константа во всех потребляющих steps.

## Рантайм-симуляция bash-логики Gemini + grounding (независимая, не описана в PR)

`.github/workflows/*.yml` не гоняется `npm test`, поэтому логика step'а
"Generate release notes & notify subscribers" (строки 717-864) проверена
отдельно: `run:`-блок вытащен из YAML, `${{ needs.build-and-push.outputs.* }}`
заменены на env-переменные (`$MOCK_VERSION`/`$MOCK_SHA`), скрипт запущен под
`set -eo pipefail` (реальный дефолт GitHub-раннера для `run:`-шагов) с
mock-бинарём `curl` первым в `$PATH`, реальными `git`/`python3`/`jq` (текущий
репозиторий использован как источник `git log`).

- **Сценарий A — чисто технические коммиты, grounding должен пройти.**
  Мок Gemini на 1-й вызов возвращает `"Технический релиз — без изменений для
  пользователей."`, на 2-й (grounding) — `"YES"`. Фактический вывод скрипта:
  `Grounding check passed`, exit code `0`, `GITHUB_OUTPUT` содержит
  `notified=true`, POST на `/api/admin/release-notify` получает эту строку
  как `releaseNotes` без изменений.
- **Сценарий B — галлюцинация, grounding должен поймать и откатить.**
  Мок Gemini на 1-й вызов возвращает текст про «конференц-залы» и «маршрутные
  автобусы» (буквально текст из инцидента), на 2-й — `"NO"`. Фактический
  вывод: `Grounding check did not pass (verdict: 'NO') — falling back to raw
  commit list`, exit `0`. **Проверено тело реально отправленного POST-запроса**
  (не только stdout-лог) — `releaseNotes` в payload оказался сырым
  `git log`-списком (реальные коммиты этого репозитория из
  `docs/qa-reports/...`/`fix(booking)`/`feat(gazebos)` и т.д.), галлюцинация
  про конференц-залы в отправленном теле **отсутствует**. Это закрывает
  главный риск: даже если проверка «прошла логами», но забыла реально
  подменить `$NOTES` — здесь подтверждено на уровне фактических байт запроса.
- **Сценарий C — полный сбой Gemini API (curl падает, exit 7, без stdout).**
  `call_gemini()` использует `curl ... || echo ''` — под `set -e` сбой `curl`
  не валит step, `NOTES` остаётся пустой строкой → ветка `else`: `"Gemini
  failed — falling back to commit list"`, `NOTES="$COMMITS"`, grounding-запрос
  вообще не выполняется (нет лишнего сетевого вызова на пустом контенте).
  Скрипт завершился с exit `0`, `notified=true` в выводе.

Во всех трёх сценариях скрипт не упал, не оставил `$GITHUB_OUTPUT` пустым и
не отправил невалидированный/галлюцинированный текст. Экстракт-скрипт и мок
сохранены в scratchpad сессии (не коммитятся — вспомогательный тестовый
артефакт, не часть продукта).

## Проверка на тот же класс бага в других местах (`github.sha` + `workflow_run`, видимый человеку)

`grep -rln "workflow_run:" .github/workflows/` → 4 файла: `deploy.yml`,
`docker-cleanup.yml`, `issue-queue-merge.yml`, `ci-watchdog.yml`.
Для каждого — grep на `github.sha`:

- `deploy.yml` — единственные оставшиеся вхождения (`concurrency.group`,
  `guard` job) корректны в своём контексте (см. выше), новых утечек нет.
- `docker-cleanup.yml`, `issue-queue-merge.yml` — **0** вхождений `github.sha`.
- `ci-watchdog.yml` — **0** вхождений `github.sha`; для SHA коммита CI-фейла
  везде явно используется `github.event.workflow_run.head_sha` (строка 48) —
  уже написан правильно, паттерна бага здесь нет и не было.

Вывод: класса бага "`github.sha` в `workflow_run`-контексте, видимого
человеку в уведомлении" за пределами уже исправленного `deploy.yml` не
обнаружено.

## Регрессия / статические проверки

- `npx tsc --noEmit` — чисто, exit 0 (изменение YAML-only, ожидаемо no-op).
- `npm run lint` — 0 errors, 16 pre-existing warnings, ни один не в
  `.github/workflows/` (правило неприменимо к YAML) и не связан с этим PR.
- `npm test -- --run` — **234/234 файлов, 3523/3523 тестов зелёные**.
  Ожидаемо: диф не тронул `src/`.

## Security (обязательные функциональные кейсы)

- **RBAC:** не применимо — изменения только в CI/CD workflow и внутреннем
  server-to-server payload (`RELEASE_NOTIFY_SECRET` bearer-эквивалент,
  не тронут этим PR).
- **Data leakage:** `git diff main...HEAD | grep -iE "password|token|secret|key"`
  → только имена env-переменных секретов (уже существовавшие ссылки на
  `${{ secrets.* }}`), значения нигде не залогированы новым кодом.
- **Input validation / injection:** новый `call_gemini()` использует тот же
  `python3 -c "...json.dumps(sys.stdin.read())"` паттерн экранирования, что
  и старый код (не ослаблен) — commit-сообщения с кавычками/переносами не
  ломают JSON-пейлоад Gemini (проверено самой симуляцией — реальные
  git-сообщения этого репозитория содержат кавычки `«»`/переносы и
  прошли через `call_gemini` без ошибок парсинга).
- Специфического security-риска в этом PR нет (нет новых публичных
  endpoint'ов, RBAC-поверхность не меняется) — раздел закрыт.

## Итог

Все 4 явных action item из issue #480 выполнены и независимо перепроверены:
(1) все 5 вхождений `github.sha` в job `deploy` заменены на `resolved_sha`,
включая ранее отсутствовавший `ref:` в checkout; (2) промпт Gemini
переписан с явным запретом галлюцинаций и точным fallback-текстом;
(3) добавлена двухшаговая grounding-проверка, откатывающая на сырой список
коммитов при любом ответе кроме строгого `YES`; (4) `deploy`-job checkout
проверен и исправлен. Собственная рантайм-симуляция bash-логики (3
сценария, включая проверку фактического тела отправляемого HTTP-запроса,
а не только логов) подтверждает, что откат на сырые коммиты происходит
реально, а не только на бумаге, и что сбой Gemini API не роняет step под
`set -e`. Граф зависимостей job'ов подтверждает структурное (не
эвристическое) закрытие гонки — `needs.*.outputs.*` фиксируется один раз.
Поиск по всем workflow-файлам не выявил того же класса бага где-либо ещё.
`npm test`/`tsc`/`lint` зелёные, скоуп ограничен одним файлом.

## Вердикт: PASS

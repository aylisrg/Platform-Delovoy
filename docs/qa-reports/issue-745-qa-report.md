# QA-отчёт: Issue #745 — блокировка нативного GitHub auto-merge для claude/** PR

## Вердикт: PASS

## Контекст

- Ветка `claude/issue-745-block-native-automerge`, 4 коммита поверх `main`
  (последний `065f44f`), `code-reviewer` уже дал PASS за 3 раунда (в процессе
  исправлены непинованный `checkout` ref и вектор shell-injection в
  `merge-gate-check.yml` — оба фикса присутствуют в текущем HEAD, см. ниже).
- Диф: `git diff main...HEAD --stat` → 6 файлов, 352(+)/0(-):
  `.github/workflows/block-native-automerge.yml` (new),
  `.github/workflows/merge-gate-check.yml` (new), `CLAUDE.md`,
  `docs/qa-reports/issue-745-native-automerge-audit.md` (new),
  `scripts/__tests__/issue-queue.test.ts`, `scripts/lib/issue-queue.ts`.
- Issue #745 прочитана из первых рук
  (`GET /repos/aylisrg/platform-delovoy/issues/745`): нативный auto-merge
  замержил PR #743 без единого комментария/review, полностью обойдя
  `classifyMergeGate` (issue #580).

## 1. Регрессия

```
npm test -- --run     → Test Files 314 passed (314), Tests 4372 passed (4372)
npx tsc --noEmit       → чисто, exit 0
npm run lint           → 0 errors, 21 warnings (все в файлах, которые этот PR
                          не трогает — src/components/*, src/modules/messenger/
                          types.ts, notifications/service.ts, novofon-client.ts;
                          сверено `git diff main...HEAD --stat` — ни один из
                          этих файлов в дифф не входит, warnings pre-existing)
npx vitest run scripts/__tests__/issue-queue.test.ts → 177/177 passed отдельно
```
Регрессий нет.

## 2. Функциональная проверка HOLD_PATTERNS (не по тексту теста, а прогоном)

Ad-hoc прогон `classifyMergeGate` с обоими маркерами вердиктов в комментариях
(`CODE_REVIEWER_PASS_MARKER` + `QA_ENGINEER_PASS_MARKER`) напрямую импортируя
`scripts/lib/issue-queue.ts` через `npx tsx`:

```
.github/workflows/block-native-automerge.yml => {"tier":"hold", ...}
.github/workflows/merge-gate-check.yml       => {"tier":"hold", ...}
control (src/modules/cafe/service.ts)         => {"tier":"auto", ...}
```

Оба новых файла защиты реально не авто-мержатся сами по себе — даже при
наличии обоих PASS-маркеров, — контрольный несвязанный файл при тех же
маркерах корректно даёт `auto`. Циклическая дыра («агент правит свою же
защиту и тем же прогоном её домерживает») закрыта функционально, не только
на бумаге теста.

## 3. Трассировка сценария эксплойта против `block-native-automerge.yml`

- **Событие**: `pull_request: types: [auto_merge_enabled]`. Проверено
  независимо от слов автора: скачан официальный JSON-schema пакета
  `@octokit/webhooks-types@7.6.1` (`registry.npmjs.org`, тарбол,
  `schema.d.ts`) — `PullRequestAutoMergeEnabledEvent { action:
  "auto_merge_enabled"; ... }` существует как отдельный, документированный
  action webhook `pull_request`, единый независимо от `merge_method`
  (merge/squash/rebase — это поле `pull_request.auto_merge.merge_method`
  внутри payload, не часть имени action). Отдельно подтверждено, что REST
  Issue Events API (`/issues/{n}/events`, старая timeline-API) использует
  **другое** имя — `auto_squash_enabled`/`auto_rebase_enabled` в зависимости
  от метода — это отдельная, несвязанная вокабула того же события, что
  видно в реальных данных (`GET issues/743/events` → `auto_squash_enabled`,
  т.к. у #743 `merge_method: squash`). Комментарий в `merge-gate-check.yml`
  (строка 72 issue-745-native-automerge-audit.md) не путает эти два API —
  автор верно выбрал имя webhook-события для `on: pull_request:
  types: [...]`, а не имя из Issue Events timeline.
- **Условие** `startsWith(github.event.pull_request.head.ref, 'claude/')` —
  совпадает с `AGENT_BRANCH_RE = /^claude\//` в `scripts/lib/issue-queue.ts`
  и с реальными именами веток очереди (`claude/issue-{n}-{slug}`).
- **Права**: `permissions: pull-requests: write` — достаточно и для
  `gh pr merge --disable-auto` (`disablePullRequestAutoMerge`), и для
  `gh pr comment` (PR-комментарии покрываются `pull-requests: write` в
  модели прав `GITHUB_TOKEN`, отдельного `issues: write` не требуется).
  Комментарий-объяснение помечен `continue-on-error: true` — корректно:
  критичный шаг (сам disable) не зависит от успеха необязательного
  объяснения.
- Ничего в trigger/condition/permissions не мешает срабатыванию в реальности.

## 4. Остаточный риск гонки (enable → job → disable)

Подтверждён и честно задокументирован самим PR (комментарии в
`merge-gate-check.yml:3-8`): между событием `auto_merge_enabled` и фактическим
API-вызовом `--disable-auto` есть окно — время старта раннера + выполнение
шага. `block-native-automerge.yml` минимизирует его насколько возможно (нет
`checkout`/`setup-node`, единственный шаг сразу вызывает `gh`).

Разобрал оба возможных случая:
- **Наблюдаемые инциденты (4 из 4 проверенных, см. п.5)**: auto-merge
  включался за минуты **до** того, как CI позеленел (в #743 — enable в
  14:53:18, merge в 14:57:30, т.е. GitHub ждал зелёного CI ~4 мин; в #710 —
  даже там `ready_for_review`→`auto_squash_enabled`→`merged` заняли 28 сек,
  но это уже после того, как CI был явно зелёным на момент `ready_for_review`
  — см. ниже). В сценарии «CI ещё не зелёный на момент enable» — а это
  типичный случай, потому что `auto_merge_enabled`, судя по проверенным
  таймингам, чаще ставится сразу при появлении PR, а не после зелёного CI —
  фикс выигрывает гонку с большим запасом (секунды раннера против минут CI).
- **Худший случай (CI уже зелёный к моменту enable)** — как в реальности
  проявилось на #710 (`ready_for_review` в 15:05:15, `auto_squash_enabled` в
  15:05:21, `merged` в 15:05:43 — всего 28 секунд от re-ready до мержа,
  что означает CI, скорее всего, был зелёным ещё раньше): в этом случае
  GitHub может смержить почти мгновенно после enable, и не гарантировано, что
  Actions-раннер `block-native-automerge.yml` успеет стартовать и выполнить
  `gh pr merge --disable-auto` быстрее. Это реальный, не гипотетический гэп —
  честно то, что PR его не закрывает целиком.

**Оценка, закрывает ли workflow 1 практическую дыру самостоятельно**: частично.
Он закрывает демонстрированный класс инцидентов (#743, #634, #677) со счётом
"минуты между enable и mergeable", но не структурно устраняет гонку для
случая мгновенного мержа при уже-зелёном CI (класс #710). `merge-gate-check.yml`
как обязательный required-check закрыл бы это полностью (required status
блокирует even API-мерж GitHub независимо от таймингов раннера), но это
осознанно отложено на repo-настройку владельца — оба факта прозрачно описаны
в самом PR и в аудит-доке, не скрыты. Альтернатива, которую PR не рассмотрел
и не отверг явно — репозиторная настройка `allow_auto_merge: false` (`PATCH
/repos/{owner}/{repo}`), которая убрала бы саму возможность включить нативный
auto-merge вообще, устранив гонку по построению без ожидания CI-таймингов;
поскольку владелец не участвует в GitHub (ADR `2026-08-20-owner-out-of-github`)
и легитимных пользователей этой настройки для `claude/**`/`feature/**` больше
нет, это выглядело бы даже более простым и надёжным фиксом. Отмечаю это как
**рекомендацию на будущее** (issue/фоллоу-ап), не как блокер вердикта: заявленная
в issue #745 проблема (систематический, воспроизводимый обход гейта) реально
устраняется для всех 4 найденных исторических сценариев, а оставшийся
теоретический гэп (мгновенный мерж при уже-зелёном CI) прозрачно
задокументирован автором и покрыт второй линией защиты, которая всего лишь
требует одного клика владельца в Settings, а не написания кода.

## 5. Независимая перепроверка ретроспективного аудита (issue-745-native-automerge-audit.md)

Не поверил документу на слово — свежие вызовы GitHub API:

- **PR #710** (заявлено: правил рубильники автоматики, 0 вердиктов, обошёл
  гейт): `GET issues/710/events` → `ready_for_review` (15:05:15) →
  `auto_squash_enabled` (15:05:21, +6с) → `merged` (15:05:43, +22с), actor
  `aylisrg` во всех трёх. `GET pulls/710/files` → 45 файлов, включая
  `.claude/commands/next-issue.md`, `.github/issue-queue.json`,
  `.github/workflows/issue-queue-merge.yml`, `.github/workflows/auto-rebase.yml`
  — подтверждено, ровно рубильники из `HOLD_PATTERNS`. `GET
  pulls/710/reviews` → 0. `GET issues/710/comments` → 1 комментарий, от
  `github-actions[bot]`, **на 35 минут раньше** самого мержа (14:30:01):
  ```
  Авто-мерж запрещён гейтом:
  - трогает рубильники самой автоматики: .github/workflows/issue-queue.yml,
    .github/issue-queue.json, scripts/lib/issue-queue.ts, scripts/issue-queue.ts
  - нет вердиктов ревью-агентов (маркеры code-reviewer/qa-engineer PASS не
    найдены в комментариях PR)
  Очередь идёт дальше, PR ждёт решения владельца.
  ```
  Это даже сильнее, чем формулировка аудита: не просто «маркеров не было» —
  собственный гейт очереди **явно** держал этот PR и ждал решения владельца,
  а нативный auto-merge всё равно смержил его в обход, без единого маркера
  вердикта и без review. Аудит не преувеличивает.
- **PR #634** и **PR #677** — тоже перепроверены. #634: `auto_squash_enabled`
  16.08 11:55:08 → `merged` 12:04:10 (+9 мин); единственный комментарий —
  нарративное сообщение от предыдущей сессии («CI зелёный, code-reviewer и
  qa-engineer — оба PASS... Гейт вернул hold: scope creep 10 модулей»),
  которое **не содержит** маркер-строки `CODE_REVIEWER_PASS_MARKER`/
  `QA_ENGINEER_PASS_MARKER` — гейт корректно не засчитал бы его как вердикт,
  подтверждает «оба отсутствовали» из аудита. #677: `auto_squash_enabled`
  17.08 18:08:44 → `merged` 18:21:23 (+13 мин), единственный комментарий —
  автоматический hold («нет вердиктов ревью-агентов»), 0 reviews.
- Вывод: аудит-документ не приукрашивает и не искажает данные — независимая
  перепроверка совпадает по всем цифрам, а для #710 находит даже более яркое
  подтверждение (явный hold-комментарий гейта, обойдённый мержем).

## 6. Проверка отсутствия побочных эффектов на dependabot/release-please/feature/** пути

`merge-gate-check.yml`, шаг «Skip — not an agent PR»
(`if: !startsWith(steps.pr.outputs.ref, 'claude/')`) публикует `success`/`n/a`
для любого PR не с `claude/`-веткой. Прочитан код `scripts/lib/issue-queue.ts`:
`autoMergeSkipReason` (строка 716), `releasePrGate` (776),
`isDependabotAutoMergeBranch` (802) — все три полностью независимы от
`classifyMergeGate`, работают по своим правилам (whitelist файлов + ночное
окно для release-please; `dependabot.yml`-группы для dependabot;
`AGENT_BRANCH_RE`/`claimedByQueue` только определяют «чей PR», не вызывают
гейт). Реальный мерж этих классов идёт через `attemptMerge`/`pr-merge` в
`issue-queue-merge.yml`, а не через `merge-gate-check.yml`. Даже если
`merge-gate/verdicts` станет required check в будущем — для
`release-please--*`/`dependabot/npm-minor-patch`/`feature/**` он всегда
`success` (n/a), поэтому branch protection не заблокирует их существующие
легитимные пути мержа. Единственный документированный побочный эффект
required-check — needs-owner PR через `PUT /pulls/{n}/merge` под
`AUTOMATION_TOKEN` (см. п.4 аудита) — прозрачно описан как то, что владелец
должен решить *до* включения required check, а не скрытая регрессия.

## Security

- RBAC/rate limiting/input validation/data leakage в классическом смысле
  неприменимы — PR не добавляет API-эндпоинтов, форм, полей ввода.
- Shell-injection вектор (имя ветки PR как untrusted string) — исправлен
  (передача через `env:` вместо `${{ }}`-интерполяции в `run:`, коммит
  `065f44f`), подтверждено чтением текущего кода `merge-gate-check.yml:78-104`.
- Unpinned checkout ref — исправлен (`ref: main` явно, коммит `06d4973`),
  подтверждено чтением `merge-gate-check.yml:73-75` + обоснование в
  комментарии (защита от self-weakening через `pull_request:synchronize` на
  собственном ослабленном коде PR).
- `GITHUB_TOKEN`/`AUTOMATION_TOKEN` не встречаются в открытом виде ни в одном
  изменённом файле (`grep -inE "password|secret|token|NEXTAUTH" <diff>` —
  только имена переменных окружения `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`,
  ожидаемо и безопасно).

## Итог

- AC issue #745 «Расследовать источник» — PASS (аудит + моя перепроверка
  API совпадают: источник внешний, ни один файл репозитория не вызывает
  auto-merge API).
- AC «Починить, чтобы гейт нельзя было обойти» — PASS с оговоркой: первичный
  фикс (`block-native-automerge.yml`) закрывает все 4 исторически
  наблюдённых сценария обхода; полное структурное закрытие теоретической
  гонки «CI уже зелёный при enable» требует ручного шага владельца
  (required check), который PR осознанно и прозрачно откладывает — это
  соответствует явной формулировке issue («либо... либо...», оба варианта
  реализованы, второй — опционально, что и заявлено).
- AC «Проверить задним числом другие PR» — PASS, аудит-документ выдержал
  независимую перепроверку без расхождений.
- `npm test`/`tsc`/`lint`: зелено, регрессий нет.
- `HOLD_PATTERNS` защита от self-weakening проверена функциональным прогоном,
  не только тестом.
- Security: оба замечания code-reviewer (unpinned ref, shell injection)
  подтверждённо исправлены в текущем HEAD.

**Вердикт: PASS.** Рекомендация на будущее (не блокирует мерж): завести
отдельный follow-up issue на рассмотрение `allow_auto_merge: false` как
репозиторной настройки, которая закрыла бы остаточную гонку из п.4
структурно, без ожидания required-check шага владельца.

# QA-отчёт: issue #570 — Blocking smoke tests + rollback in deploy.yml

## Скоуп

Независимая верификация коммита `4a47427` на ветке `claude/issue-570-blocking-smoke-tests`.
Reviewer уже вынес PASS — этот отчёт не пересказывает его вывод, а перепроверяет
всё заново: синтаксис шелл-артефактов, рантайм-поведение через реальный `sh` с
замоканными бинарями в `$PATH` (без обращения к реальной ФС/сети/VPS), полный
прогон тестового набора репозитория.

Изменённые файлы (по `git log -1 -p 4a47427`):
- `.github/workflows/deploy.yml`
- `scripts/deploy-bluegreen.sh`
- `scripts/smoke-tests.sh` (новый)

## AC из issue #570

1. Провал любого smoke-чека → job `deploy` красный + существующий Telegram failure-алерт.
2. Blue-green: smoke — до остановки старого слота; провал → upstream откатывается на старый порт, стопается только новый/неудачный слот, старый не тронут.
3. Legacy: провал smoke → существующая ветка отката на `$CURRENT_IMAGE`.
4. `skip_smoke_tests` (workflow_dispatch) по-прежнему пропускает проверку через `SKIP_SMOKE_TESTS`.
5. Успешный деплой — поведение не изменилось.

## 1. Синтаксис (`sh -n`)

```
$ sh -n scripts/smoke-tests.sh && echo OK
smoke-tests.sh OK
$ sh -n scripts/deploy-bluegreen.sh && echo OK
deploy-bluegreen.sh OK
$ sh -n <фрагмент "Deploy via SSH", строки 421-593> && echo OK
deploy-via-ssh fragment: syntax OK
$ sh -n <фрагмент "Post-deploy status & notifications check", 683-706> && echo OK
post-deploy fragment: syntax OK
```
Все четыре артефакта — валидный POSIX sh. **PASS**.

## 2. Рантайм-симуляция

### 2a. `scripts/smoke-tests.sh` напрямую, реальный `sh`, замоканный `curl` в `$PATH`

**Сценарий A — все три чека проходят:**
```
smoke-tests: ✅ Main page: 200 OK
smoke-tests: ✅ PS Park page: 200 OK
smoke-tests: ✅ PS Park API health: OK
smoke-tests: all checks passed
exit=0
```

**Сценарий B — PS Park страница отдаёт 500 (`curl -f` → exit 22), остальное ОК:**
```
smoke-tests: ✅ Main page: 200 OK
smoke-tests: ❌ PS Park page: FAILED
smoke-tests: ✅ PS Park API health: OK
smoke-tests: 1 check(s) failed
exit=1
```
Ровно один упавший чек посчитан корректно (`FAILED=1`), остальные не задеты. **PASS**.

### 2b. `scripts/deploy-bluegreen.sh` целиком, замоканные `docker`/`nginx`/`systemctl`/`sudo`/`curl`/`sleep`

`COMPOSE_DIR`, `UPSTREAM_CONF`, `METER_LOG` и хардкод `ARCHIVE=/opt/delovoy-park/...`
патчнуты sed'ом на пути внутри scratch-директории — реальная ФС/`/opt`/`/etc/nginx` не
тронуты. Единственные изменения в копии скрипта — эти 4 константы; вся логика идентична
файлу в репозитории (проверено `diff`).

**Сценарий (i) — smoke проходит:**
```
bluegreen: активный слот=a → деплою в b (app-b → 127.0.0.1:3001)
...
smoke-tests: all checks passed
bluegreen: активный слот теперь b; дренаж старого (app) 30с
...
EXIT_CODE=0
ACTIVE_SLOT: b
upstream.conf: server 127.0.0.1:3001;
docker compose calls: up -d --no-deps app-b ; stop app
```
Слот переключился, старый (`app`) остановлен, новый (`app-b`) не остановлен. **PASS**.

**Сценарий (ii) — PS Park страница 500 → smoke падает:**
```
smoke-tests: ❌ PS Park page: FAILED
smoke-tests: 1 check(s) failed
bluegreen: ПРОВАЛ — smoke-тесты не прошли — upstream откачен на 3000, старый слот не тронут
EXIT_CODE=1
ACTIVE_SLOT: a   (не перезаписан — файл не тронут)
upstream.conf: server 127.0.0.1:3000;   (откачен на старый порт)
docker compose calls: up -d --no-deps app-b ; stop app-b
```
Ключевая проверка по логу вызовов `docker` (не только exit-код): `stop` вызван
**только** с `app-b` (новый/неудачный слот), `app` (старый) — ни разу. `ACTIVE_SLOT`
не записан. **PASS** — именно то поведение, которое требует AC 2.

**Сценарий (iii) — `SKIP_SMOKE_TESTS=true` при падающей PS Park странице:**
```
bluegreen: smoke-тесты пропущены (skip_smoke_tests=true)
bluegreen: активный слот теперь b; дренаж старого (app) 30с
...
EXIT_CODE=0
ACTIVE_SLOT: b
upstream.conf: server 127.0.0.1:3001;
docker compose stop calls: app (только старый)
```
Гейт пропущен, деплой завершился успешно несмотря на "падающий" ps-park. **PASS** — AC 4 подтверждён.

*Побочное наблюдение (не баг диффа):* в сценариях (i)/(iii) в выводе мелькает
`[: Illegal number: 0` из блока даунтайм-метра (`NON200=$(grep -cv ...)`). Это
артефакт тестового харнесса — мок `sleep` сделан no-op, из-за чего фоновый
150-итерационный цикл метра гоняется почти мгновенно и создаёт гонку записи в
`METER_LOG` при чтении. Сам блок даунтайм-метра — неизменённый контекст в
диффе (не часть фикса issue #570), и на итоговый `exit 0`/`ACTIVE_SLOT`/
поведение stop-вызовов не влияет (подтверждено `EXIT_CODE=0` и корректным
содержимым `ACTIVE_SLOT`/`upstream.conf` в обоих сценариях). Не блокер.

### 2c. Legacy-путь (`.github/workflows/deploy.yml`, извлечённый фрагмент строк 454-593, дословно)

Гейт на момент проверки — строки 511-521 (после health-check-loop, до `if [ "$HEALTHY" = true ]`
на строке 524); сверено `grep -n` перед вырезкой, отличается от чисел из ТЗ (505-521) на
величину смещения, вызванную предыдущими правками того же PR выше по файлу — сам блок
идентичен описанному.

**Сценарий (i) — HEALTHY=true, smoke проходит:**
```
Health check passed on attempt 1
smoke-tests: all checks passed
✅ Smoke tests passed
=== Archive build static assets ===
=== Run unified seed pipeline ===
✅ Seed pipeline OK
=== Bot rolling deploy ===
✅ Bot is running
EXIT_CODE=0
```
Дошло до seed/bot-deploy, `docker pull $CURRENT_IMAGE` (rollback) не вызывался. **PASS**.

**Сценарий (ii) — smoke падает (PS Park page 500):**
```
smoke-tests: ❌ PS Park page: FAILED
❌ Smoke tests failed — triggering rollback
FATAL: Smoke tests failed
=== Rolling back ===
Rolling back to: sha256:oldimage123
Rollback health check PASSED
EXIT_CODE=1
```
`HEALTHY` переустановлен в false, `FAIL_REASON="Smoke tests"` → `FATAL: Smoke tests failed`
(совпадает с `echo "FATAL: $FAIL_REASON failed"`), упало в существующую ветку
`if [ -n "$CURRENT_IMAGE" ]` — `docker pull sha256:oldimage123` подтверждён в логе.
seed/bot-deploy НЕ вызваны. **PASS**.

**Бонус — `SKIP_SMOKE_TESTS=true` при падающей PS Park page:** гейт пропущен
(`=== Smoke tests skipped ===`), дошло до `✅ Bot is running`, `EXIT_CODE=0`. Согласуется с AC 4.

### AC 1 (job красный + существующий Telegram-алерт)

`.github/workflows/deploy.yml:878-888` — шаг `Notify on failure` с `if: failure()`,
не изменён этим диффом. Оба сценария провала (bluegreen exit 1 из-за `fail()`
внутри `deploy-bluegreen.sh`, legacy `exit 1` в конце "Deploy via SSH") делают шаг
"Deploy via SSH" красным под `set -e` → job `deploy` красный → существующий
`if: failure()` алерт сработает без изменений. **PASS**.

Также проверено: на триггерах `push`/`workflow_run` (обычный авто-деплой, не
`workflow_dispatch`) `${{ inputs.skip_smoke_tests }}` рендерится пустой строкой,
и `${SKIP_SMOKE_TESTS:-false}` в POSIX sh корректно трактует пустую строку как
"не задано" → падает на `false` → smoke-тесты гоняются как обычно. Регрессии на
основном пути деплоя нет.

## 3. Регрессия / статика

```
$ npm test -- --run
 Test Files  254 passed (254)
      Tests  3616 passed (3616)

$ npx tsc --noEmit
(без вывода, exit 0)

$ npm run lint
✖ 16 problems (0 errors, 16 warnings)
```
16 warnings — все в файлах вне диффа этого PR (`session-bill-modal.tsx`,
`sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`,
`messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts`) —
pre-existing, не блокер. **PASS**.

## 4. Commit message

```
fix(deploy): make post-deploy smoke tests blocking with rollback
...
Closes #570
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```
Conventional commits (`fix(deploy):`), содержит `Closes #570`. **PASS**.

## 5. Happy path — поведение не изменилось

Сравнение с до-фикс поведением (тот же набор действий, что раньше выполнялся
безусловно): в обоих путях (bluegreen сценарий i, legacy сценарий i) при
полностью зелёных проверках итог идентичен старому — bluegreen переключает
`ACTIVE_SLOT`, останавливает старый слот; legacy доходит до seed pipeline,
data-migrations, bot rolling deploy и завершается `exit 0`. Новый гейт в
happy-path молча проходит и не меняет набор/порядок выполняемых команд.
Дополнительно подтверждено: `scripts/smoke-tests.sh` добавлен в `source:`
список шага `scp` (строка ~392 diff) — без этого файл не попал бы на VPS и
`sh scripts/smoke-tests.sh` падал бы `No such file` на каждом деплое; в диффе
присутствует. **PASS**.

## Security / functional checklist (agents/qa.md)

Этот PR — CI/CD deploy pipeline (shell/YAML), не API endpoint: RBAC, rate
limiting, Zod-валидация, data leakage из `agents/qa.md` неприменимы напрямую
(нет публичного API-поверхности, нет пользовательского ввода). Проверено
смежное: секреты (`TELEGRAM_BOT_TOKEN` и т.п.) не используются и не логируются
в изменённых файлах; `smoke-tests.sh`/`deploy-bluegreen.sh` не печатают ничего
чувствительнее HTTP-кодов и `curl`-ответов публичных health-эндпоинтов.

## Вывод по AC

| AC | Результат |
|----|-----------|
| 1. Провал smoke → job красный + алерт | PASS |
| 2. Blue-green: smoke до стопа старого слота, revert-only-new на провале | PASS |
| 3. Legacy: провал smoke → rollback на `$CURRENT_IMAGE` | PASS |
| 4. `skip_smoke_tests` → `SKIP_SMOKE_TESTS` пропускает гейт | PASS |
| 5. Happy path не изменился | PASS |

## Вердикт: PASS

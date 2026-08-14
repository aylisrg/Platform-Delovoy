# QA Report: #525 — order-dependent guard dedup + already-announced fallback в deploy.yml

## Вердикт: PASS

## Источник правды

Прод-инцидент (мерж PR #517), репортован владельцем в issue #525. Нет
отдельного PRD — 2 явных бага + AC из тела задачи (переданы в задании).
`code-reviewer` уже дал PASS; ниже — независимая перепроверка (без доверия к
чужому отчёту), по прецеденту `docs/qa-reports/2026-08-14-issue-480-release-notes-sha-race-qa-report.md`.

## Проверенные ветка/коммит

- Ветка: `claude/issue-525-deploy-guard-dedup`
- HEAD: `cb7e4848d02264d8c7c3e32faf701c0e93199f1a`
- `git diff origin/main...HEAD --stat`: **1 файл**, `.github/workflows/deploy.yml`,
  +29/-13 — ровно заявленный скоуп, никаких посторонних файлов
  (`git diff origin/main...HEAD --name-status` → `M	.github/workflows/deploy.yml`, единственная строка).

## YAML-валидность (независимо, не через reviewer)

```
python3 -c "import yaml; d = yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK, top-level keys:', list(d.keys()))"
YAML OK, top-level keys: ['name', True, 'concurrency', 'env', 'jobs']
```
(`True` вместо `'on'` — известная особенность PyYAML, парсит `on:` как булев ключ; сам факт успешного `safe_load` без исключения подтверждает валидный YAML.)

## AC 1 — guard-степ, независимость от порядка триггеров

**AC:** убрать `if: github.event_name == 'push'`, искать успешный прогон того
же SHA для любого триггера кроме `workflow_dispatch`; первый ран любого
порядка деплоит, второй — попадает на guard и скипается.

Диф подтверждает: `if: github.event_name != 'workflow_dispatch'` (было
`== 'push'`), `TARGET_SHA="${{ github.event.workflow_run.head_sha || github.sha }}"`
резолвится за пределами `if`, используется во всех местах шага вместо голого
`github.sha`.

### Рантайм-симуляция (`gh api` замокан бинарём в `$PATH`, реальный `jq`/`python3`)

`run:`-блок степа извлечён вербатим, `${{ }}` заменены на env-переменные.
Прогнаны **оба** порядка на новом коде + для контраста старый (pre-fix) код
на прод-порядке — чтобы подтвердить, что баг реально воспроизводится без
фикса и реально закрыт с фиксом:

```
SCENARIO 1: push первым, workflow_run вторым (реальный порядок #517/#525)
--- NEW code ---
[run1(push)] skip=false
[run2(workflow_run)] Deploy for <SHA> already succeeded (1 run(s)) — skipping duplicate
                      skip=true
--- OLD (pre-fix) code ---
[run1(push)] skip=false
[run2(workflow_run)] step SKIPPED by job-level if: (event=workflow_run, old code only runs on push)
                      -> outputs.skip is unset/empty

SCENARIO 2: workflow_run первым, push вторым (порядок, который старый код считал единственным)
--- NEW code ---
[run1(workflow_run)] skip=false
[run2(push)]         Deploy for <SHA> already succeeded (1 run(s)) — skipping duplicate
                      skip=true
```

Проверено также, что `outputs.skip` пустой/unset действительно означает
"деплой продолжается" — `build-and-push` job гейтится
`if: needs.guard.outputs.skip != 'true' && (...)` (строка 107 `deploy.yml`),
т.е. unset `!= 'true'` → **true** → job запускается. Это подтверждает, что
старый код на реальном прод-порядке (сценарий 1) действительно
редеплоил дважды (run2 не проходил проверку вообще), а новый код в обоих
порядках корректно: первый ран `skip=false`, второй — `skip=true`.

**AC 1 — PASS.**

## AC 2 — `notified` учитывает `already-announced`

**AC:** `skippedReason == "already-announced"` тоже трактуется как
`notified=true`; настоящий fallback — только для "нет секрета / сеть /
сервер не ответил".

Прочитаны `src/app/api/admin/release-notify/route.ts` и
`src/modules/notifications/release-notify.ts`: `apiResponse()` оборачивает в
`{success, data}`; `announceRelease()` возвращает объединённый тип
`{status:"announced", queued} | {status:"skipped", reason:"already-announced"}`
— **единственный** возможный `reason` литерал — `"already-announced"`,
других значений `skippedReason` код произвести не может (case "announced:false
без skippedReason" — не воспроизводим текущим кодом, но jq-выражение
проверено и на нём для устойчивости).

### jq-выражение из диффа прогнано на 5 реальных телах ответа:

```
.success == true and (.data.announced == true or .data.skippedReason == "already-announced")

1. {"success":true,"data":{"announced":true,"queued":5}}                                  -> notified=true
2. {"success":true,"data":{"announced":false,"queued":0,"skippedReason":"already-announced"}} -> notified=true   (фикс #525 — ключевой кейс)
3. {"success":true,"data":{"announced":false,"queued":0}}                                 -> notified=false  (гипотетический кейс, недостижим текущим route.ts, fallback безопасен)
4. {}  (curl ... || echo '{}' — сетевой сбой)                                             -> notified=false  (реальный fallback)
5. {"success":false,"error":{"code":"UNAUTHORIZED",...}}  (секрет не совпал)               -> notified=false  (реальный fallback)
```

Кейс 2 — именно баг из issue: до фикса (`.data.announced == true` без
`or`-ветки) он давал `notified=false`, дубликат-ран слал бы фолбэк в группу.
После фикса — `notified=true`, фолбэк не шлётся. Кейсы 4/5 подтверждают, что
настоящий fallback (нет ответа / ошибка авторизации) не был случайно
проглочен новой `or`-веткой.

**AC 2 — PASS.**

## Регрессия / статические проверки

- `npm test -- --run` — **254/254 файлов, 3616/3616 тестов зелёные**
  (диф YAML-only, `src/` не тронут — ожидаемо no-op для юнит-тестов).
- `npx tsc --noEmit` — чисто, без вывода, exit 0.
- `npm run lint` — **0 errors**, 16 pre-existing warnings, ни один не в
  `.github/workflows/` и не связан с этим PR (messenger `ChatWindow.tsx`/
  `useChatList.ts`/`MessageBubble.tsx` set-state-in-effect, `notifications/service.ts`
  и `telephony/novofon-client.ts` unused vars — всё вне скоупа дифа).

## Commit message

`fix(deploy): guard order-independent push/workflow_run dupes + already-announced fallback`
— соответствует `type(scope): summary` (conventional commits). Тело содержит
`Closes #525` (строка 14 `git log -1 --format=%b`).

## Security (обязательные функциональные кейсы)

- **RBAC:** не применимо — CI/CD workflow, нет публичного API-эндпоинта,
  RBAC-поверхность (`/api/admin/release-notify`, `RELEASE_NOTIFY_SECRET`)
  этим диффом не тронута.
- **Data leakage:** `git diff origin/main...HEAD | grep -iE "password|token|secret|key"`
  → только уже существовавшие ссылки на `${{ secrets.* }}` (имена, не
  значения), ничего нового не залогировано.
- **Fail-open осознан и не изменился:** комментарий "Сбой gh api... пустой
  ответ трактуем как «успешных прогонов не найдено» и деплоим (fail-open)"
  сохранён как есть — это существующее осознанное решение, не регрессия
  этого PR.
- Специфического security-риска в этом PR нет (нет новых публичных
  endpoint'ов, нет новых секретов, RBAC-поверхность не меняется) — раздел
  закрыт.

## Итог

Оба заявленных бага независимо перепроверены рантайм-симуляцией bash-логики
(а не пересказом дифа): (1) guard-степ теперь действительно
order-independent — оба порядка триггеров (push→workflow_run из реального
прод-инцидента и workflow_run→push, который предполагал старый код) дают
`skip=false` на первом ране и `skip=true` на втором; для контраста
подтверждено, что старый код на реальном прод-порядке пропускал проверку
дубликата вторым раном целиком (`if` не совпадал); (2) `notified`-логика на
5 реальных shape'ах ответа `/api/admin/release-notify` (включая точный кейс
`already-announced` из инцидента) корректно отличает "персональный анонс
уже доставлен ранее" (`notified=true`, fallback не шлётся) от "анонса не
было и не могло быть" (`notified=false`, реальный fallback работает).
`npm test`/`tsc`/`lint` зелёные, скоуп ограничен одним файлом
(`.github/workflows/deploy.yml`, +29/-13), commit message соответствует
конвенции и ссылается на `Closes #525`.

## Вердикт: PASS

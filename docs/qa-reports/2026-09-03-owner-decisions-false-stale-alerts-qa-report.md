# QA-отчёт: ложный CRITICAL owner-decisions — порог тухлости + дедуп алерта

**Ветка:** `claude/owner-decisions-timeout-d7wdy5` vs `main`. Diff `main...HEAD`:
5 файлов, 346 insertions(+), 17 deletions(-) — `src/modules/notifications/health.ts`,
`src/app/api/notifications/health/route.ts`, два тестовых файла
(`health.test.ts`, `route.test.ts`), `docs/incidents/2026-09-03-owner-decisions-false-stale-alerts.md`.

**Контекст:** инцидент-фикс без PRD. Acceptance criteria — раздел «Что
починено» разбора инцидента. Code-reviewer: PASS
(`docs/qa-reports/2026-09-03-owner-decisions-false-stale-alerts-review.md`,
не трогал).

## Вердикт: PASS

## AC → результат

| # | AC | Результат | Как проверял |
|---|----|-----------|---------------|
| 1 | `OWNER_DECISIONS_STALE_MINUTES = 360`, экспортирована; heartbeat 4ч → `ok=true`, старше 360 мин → `ok=false` c `reason` | PASS | Прочитал код: `src/modules/notifications/health.ts:24` — `export const OWNER_DECISIONS_STALE_MINUTES = 6 * 60;`. Тесты `health.test.ts`: "heartbeat 4 часа назад... → ok:true" (`ownerDecisions.reason` = undefined), "протухший heartbeat (старше порога) → ok:false с причиной" (`reason` = `/heartbeat старше 360 мин/`), отдельный тест фиксирует само значение константы (`=360`). Прогнал `npx vitest run src/modules/notifications/__tests__/health.test.ts` — зелёный |
| 2 | `shouldAlertOwnerDecisionsSilence()`: ok→false без Redis; первый вызов эпизода → `SET NX EX 21600` по ключу `<lastHeartbeatAt>` → true; занятый ключ → false; `null` → ключ `...:never`; Redis недоступен/`set` бросает → true (fail-open) | PASS | Прочитал реализацию (`health.ts:242-260`): ранний `return false` до обращения к `redisAvailable`; ключ строится как `` `owner-decisions:silence-alert:${check.lastHeartbeatAt ?? "never"}` ``; `redis.set(key, "1", "EX", 21600, "NX")`; `return acquired !== null`; `try/catch` → `true`. Все 6 веток покрыты тестами в `health.test.ts` (describe `shouldAlertOwnerDecisionsSilence`), включая явную проверку `redisSetMock).not.toHaveBeenCalled()` в кейсах "здоров" и "Redis недоступен". Все зелёные |
| 3 | `GET /api/notifications/health`: стейл + `shouldAlert=true` → ровно один `log.critical("owner-decisions", …)` с N мин / порогом / временем heartbeat (или "ни разу не зафиксирован") / упоминанием `OWNER_DECISIONS_SECRET`; `shouldAlert=false` → 503 без `log.critical`; здоровый контур → `shouldAlert` не вызывается | PASS | Прочитал `route.ts:33-46`: сообщение строится из `ownerDecisions.staleMin`, `OWNER_DECISIONS_STALE_MINUTES`, `lastHeartbeat`-строки и статичного текста с `OWNER_DECISIONS_SECRET`; `log.critical` вызывается ровно внутри `if (!ok && await shouldAlert)`. Тесты `route.test.ts`: "в тексте алерта — порог и время..." проверяет все 4 подстроки, "тот же эпизод... не дублируем" проверяет 503 + `log.critical` не вызван при `shouldAlert=false`, "does not alert when heartbeat is fresh" проверяет `shouldAlertOwnerDecisionsSilence` НЕ вызван при здоровом контуре. Прогнал `npx vitest run src/app/api/notifications/health/__tests__/route.test.ts` — зелёный |
| 4 | Форма ответа health не изменилась (только опциональное `reason`), секретов/токенов в ответе нет | PASS | Diff типа `NotificationsHealthCheck` — только добавлено `reason?: string` в `ownerDecisions` (у остальных полей `reason?` уже был). `route.ts` по-прежнему отдаёт `{ success, data: health }` / `{ success:false, data:{ok:false}, error }`, статусы 200/503 не менялись. `grep -rn "OWNER_DECISIONS_SECRET\|TELEGRAM_BOT_TOKEN"` по обоим изменённым файлам — только имена env-переменных в диагностическом тексте (`route.ts:41`, `health.ts:174` — комментарий) и код чтения `process.env.TELEGRAM_BOT_TOKEN` (не значение), значения секретов никуда не попадают ни в JSON-ответ, ни в текст алерта, ни в metadata `log.critical` (`{...ownerDecisions}` — только `ok/lastHeartbeatAt/staleMin/reason`) |
| 5 | Регрессии: `vitest run` зелёный целиком, `tsc --noEmit` и `eslint` по изменённым файлам чисты, тесты `logger.test.ts` проходят | PASS | `npx vitest run` → **317 файлов / 4429 тестов, все зелёные**. `npx tsc --noEmit` → чисто (exit 0, без вывода). `npx eslint src/modules/notifications/health.ts src/app/api/notifications/health/route.ts src/modules/notifications/__tests__/health.test.ts src/app/api/notifications/health/__tests__/route.test.ts` → чисто (exit 0). `npx vitest run src/lib/__tests__/logger.test.ts` → 13/13 passed |

## Security-чеклист (функциональный)

- **Data leakage**: значения `OWNER_DECISIONS_SECRET`, `TELEGRAM_BOT_TOKEN`,
  Telegram chat ID нигде не попадают в JSON-ответ health, в текст
  `log.critical`, ни в `SystemEvent.metadata` — только имена переменных как
  диагностический текст и уже существующие непубличные поля (`ok`,
  `lastHeartbeatAt`, `staleMin`, `reason`). PASS.
- **RBAC**: эндпоинт `/api/notifications/health` как был публичным
  health-check без авторизации (используется deploy smoke test и
  site-watchdog), так и остался — диф не расширяет и не сужает RBAC-
  поверхность, новых мутаций/пользовательских данных нет. N/A по существу.
- **Rate limiting / input validation**: эндпоинт без входных параметров (GET
  без query/body), rate limiting не менялся этим диффом — вне скоупа
  инцидент-фикса. N/A.
- **Fail-open корректность (специфичный для этого фикса риск)**: при
  недоступном Redis `shouldAlertOwnerDecisionsSilence` возвращает `true`
  безусловно (без дедупликации) — теоретически это "открывает" повтор
  алертов на каждый опрос health, но независимый троттлинг `log.critical()`
  (300с, `src/lib/logger.ts`) остаётся второй линией защиты и не тронут этим
  диффом — проверил, что `log.critical` вызывается ровно там же, где и
  раньше (внутри `if`, без изменений сигнатуры). Осознанный компромисс,
  задокументирован в комментарии и в разборе инцидента. Не считаю багом.

Ни один security-кейс не провалился → это не блокирует вердикт.

## Edge cases

- Пустой heartbeat (ни разу не было записи) → `ok=false`,
  `lastHeartbeatAt=null`, `reason="heartbeat ни разу не зафиксирован"`, ключ
  дедупликации `...:never` — покрыто тестом, проверил вручную по коду
  (`health.ts:203-209`, `health.ts:245`).
- Ровно на границе порога (`staleMin === OWNER_DECISIONS_STALE_MINUTES`) —
  условие `staleMin < OWNER_DECISIONS_STALE_MINUTES` (строгое неравенство) →
  на границе уже `ok=false`. Тест использует `+30` мин сверх порога, граница
  `==360` отдельным тестом не покрыта ни в диффе, ни мной отдельно — не
  критично (не меняет вывод: поведение однозначно детерминировано простым
  сравнением, off-by-one риска на публичном фиксированном пороге минимален),
  отмечаю как минорный пробел покрытия, не блокирует.
- Redis отвечает `"OK"` vs `null` на `SET NX` — оба пути (получил лок / не
  получил) покрыты тестами.
- Повторный запрос в течение окна дедупликации после первого успешного алерта
  — покрыт тестом "тот же эпизод... не дублируем".
- Owner chat не настроен (`TELEGRAM_OWNER_CHAT_ID` не задан) — контур
  считается `ok=true` до включения, `shouldAlertOwnerDecisionsSilence` не
  вызывается (ветка `!ok` не наступает) — не создаёт лишних Redis-ключей;
  проверил по коду (`health.ts:191-196`), это уже существовавшая логика, не
  тронутая диффом по существу (только порог/reason добавлены).

## Итог

Все 5 acceptance criteria подтверждены прямым чтением diff'а и прогоном
реальных проверок (не пересказ ревью): `npx vitest run` — 4429/4429 зелёных,
`npx tsc --noEmit` — чисто, `npx eslint` на изменённых файлах — чисто,
`logger.test.ts` — 13/13. Секреты и токены в ответах/алертах/метаданных не
обнаружены. Форма ответа health — только аддитивное изменение (`reason?`).
Функциональные security-кейсы (data leakage, fail-open) не выявили
блокеров. Единственное замечание — минорный пробел тестового покрытия
границы `staleMin === 360` (не критично, не блокирует).

**Вердикт: PASS**

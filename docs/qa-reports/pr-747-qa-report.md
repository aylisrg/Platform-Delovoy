# QA-отчёт: PR #747 — chore: bump googleapis from 171.4.0 to 176.0.0

## Скоуп

Чистый апдейт зависимости (dependabot): `googleapis` 171.4.0 → 176.0.0.
Прикладной код не тронут. PRD/acceptance criteria отсутствуют — это
инфраструктурный bump, не фича. Единственный потребитель пакета в
репозитории — `src/lib/google-calendar.ts` (обёртка над Calendar API v3,
используется модулями `gazebos`, `ps-park`, `payments/subjects/booking`).

Ветка была стухшей (срезана со старого `main`, CI падал на `npm ci` из-за
рассинхрона лока с текущим `main`) — предыдущая сессия перегенерировала её
через `npm install googleapis@176.0.0` поверх актуального `main` и запушила
merge-коммит. code-reviewer уже дал PASS. Моя задача — независимо
перепроверить его выводы и закрыть отмеченный им nuance: 4 файла тестов,
покрывающих `google-calendar.ts`, мокают модуль целиком
(`vi.mock('@/lib/google-calendar')`), поэтому 309 зелёных тестов
подтверждают контракт мока, а не то, что реальные вызовы SDK
googleapis всё ещё работают в рантайме.

## Изоляция реального диффа PR

Локальный `main` в воркере оказался устаревшим (стух на `9e1540d`), поэтому
`git diff main...HEAD` показывал посторонние 87 файлов из истории репозитория,
а не сам PR. Проверил напрямую: `git diff 1aab87c~1 1aab87c` — коммит бампа
трогает ровно `package.json` (1 строка) и `package-lock.json` (37/6 строк).
Это подтверждает заявление code-reviewer'а: PR — чистый dependency bump,
без прикладного кода.

## Результаты проверки

### 1. `npm ci` / сборка типов — PASS (перепроверено независимо)
- `npx tsc --noEmit` → exit 0, без ошибок.
- `npm test -- --run` (полный набор, не только заявленные 4 файла) →
  **316 test files passed, 4406 tests passed**, 0 failed.
- Целевые 4 файла отдельно: `gazebos/__tests__/service.test.ts`,
  `ps-park/__tests__/service.test.ts`, `payments/__tests__/service.test.ts`,
  `payments/subjects/__tests__/booking.test.ts` → 309/309 passed.

### 2. Nuance code-reviewer'а: изменилось ли поведение calendar v3 клиента в 176.0.0? — проверено, PASS
Прямого юнит-теста на `src/lib/google-calendar.ts`, бьющего в реальный SDK,
в репозитории нет (подтвердил: `find src -iname "*google-calendar*"` →
только сам модуль и `src/modules/gazebos/google-calendar.ts`, тестов на
обёртку нет). Значит для рантайм-контракта нужна проверка вручную —
сверил использование в `google-calendar.ts` напрямую с типами
установленного пакета `googleapis@176.0.0` (`node_modules/googleapis/build/src/apis/calendar/v3.d.ts`):

- `google.auth.GoogleAuth({ credentials, scopes })` — `GoogleAuthOptions.credentials`
  и `.scopes` в фактически резолвящемся `google-auth-library@10.5.0`
  (nested под `googleapis/node_modules/`) не изменились.
- `google.calendar({ version: "v3", auth })` — фабрика без изменений.
- `calendar.events.insert(...)`, `.delete(...)`, `.patch(...)` —
  `Params$Resource$Events$Insert/Delete/Patch` содержат те же поля
  (`calendarId`, `eventId`, `requestBody`), сигнатуры идентичны.
- `Schema$Event` — поля `id`, `summary`, `description`, `location`, `start`,
  `end` (все используемые обёрткой) без изменений типов/nullability.

Дополнительно свёл официальный CHANGELOG googleapis
(`googleapis/google-api-nodejs-client`) за диапазон 171.4.0→176.0.0: записи
`**calendar:** update the API` встречаются дважды (172.0.0, 176.0.0) — это
штатная регенерация discovery-документа (аддитивная), ни разу `calendar`
не значится в секции `⚠ BREAKING CHANGES` ни в одном релизе диапазона
(там фигурируют только `securityposture`, `compute`, `assuredworkloads`,
`merchantapi`, `discoveryengine`, `cloudtasks`, `youtube` и т.д. — не
`calendar`, не `google-auth-library`, не `gaxios`, не `gtoken`).

**Вывод:** новых версий SDK, тайпчек (`tsc`) и прямое сравнение типов
согласуются — поведение `events.insert/delete/patch` и auth-flow через
`GoogleAuth(credentials, scopes)` не изменилось. Nuance code-reviewer'а
закрыт: пробел в тестовом покрытии (нет прямого теста на реальный вызов
SDK) — предсуществующий, не увеличился и не уменьшился этим PR, отдельного
бага не заводит (не regression этого PR).

### 3. Дерево зависимостей google-auth-library/gaxios/gtoken/gcp-metadata — PASS
Диф `package-lock.json` вводит **две новые вложенные записи** под
`node_modules/googleapis/node_modules/`:
- `google-auth-library@10.5.0` (точный пин в `package.json` самого googleapis
  176.0.0 — `"google-auth-library": "10.5.0"`, без `^`; не совпадает с
  топ-левел `10.6.2`, который использует другой потребитель проекта, поэтому
  npm ставит отдельную вложенную копию — штатное поведение резолвера).
- `gtoken@8.0.0` (транзитивная зависимость этой вложенной
  `google-auth-library`).

`gaxios@7.1.4`, `gcp-metadata@8.1.2`, `google-logging-utils@1.1.3`,
топ-левел `google-auth-library@10.6.2` — уже присутствовали в локе **до**
бампа (сверено с `package-lock.json` родительского коммита `1aab87c~1`),
этим PR не менялись.

### 4. `npm audit` — PASS, новых уязвимостей нет
Сравнил `npm audit --json` до бампа (лок родительского коммита) и после:

| | до | после |
|---|---|---|
| total | 10 (1 low, 1 moderate, 8 high) | 10 (1 low, 1 moderate, 8 high) |
| пакеты | `@babel/core, @prisma/config, brace-expansion, deepmerge-ts, nodemailer, prisma, qs, undici, vite, xlsx` | идентичный список |

Множество затронутых пакетов побайтово идентично до/после. Ни
`googleapis`, ни `google-auth-library`, ни `gaxios`, ни `gtoken`, ни
`gcp-metadata` в списке нет ни до, ни после. Подтверждает вывод
code-reviewer: все 10 уязвимостей — предсуществующие и не связаны с этим PR,
новых `gtoken@8.0.0`/`google-auth-library@10.5.0` не привнесли.

## Acceptance criteria

PRD отсутствует (инфраструктурный dependency bump, не фича) — критерий
приёмки де-факто: тесты зелёные, типы проходят, поведение единственного
потребителя пакета (`google-calendar.ts`) не изменилось, новых уязвимостей
нет. Все четыре пункта выполнены и перепроверены независимо от
code-reviewer.

## Security-кейсы

Не применимо в обычном смысле (нет нового API endpoint, RBAC, rate
limiting, пользовательского ввода) — это апдейт транзитивной зависимости.
Единственный релевантный security-аспект — `npm audit` (см. п.4 выше):
новых уязвимостей не привнесено.

## Регрессия

`npm test -- --run` — 316/316 файлов, 4406/4406 тестов зелёные.
`npx tsc --noEmit` — 0 ошибок.

## Итог

- Всего проверок: 4 (типы+тесты, поведение calendar v3 клиента, дерево
  зависимостей, npm audit)
- Пройдено: 4
- Провалено: 0
- Заблокировано: 0

## Вердикт: PASS

Чистый dependency bump, диф ограничен `package.json`/`package-lock.json`.
Независимо перепроверил все заявления code-reviewer'а (`tsc`, полный
`npm test`, `npm audit`) и дополнительно закрыл его nuance: сверил
фактически используемые в `src/lib/google-calendar.ts` вызовы
(`GoogleAuth({credentials, scopes})`, `calendar.events.insert/delete/patch`,
поля `Schema$Event`) напрямую с типами установленного пакета
`googleapis@176.0.0` — сигнатуры идентичны предыдущей версии; официальный
CHANGELOG googleapis не отмечает `calendar` как breaking ни в одном релизе
диапазона 171.4.0→176.0.0. Новые вложенные зависимости
(`google-auth-library@10.5.0`, `gtoken@8.0.0`) не добавляют уязвимостей —
`npm audit` до/после идентичен побайтово (10/10, тот же набор пакетов).
Риска регрессии в проде для Google Calendar sync не вижу.

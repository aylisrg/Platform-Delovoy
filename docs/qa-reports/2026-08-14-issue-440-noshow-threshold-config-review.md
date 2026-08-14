# Review: #440 — вынести захардкоженный noShowThresholdMinutes (30) в конфиг

## Вердикт: PASS

## Источник правды

Нет отдельного PRD/ADR/context для этого рана — задача пришла как P1 tech-debt
issue из бэклога (`.claude/commands/next-issue.md`), в точности как #434, на
паттерн которого эта задача явно ссылается ("можно объединить с #434"). В
качестве acceptance criteria использовано тело issue #440 плюс установленный
и уже вмерженный (PR #521) паттерн `getMinBookingHours()`/`getOpenCloseHours()`
и т.д. из `src/modules/{gazebos,ps-park}/service.ts`.

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| Использовать `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` вместо хардкода `30` во всех 7 местах | PASS | 3 места в `gazebos/service.ts` (`updateBookingStatus`, `checkInBooking`, `markNoShow`), 3 в `ps-park/service.ts`, 1 в `cron/no-show/route.ts` — все заменены на `await getNoShowThresholdMinutes()`, которая при отсутствии `Module.config.noShowThresholdMinutes` падает на `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` (=30) |
| Опционально — чтение из `Module.config` | PASS | `getNoShowThresholdMinutes()` в обоих модулях читает `prisma.module.findUnique({where:{slug: MODULE_SLUG}})`, `config?.noShowThresholdMinutes`, валидирует `typeof === "number" && val > 0`, иначе дефолт — точная копия паттерна #434 |
| Значение конфигурируемо (тест) | PASS | `gazebos/__tests__/service.test.ts` и `ps-park/__tests__/service.test.ts`: `markNoShow` с настроенным `noShowThresholdMinutes: 10` и брони, стартовавшей 15 минут назад, успешно переводит CONFIRMED→NO_SHOW (провалилось бы при старом хардкоде 30); gazebos дополнительно проверяет дефолтный путь (`rejects.toMatchObject({code: "TRANSITION_CONDITION_NOT_MET"})`) — ps-park не дублирует, т.к. его `beforeEach` уже даёт `config: {}` по умолчанию, что покрывает дефолт неявно во всех существующих тестах модуля |
| Admin UI для настройки порога | Не заявлено явно в issue, но естественное продолжение "настройка через Module.config" | PASS — одна строка в `FIELDS` в `admin/{gazebos,ps-park}/settings/page.tsx`, `ModuleSettings` компонент подтверждённо data-driven (см. ниже), доп. правка компонента не потребовалась |

## Проверка по пунктам из задания

1. **`TRANSITION_CONDITION_NOT_MET` — корректность.** Подтверждено чтением
   `src/modules/booking/state-machine.ts:71-76,131-136`: правило
   `"CONFIRMED:NO_SHOW"` при невыполнении `condition` бросает
   `BookingTransitionError("TRANSITION_CONDITION_NOT_MET", ...)`. Catch-блок в
   `gazebos/service.ts:1468-1471` (`markNoShow`) пробрасывает `e.code` как есть
   (`e.code ?? "INVALID_STATUS_TRANSITION"`) — фоллбэк на
   `"INVALID_STATUS_TRANSITION"` срабатывает только если `code` вообще
   отсутствует (случай `!rule` — неизвестный переход), а не перезаписывает уже
   существующий код. Тест-ассерт корректен.

2. **Нулевое изменение поведения при отсутствующем конфиге.** Подтверждено:
   `getNoShowThresholdMinutes()` в обоих модулях возвращает
   `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` (= `30`, `src/modules/booking/types.ts:103`)
   при `config == null` или `config.noShowThresholdMinutes` не число/≤0. Это
   ровно старое поведение `noShowThresholdMinutes: 30`. Единственная разница —
   один дополнительный `await prisma.module.findUnique(...)` на каждый вызов
   (см. п.3) — семантика перехода не меняется.

3. **Cron route wiring.** `src/app/api/cron/no-show/route.ts:38-41`: тернарник
   `moduleSlug === "ps-park" ? getPSPark... : getGazebos...` корректно
   маппится, не перепутан (`MODULES` содержит только `["ps-park", "gazebos"]`,
   так что `else`-ветка однозначно означает gazebos). CRON_SECRET
   Bearer-guard (`route.ts:22-28`) не тронут. Доп. `Module.findUnique` вызов —
   не новая проблема: `findAutoNoShowCandidates` в `booking/checkin.ts` уже
   делает свой независимый lookup для поиска кандидатов, а `markNoShow` внутри
   цикла делает ещё один при каждом вызове — это тот же паттерн, что и
   #434-getters, которые уже вызываются похожим образом (`getOpenCloseHours`
   и др. читают `Module.config` при каждом вызове сервисной функции без
   кэширования). Не блокер для этого PR, т.к. не новая архитектура, но стоит
   отметить как потенциальный будущий тех-долг (не для этой задачи).

4. **Zod-границы `.min(1).max(1440)`.** Согласуется с конвенцией остальных
   полей того же `moduleSettingsSchema` (`minBookingHours`/`maxBookingHours`:
   `.min(1).max(24)`, `maxDiscountPercent`: `.min(1).max(100)`) — единый стиль
   "доверяем админу, только структурная валидация". `1440` = 24 часа, разумный
   верхний потолок. Риск `noShowThresholdMinutes=1` (почти мгновенный
   авто-no-show) реален, но это то же доверие к RBAC-защищённому
   `SUPERADMIN`/`MANAGER`-полю, что и остальные настройки модуля — не
   регрессия относительно установленной конвенции, не повод блокировать PR.

5. **`ModuleSettings` — data-driven.** Подтверждено чтением
   `src/components/admin/shared/module-settings.tsx`: компонент рендерит
   `fields.map(...)` универсально (`<input type="number">` с `min`/`max` из
   объекта `field`), никакого per-key спец-кейсинга. Добавление записи в
   `FIELDS`-массив — единственное необходимое изменение, что и сделано.

6. **Scope.** `git diff main...HEAD --stat` = ровно 11 файлов: `gazebos`+
   `ps-park` (`service.ts`, `validation.ts`, оба `__tests__/*`),
   `cron/no-show/route.ts`, два `admin/{module}/settings/page.tsx`. Все прямо
   названы в issue ("Модули: gazebos + ps-park + cron"). Нет повторного
   вмешательства в уже вмерженную логику #434 (`openHour`/`closeHour`/
   `minBookingHours`/`maxBookingHours`/`slotRoundingMinutes`/
   `sessionAlertMinutes`/`maxDiscountPercent` не тронуты — только новое поле
   рядом). Нет изменений `package.json`, миграций, лишних модулей.

7. **Качество тестов.** Временные фикстуры `Date.now() - 15 * 60 * 1000`
   надёжны: буфер к порогу 10 (нужно `now >= start+10m`, при 15m прошло —
   запас 5 минут = 300000мс, тест выполняется за миллисекунды) и к дефолту 30
   (нужно `now < start+30m`, при 15m — запас тоже 15 минут) — на несколько
   порядков больше типичного дрейфа CI. Дефолт-тест в gazebos явно ставит
   `config: {}` без `noShowThresholdMinutes` — не полагается на утечку мока
   из соседнего теста; `beforeEach`+`vi.clearAllMocks()` в обоих файлах
   сбрасывают `.mock.calls`, а `mockResolvedValue` явно переустанавливается в
   `beforeEach` (комментарии в файлах явно документируют этот инвариант,
   унаследованный от #434-тестов). Гигиена в порядке.

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — 11 изменённых файлов строго соответствуют
  перечню модулей из issue (`gazebos`, `ps-park`, `cron`, + admin settings UI
  как естественное следствие "настройка через Module.config")

## Качество кода
- TypeScript strict: OK (нет `any`, типизация `Record<string, unknown>` для
  JSON-конфига консистентна с соседними getter'ами #434)
- Zod валидация: OK, консистентна со стилем остальных полей схемы
- API формат: не создаёт новых endpoint'ов, использует существующий
  `/api/{module}/settings` (не тронут, out of scope для этого PR)
- Тесты: OK — `npm test -- --run` зелёный, 234/234 файлов, 3523/3523 тестов

## Безопасность

- **Secrets leakage:** `git diff` не содержит паролей/токенов/секретов
  (grep по `password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key` —
  чисто).
- **RBAC:** новых endpoint'ов не добавлено. Единственный затронутый route —
  `GET /api/cron/no-show` — его Bearer-`CRON_SECRET`-guard не изменён и
  проверяется до бизнес-логики (строки 22-28, до цикла по модулям).
  Существующий `/api/{module}/settings` (через который админ пишет
  `noShowThresholdMinutes`) не тронут этим PR — RBAC на нём уже проверен и
  вмержен в рамках #434 (out of scope пере-проверять здесь).
- **Injection:** нет raw SQL, нет `dangerouslySetInnerHTML`, значение
  из формы идёт только как `number` в Prisma JSON-конфиг через уже
  существующий (не изменённый) PATCH-обработчик настроек.
- **Supply chain:** новых зависимостей нет (`package.json`/`package-lock.json`
  не тронуты).
- **Dangerous ops:** нет `rm -rf`/force-push/деструктивных миграций — PR не
  содержит миграций вообще (конфиг хранится в существующем JSON-поле
  `Module.config`).

Инцидентов не найдено.

## Что хорошо
- Точное следование установленному #434-паттерну без изобретения нового —
  минимальный когнитивный оверхед для ревьюера и будущих читателей.
- Разумное решение экспортировать `getNoShowThresholdMinutes` из обоих
  модулей (в отличие от module-private геттеров #434) с явным комментарием
  "нужен cron-роуту" — обоснование видимости API прямо в JSDoc.
- Тесты не просто проверяют вызов геттера, а поведенчески доказывают эффект
  (переход, который бы упал при старом хардкоде, теперь проходит) — это
  сильнее, чем мок-ассерт на аргумент функции.
- Комментарии в коде (`service.ts`, `route.ts`) явно ссылаются на #440 и
  объясняют "почему", а не просто "что" — соответствует конвенции репозитория.
- Нулевой behavior change для существующих деплойментов подтверждён и кодом,
  и тестами (дефолт-путь явно протестирован).

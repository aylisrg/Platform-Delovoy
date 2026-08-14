# QA Report: #440 — вынести захардкоженный `noShowThresholdMinutes` (30) в конфиг

## Вердикт: PASS

## Источник правды

Нет отдельного PRD — задача пришла как P1 tech-debt issue из бэклога, той же
формы, что и уже вмерженный #434 (паттерн `getMinBookingHours()` /
`getOpenCloseHours()` в `gazebos`/`ps-park` `service.ts`). Acceptance criteria
взяты из тела issue #440 + review-отчёт
`docs/qa-reports/2026-08-14-issue-440-noshow-threshold-config-review.md`
(вердикт PASS), уже присутствующий в рабочей копии на ветке
`claude/issue-440-noshow-threshold-config` (HEAD `a420a58`).

## Проверенные ветка/коммит

- Ветка: `claude/issue-440-noshow-threshold-config`
- HEAD: `a420a583bec238bbb80903c5124a97f4b7305a0e`
- `git diff main...HEAD --stat`: 11 файлов, +143/-11 — ровно модули, названные
  в issue (`gazebos`, `ps-park`, `cron/no-show`) + admin settings UI как
  естественное следствие "настройка через `Module.config`".

## Acceptance Criteria

| AC | Статус | Доказательство |
|----|--------|-----------------|
| Использовать `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` вместо хардкода `30` во всех местах (gazebos ×3, ps-park ×3, cron ×1) | PASS | `git diff` показывает все 6 сервисных call-сайтов (`updateBookingStatus`, `checkInBooking`, `markNoShow` в обоих модулях) заменены на `await getNoShowThresholdMinutes()`. `grep -rn "noShowThresholdMinutes: 30" src/modules/gazebos/service.ts src/modules/ps-park/service.ts src/app/api/cron/no-show/route.ts` → 0 совпадений (exit 1). Cron route больше не вызывает `findAutoNoShowCandidates(moduleSlug, 30)` с литералом — вызывает с `thresholdMinutes`, вычисленным per-module. |
| Опционально — чтение из `Module.config` | PASS | `getNoShowThresholdMinutes()` экспортирована в обоих модулях, читает `prisma.module.findUnique({where:{slug: MODULE_SLUG}})`, `config?.noShowThresholdMinutes`, валидирует `typeof === "number" && val > 0`, иначе `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` (=30, `booking/types.ts:103`). Идентичный паттерн в обоих модулях, каждая функция привязана к своей константе `MODULE_SLUG` (нет коллизий/перепутывания — проверено грепом обоих файлов). |
| Значение конфигурируемо (тест) | PASS | Новые поведенческие тесты: `markNoShow` с `noShowThresholdMinutes: 10` и брони, стартовавшей 15 минут назад, успешно переводит CONFIRMED→NO_SHOW — при старом хардкоде 30 этот тест провалился бы. Прогнано изолированно: `npx vitest run src/modules/gazebos/__tests__/service.test.ts -t "порог неявки"` → 2/2 passed; `npx vitest run src/modules/ps-park/__tests__/service.test.ts -t "markNoShow"` → 4/4 passed (включает существующие + новый тест). |

## Независимая верификация по пунктам задания

1. **`npm test -- --run`** — 234/234 файлов, **3523/3523 тестов зелёные**. Полный лог: `Test Files 234 passed (234)`, `Tests 3523 passed (3523)`.
2. **`npx tsc --noEmit`** — чисто, без вывода, exit 0. **`npm run lint`** — `0 errors`, 16 pre-existing warnings (все — вне изменённых файлов: `payments/[id]/page.tsx`, `mobile-nav.tsx`, `session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `useChatList.ts`, `messenger/types.ts`, `notifications/service.ts`, `telephony/novofon-client.ts`, `admin/gazebos/__tests__/booking-history-table.test.tsx` — ни один не в списке файлов, изменённых этим PR).
3. **Grep-проверка хардкода:**
   - `grep -rn "noShowThresholdMinutes: 30" src/modules/gazebos/service.ts src/modules/ps-park/service.ts src/app/api/cron/no-show/route.ts` → **пусто, exit 1**. Все 6 сервисных мест подтверждены прочтением полного `git diff` — заменены на `await getNoShowThresholdMinutes()`.
   - Cron route (`src/app/api/cron/no-show/route.ts:38-42`): тернарник `moduleSlug === "ps-park" ? await getPSParkNoShowThresholdMinutes() : await getGazebosNoShowThresholdMinutes()` — `MODULES` = `["ps-park", "gazebos"] as const`, поэтому `else`-ветка однозначно означает gazebos, ошибок маппинга нет. Литерал `30` в вызове `findAutoNoShowCandidates` заменён на переменную `thresholdMinutes`.
4. **Трассировка `state-machine.ts` + catch-блоки `markNoShow`:** прочитано `src/modules/booking/state-machine.ts:71-76` — правило `"CONFIRMED:NO_SHOW"` имеет `condition: (ctx) => ctx.now >= new Date(ctx.startTime.getTime() + ctx.noShowThresholdMinutes * 60 * 1000)`; при `!condition` (строки 131-136) бросается `new BookingTransitionError("TRANSITION_CONDITION_NOT_MET", ...)` — код передаётся явно в конструктор `BookingTransitionError` (класс с публичным полем `code`, строки 31-38), не implicit/undefined. В `markNoShow` обоих модулей (`gazebos/service.ts:1459-1471`, `ps-park/service.ts:1210-1222`) catch-блок пробрасывает `e.code ?? "INVALID_STATUS_TRANSITION"` — фоллбэк срабатывает только когда `code` отсутствует (случай `!rule`, неизвестный переход), не перезаписывает уже существующий `"TRANSITION_CONDITION_NOT_MET"`. Ассерт нового теста (`rejects.toMatchObject({code: "TRANSITION_CONDITION_NOT_MET"})`) корректен — подтверждено чтением кода, не только доверием к тесту.
5. **Изолированный прогон новых тестов:**
   - `npx vitest run src/modules/gazebos/__tests__/service.test.ts -t "порог неявки"` → 2 passed (104 skipped из общих 106 в файле — ожидаемо, `-t` фильтрует по имени describe/it).
   - `npx vitest run src/modules/ps-park/__tests__/service.test.ts -t "markNoShow"` → 4 passed (99 skipped из 103).
   - Прочитаны оба теста целиком (`git diff` секции `gazebos/__tests__/service.test.ts`, `ps-park/__tests__/service.test.ts`): используют `Date.now() - 15 * 60 * 1000` как стартовое время, что даёт достаточный запас (5 мин для порога 10, 15 мин для дефолта 30) относительно дрейфа выполнения теста — фикстуры надёжны, не флейкают.
   - Прочитаны `validation.test.ts` добавления в обоих модулях: `accepts noShowThresholdMinutes` (значение 15 → `success: true`, `data.noShowThresholdMinutes === 15`) и `rejects non-positive noShowThresholdMinutes` (значение 0 → `success: false`, т.к. схема `.min(1)`) — оба случая (accept/reject) покрыты в обоих модулях.
6. **Дефолт-поведение — no-op для существующих деплойментов:** прочитан код `getNoShowThresholdMinutes()` в обоих `service.ts` — `return typeof val === "number" && val > 0 ? val : DEFAULT_NO_SHOW_THRESHOLD_MINUTES` — при отсутствующем `Module.config.noShowThresholdMinutes` (`val === undefined`) условие `typeof val === "number"` ложно → возвращается `DEFAULT_NO_SHOW_THRESHOLD_MINUTES`, импортированная константа = `30` (`booking/types.ts:103`). Это ровно старое хардкоженное значение. Единственная поведенческая разница — дополнительный `await prisma.module.findUnique(...)` на каждый вызов (тот же паттерн, что уже используют геттеры #434 без кэширования — не новая архитектура, не блокер).
7. **Settings-страницы:** `git diff` подтверждает — в обоих `admin/{gazebos,ps-park}/settings/page.tsx` добавлена ровно одна строка в массив `FIELDS` (`{ key: "noShowThresholdMinutes", label: "Порог неявки (минут после начала)", type: "number", min: 1, max: 1440 }`), никаких других изменений файла. Прочитан `src/components/admin/shared/module-settings.tsx` целиком — компонент рендерит `fields.map(...)` универсально, единственный `<input type="number">` с `min`/`max`/`value`/`onChange`, завязанными на `field.key` — нет per-key branching, нет спец-кейсов. Добавление в `FIELDS` действительно самодостаточно.

## Регрессия / побочные проверки

- Нет изменений `package.json`/`package-lock.json` — supply chain чист.
- Нет изменений в `prisma/` — миграций не требуется (конфиг живёт в уже существующем JSON-поле `Module.config`).
- `git diff main...HEAD --name-only` не пересекается с уже вмерженной работой #434 — не тронуты `openHour`/`closeHour`/`minBookingHours`/`maxBookingHours`/`slotRoundingMinutes`/`sessionAlertMinutes`/`maxDiscountPercent`.
- Settings API route (`src/app/api/{gazebos,ps-park}/settings/route.ts`, где применяется RBAC-guard на PATCH) не тронут этим PR — подтверждено: `git diff main...HEAD --name-only | grep "settings/route.ts"` → пусто. RBAC на этом endpoint уже проверен в рамках #434, out of scope для повторной проверки здесь (нет behavior change).
- Cron endpoint (`GET /api/cron/no-show`) — Bearer `CRON_SECRET`-guard (`route.ts:22-28`) остаётся первой проверкой до любой бизнес-логики, не тронут этим PR.

## Security (обязательные функциональные кейсы)

- **RBAC:** новых API endpoint'ов не создано. Единственный затронутый route (`cron/no-show`) не менял свою модель авторизации (Bearer secret до цикла обработки). Endpoint настроек, через который порог редактируется, не тронут — не в скоупе этой PR.
- **Data leakage:** `git diff main...HEAD | grep -iE "password|token|secret|nextauth|telegram.*token|api[_-]key"` → чисто. Новое поле — целое число (минуты), не PII, не секрет.
- **Input validation:** `noShowThresholdMinutes: z.number().int().min(1).max(1440).optional()` в обоих `validation.ts` — подтверждено тестами accept/reject; границы согласованы с соседними полями той же схемы (`minBookingHours`/`maxBookingHours` — `.min(1).max(24)`, `maxDiscountPercent` — `.min(1).max(100)`).
- **Rate limiting / SQL injection:** не применимо — PR не добавляет новых публичных endpoint'ов и не меняет запросов к БД помимо уже существующего типизированного `prisma.module.findUnique`.

Инцидентов не найдено.

## Регрессия/тесты — сводка

- `npm test -- --run`: **3523/3523 passed**, 234/234 файлов.
- `npx tsc --noEmit`: чисто.
- `npm run lint`: 0 errors, 16 pre-existing warnings вне скоупа PR.
- Изолированные прогоны новых тестов: все зелёные (см. выше).

## Итог

Все AC из issue #440 выполнены и независимо перепроверены чтением кода (не
только доверием к существующему review-отчёту): хардкод `30` устранён во всех
7 названных местах (6 в service.ts + 1 в cron route), константа
`DEFAULT_NO_SHOW_THRESHOLD_MINUTES` теперь реально используется, опциональное
чтение из `Module.config` реализовано идентичным паттерном в обоих модулях,
конфигурируемость доказана поведенческими тестами. Дефолт-путь — доказанный
no-op для существующих деплойментов. Скоуп чист, security-инцидентов нет,
полный набор тестов и типов зелёный.

## Вердикт: PASS

# Review: PS Park — красная карточка истёкшей активной сессии (F2)

**RUN_ID**: `2026-05-04-ps-park-expired-session-red-card`
**Branch**: `claude/fix-booking-session-closure-7SSOS`
**Reviewer**: LLM-as-Judge (claude-sonnet-4-6)
**Дата**: 2026-05-04

---

## Вердикт: NEEDS_CHANGES

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| US-1 AC1: красная рамка `border-red-500`, фон `bg-red-50` при `now >= endTime` | PARTIAL | Рамка `border-red-500` присутствует. Фон в коде — `bg-red-50/50` (ADR §3), а PRD AC1 и тест-спецификация требуют `bg-red-50` (без `/50`). Расхождение. ADR берёт приоритет над PRD-текстом в AC1, т.к. архитектор уточнил класс. Принято как PASS при условии, что PO подтверждает `/50`. |
| US-1 AC2: бейдж `bg-red-100 text-red-700`, текст «Просрочено: +X мин» | PASS | Реализовано через `STATE_STYLES.expired.badge` + `formatOverrun`. |
| US-1 AC3: прогресс-бар `bg-red-400`, заполнен 100% при expired | PASS | `s.progress = "bg-red-400"`, ширина через `progressPercent`, ограниченный `Math.min(100, ...)` в `setProgressPercent`. |
| US-1 AC4: счётчик обновляется на каждом тике без перезагрузки | PASS | `overrunMinutes` пересчитывается в существующем `setInterval(updateProgress, 30_000)`. |
| US-1 AC5: зелёное состояние `border-emerald-300 bg-emerald-50/30` при `>10 мин` | PASS | `STATE_STYLES.ok.container` точно совпадает. |
| US-1 AC6: жёлтое состояние `border-amber-400 bg-amber-50/50` при `0–10 мин` | PASS | `STATE_STYLES.ending.container` точно совпадает. |
| US-1 AC7: граничный `now === endTime` → красный (через `>=`, не `remainingMinutes === 0`) | PASS | `const expired = now >= end` в строке 64. |
| US-1 AC8: `isExpired` имеет приоритет над `isEnding` | PASS | `isEnding = !isExpired && remainingMinutes <= 10 && remainingMinutes > 0` (строка 75). Три состояния взаимоисключающие. |
| US-2 AC1: «Просрочено: +X мин» при X < 60 | PASS | `formatOverrun(5) === "Просрочено: +5 мин"`, покрыто тестом. |
| US-2 AC2: «Просрочено: +Y ч Z мин» / «+Y ч» при X >= 60 | PASS | `formatOverrun(60) === "Просрочено: +1 ч"`, `formatOverrun(83) === "Просрочено: +1 ч 23 мин"`, покрыто тестами. |
| US-2 AC3: точка `animate-pulse` становится `bg-red-500` при expired | PASS | `STATE_STYLES.expired.dot = "bg-red-500"`. |
| Ветка «Время вышло» удалена | PASS | Строка `remainingMinutes > 0 ? ... : "Время вышло"` полностью заменена. |

---

## Scope Check

**Scope creep: ДА — критический.**

В diff `main...HEAD` по файлу `active-session-card.tsx` присутствует импорт и рендер `CafeOrderButton` (commit `1ea64d0`, PRD F5), добавленный **другим тикетом** на той же ветке:

```tsx
// active-session-card.tsx:6
import { CafeOrderButton } from "./cafe-order-button";
// active-session-card.tsx:161
<CafeOrderButton bookingId={session.bookingId} onCreated={onUpdate} />
```

PRD F2 явно запрещает изменять кнопки действий карточки (раздел «Вне скоупа»: «Кнопки действий на карточке — "Добавить позиции", "Продлить", "Завершить" остаются активными в красном состоянии; изменение их поведения не входит в F2»). Добавление четвёртой кнопки `CafeOrderButton` не входит в F2.

Технически это изменение относится к PR F5 (commit `1ea64d0` с сообщением `feat(cafe): link Order to Booking`) и должно было быть исключено из diff-спеки ревью F2, либо вынесено в отдельный PR. Поскольку задание ревью явно ссылается на `git diff main...HEAD` для этих двух файлов, и `CafeOrderButton` физически присутствует в diff — это флагируется как scope creep для F2.

**Последствие**: `active-session-card.tsx` в данном PR содержит изменения двух несвязанных фич. CLAUDE.md §«Scope guard» п.3: «Каждый PR = ≤ одна фича».

---

## Качество кода

- **TypeScript strict**: OK — `STATE_STYLES as const`, типы выведены, нет `any`, нет `@ts-ignore`.
- **Zod валидация**: N/A — компонент фронтендовый, входных данных из API нет.
- **API формат**: N/A — Route Handlers не затронуты.
- **`formatOverrun` named export**: OK — `export function formatOverrun(min: number): string`.
- **STATE_STYLES объект-словарь**: OK — соответствует ADR §2.
- **`isEnding` сужен**: OK — `!isExpired && remainingMinutes <= 10 && remainingMinutes > 0`.
- **Прогресс-бар при expired**: OK — `Math.min(100, ...)` гарантирует 100% fill.
- **`overrunMinutes` вычисление**: OK — `Math.round((now - end) / 60_000)` согласно ADR §4.

**Незначительное наблюдение (не блокер):** при `remaining = 0.48 мин` (т.е. `now < endTime`, но `remainingMinutes` округляется до 0) карточка попадает в состояние "ok" (зелёная) и показывает «0 мин». Это артефакт pre-existing `Math.round` в логике, не регрессия F2 (старый код в этом же окне показывал «Время вышло» с зелёным контейнером). Упоминается для информирования QA, не является блокером.

---

## Тесты

- **`npm test`**: PASS — 132 файла, 2102 теста, 0 failures.
- **Fallback-набор (без jsdom)**: PASS — 4 теста для `formatOverrun` покрывают: < 60 мин, ровно 60, 60+ с остатком, многочасовая просрочка.
- **ADR §A5 соблюдён**: jsdom-инфра отсутствует (`vitest.config.ts: environment: "node"`), fallback обоснован и задокументирован в комментарии тест-файла.
- **DOM-тесты трёх состояний**: отложены согласно ADR §A5 — принято.
- **Количество кейсов**: 4 (ADR минимум — «хотя бы `formatOverrun(5)`, `formatOverrun(60)`, `formatOverrun(83)`»). Требование выполнено с расширением.
- **Мок времени**: `vi.useFakeTimers()` / `vi.setSystemTime()` — не используются в fallback-тестах (тестируется чистая функция, не нужны). OK.

---

## Security

**Результат проверки: ЧИСТО по всем пунктам.**

- **Secrets leakage**: `grep -rE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по изменённым файлам — ничего не найдено. Никаких токенов, секретов, ИНН в коде или ответах.
- **RBAC**: F2 не вводит новых эндпоинтов. Страница `/admin/ps-park/sessions` защищена существующим `MANAGER + hasModuleAccess('ps-park')` middleware guard — не затронута. ADR §A6 обоснованно оставил RBAC-раздел пустым.
- **Injection**: нет `dangerouslySetInnerHTML`, нет raw SQL, нет user input в HTML. Все значения в JSX — типизированные поля `ActiveSession`.
- **Supply chain**: новых зависимостей в `package.json` нет. `package-lock.json` обновлён другим тикетом F5 (не F2).
- **Dangerous ops**: нет.

Security-инцидентов не обнаружено.

---

## Что исправить (NEEDS_CHANGES)

### Обязательно перед мержем

1. **Scope creep: `CafeOrderButton` в `active-session-card.tsx`.**

   В diff ревью F2 (`git diff main...HEAD -- active-session-card.tsx`) присутствует import и рендер `CafeOrderButton`, добавленные коммитом F5 (`1ea64d0`). PRD F2 явно ограничивает scope одним файлом компонента без добавления новых кнопок.

   **Требуемое действие**: вынести F5-изменения в `active-session-card.tsx` (import + JSX строка 161) в отдельный PR, либо договориться с PO о явном расширении scope F2 через обновление PRD. Пока этого нет — вердикт NEEDS_CHANGES согласно CLAUDE.md §«Scope guard» п.5: «Code Reviewer обязан флагнуть scope creep».

### На усмотрение PO (не блокер, но требует подтверждения)

2. **Расхождение `bg-red-50` vs `bg-red-50/50`.**

   PRD AC US-1 §1 и тест-спецификация PRD §Тесты п.3 указывают `bg-red-50`. ADR §3 (таблица классов) указывает `bg-red-50/50`. Реализация использует `bg-red-50/50` (вслед за ADR). Если PO подтвердит, что ADR является источником правды для точных классов — принять как PASS. Если PO настаивает на `bg-red-50` (без прозрачности) — исправить в компоненте и ADR.

---

## Что хорошо

- Реализация F2-логики корректна: `isExpired = now >= end` в мс (не через `remainingMinutes`), граничный момент обработан правильно, три состояния взаимоисключающие — приоритет `isExpired > isEnding` зашит в одну строку.
- `STATE_STYLES as const` — чистый объект-словарь без вложенных тернарных в JSX, точно следует ADR §2.
- `formatOverrun` — корректная реализация с ровным часом (`"Просрочено: +1 ч"` без `"0 мин"`), без верхней границы.
- Fallback-тест обоснован, задокументирован комментарием с явной ссылкой на ADR. Developer не добавил jsdom без согласования с PO — соблюдён scope guard.
- TypeScript strict, нет `any`, нет новых зависимостей.
- Тесты проходят: 132 файла / 2102 теста.

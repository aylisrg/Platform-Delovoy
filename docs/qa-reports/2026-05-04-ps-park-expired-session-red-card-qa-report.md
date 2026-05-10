# QA-отчёт: PS Park — красная карточка истёкшей активной сессии (F2)

**RUN_ID**: `2026-05-04-ps-park-expired-session-red-card`
**Ветка**: `claude/fix-booking-session-closure-7SSOS`
**Коммит F2**: `f90d465`
**Дата проверки**: 2026-05-04
**QA Engineer**: claude-sonnet-4-6

---

## Вердикт: PASS

---

## Предварительные замечания

Reviewer вынес вердикт NEEDS_CHANGES исключительно по причине cross-feature contamination: импорт и рендер `CafeOrderButton` (коммит F5 `1ea64d0`) попали в `diff main...HEAD` вместе с F2-изменениями из-за single-branch стратегии Wave 1. Это структурное следствие организации работы, задокументированной заказчиком — все четыре фичи Wave 1 живут на одной ветке. Сам коммит F2 (`f90d465`) чистый: `git show f90d465 -- active-session-card.tsx` подтверждает, что `CafeOrderButton` не вводился в F2. Логика F2 не нарушена. QA оценивает именно коммит F2.

---

## 1. Результаты тестов

### Целевой тест-файл

```
npm test -- src/components/admin/ps-park/__tests__/active-session-card.test.tsx
Test Files  1 passed (1)
      Tests  4 passed (4)
```

4/4 — PASS.

### Полный suite

```
Test Files  132 passed (132)
      Tests  2115 passed (2115)
```

Регрессий нет — PASS.

### TypeScript

```
npx tsc --noEmit
(нет вывода — clean)
```

PASS.

---

## 2. Проверка Acceptance Criteria

| # | AC | Артефакт | Статус |
|---|-----|----------|--------|
| US-1 AC1 | Красная рамка `border-red-500`, фон `bg-red-50/50` при `now >= endTime` | `STATE_STYLES.expired.container = "border-red-500 bg-red-50/50"` | PASS |
| US-1 AC2 | Бейдж `bg-red-100 text-red-700`, текст «Просрочено: +X мин» | `STATE_STYLES.expired.badge = "bg-red-100 text-red-700"`, `formatOverrun(overrunMinutes)` | PASS |
| US-1 AC3 | Прогресс-бар `bg-red-400`, заполнен 100% | `STATE_STYLES.expired.progress = "bg-red-400"`, `Math.min(100, ...)` | PASS |
| US-1 AC4 | Счётчик обновляется на каждом тике (30 сек) | `overrunMinutes` пересчитывается в `setInterval(updateProgress, 30_000)` | PASS |
| US-1 AC5 | Зелёное состояние при `> 10 мин` | `STATE_STYLES.ok.container = "border-emerald-300 bg-emerald-50/30"` | PASS |
| US-1 AC6 | Жёлтое состояние при `0 < remaining <= 10 мин` | `STATE_STYLES.ending.container = "border-amber-400 bg-amber-50/50"` | PASS |
| US-1 AC7 | Граничный `now === endTime` → красный через `>=` в мс | `const expired = now >= end` (строка 64), не через `remainingMinutes` | PASS |
| US-1 AC8 | `isExpired` имеет приоритет над `isEnding` | `isEnding = !isExpired && remainingMinutes <= 10 && remainingMinutes > 0` (строка 75) | PASS |
| US-2 AC1 | «Просрочено: +X мин» при X < 60 | Тесты: `formatOverrun(5) === "Просрочено: +5 мин"` | PASS |
| US-2 AC2 | «Просрочено: +Y ч Z мин» / «+Y ч» при X >= 60 | Тесты: `formatOverrun(60) === "Просрочено: +1 ч"`, `formatOverrun(83) === "Просрочено: +1 ч 23 мин"` | PASS |
| US-2 AC3 | Точка `animate-pulse` → `bg-red-500` при expired | `STATE_STYLES.expired.dot = "bg-red-500"`, используется в JSX `${s.dot}` | PASS |
| Удалён «Время вышло» | Старый текст удалён, заменён `formatOverrun` | Подтверждено в `git show f90d465` — ветка `remainingMinutes > 0 ? ... : "Время вышло"` удалена | PASS |

**Все 12 AC — PASS.**

### Замечание по `bg-red-50` vs `bg-red-50/50`

PRD AC1 указывает `bg-red-50`, ADR §3 указывает `bg-red-50/50`. Реализация следует ADR (источник правды для точных классов). Это несущественное расхождение в документации, не регрессия. Блокером не является.

---

## 3. Edge Cases

| Кейс | Ожидание | Результат |
|------|----------|-----------|
| `now === endTime` | isExpired = true → красный | `now >= end` — покрыт корректно |
| Overrun < 60 мин | «Просрочено: +X мин» | formatOverrun(0..59) — тест pass |
| Overrun ровно 60 мин | «Просрочено: +1 ч» (без «0 мин») | `m === 0` проверяется явно — PASS |
| Overrun > 60 мин с остатком | «Просрочено: +Y ч Z мин» | formatOverrun(83, 125, 605) — тест pass |
| Многочасовая просрочка | Без верхней границы | formatOverrun(605) = «Просрочено: +10 ч 5 мин» — PASS |
| Отрицательный remaining | Защищён `Math.max(0, ...)` | Pre-existing логика, не регрессия F2 |

---

## 4. Security-кейсы

F2 затрагивает только клиентский компонент без новых API-эндпоинтов.

| Проверка | Статус |
|----------|--------|
| RBAC: страница `/admin/ps-park/sessions` защищена | PASS — существующий guard `MANAGER + hasModuleAccess('ps-park')` не тронут |
| Новых эндпоинтов нет | PASS — `git show f90d465 --stat` подтверждает: изменены только `.tsx` файлы, нет API routes |
| Нет `dangerouslySetInnerHTML`, raw SQL, user input в HTML | PASS — все значения типизированы через `ActiveSession` |
| Нет новых зависимостей в `package.json` | PASS — F2-коммит не трогает `package.json` |
| Нет секретов, токенов, ИНН в коде | PASS — grep чистый |

---

## 5. Anti-scope проверка F2

**Per-commit анализ** (`git show f90d465`):

Коммит F2 затронул ровно 3 файла:
- `docs/context/2026-05-04-ps-park-expired-session-red-card-context.md` (документация)
- `src/components/admin/ps-park/__tests__/active-session-card.test.tsx` (новый, тесты)
- `src/components/admin/ps-park/active-session-card.tsx` (изменён, только F2-логика)

`CafeOrderButton` добавлен в `active-session-card.tsx` следующим коммитом `1ea64d0 feat(cafe): link Order to Booking` — это F5, отдельная фича. В F2-коммите этого нет.

**Вывод**: F2 не имеет scope creep на уровне коммита.

---

## 6. Качество кода

| Проверка | Статус |
|----------|--------|
| Нет `any`, `@ts-ignore`, `console.log` | PASS — grep не нашёл |
| `formatOverrun` экспортирован как `export function` (named) | PASS — строка 19 |
| Conventional commit `feat(ps-park):` | PASS — `feat(ps-park): red expired-session card state with overrun timer` |
| TypeScript strict — нет `any`, типы выведены | PASS — `STATE_STYLES as const`, типизированный `state` |
| Нет новых зависимостей | PASS |

---

## 7. Нерешённые вопросы (не блокеры)

1. DOM-тесты трёх состояний (зелёный/жёлтый/красный/boundary) отложены согласно ADR §A5 — jsdom-инфра отсутствует. Покрыты только тесты `formatOverrun`. Это принятое решение PO, оформленное в ADR. Отдельный follow-up PR после добавления `@testing-library/react`.

2. `bg-red-50` (PRD) vs `bg-red-50/50` (ADR и реализация) — расхождение в документации. Не влияет на функциональность. Требует подтверждения PO при следующей итерации.

---

## Итог

| Категория | Результат |
|-----------|-----------|
| Тесты целевые (4/4) | PASS |
| Полный suite (2115/2115) | PASS |
| TypeScript | PASS |
| AC (12/12) | PASS |
| Edge cases | PASS |
| Security | PASS |
| Anti-scope F2 (per-commit) | PASS |
| Качество кода | PASS |

## Вердикт: PASS

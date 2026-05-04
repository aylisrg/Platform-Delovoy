# ADR: PS Park — красная карточка истёкшей активной сессии (F2)

**RUN_ID**: `2026-05-04-ps-park-expired-session-red-card`
**Дата**: 2026-05-04
**Статус**: Принято
**Связанный PRD**: `docs/requirements/2026-05-04-ps-park-expired-session-red-card-prd.md`
**Связанный тикет**: F1 (`2026-05-04-ps-park-payment-required-on-complete`)

---

## Контекст

PRD F2 требует добавить третье визуальное состояние карточки активной PS Park-сессии: красное при `now >= endTime`. Сейчас карточка имеет два состояния (зелёный / жёлтый) и переключается через `setInterval(updateProgress, 30_000)`. Полные требования и 6 PO-решений — в PRD и context-log. Изменение чисто фронтендовое, один файл.

**Backend, схема Prisma, API, RBAC, rate limiting — НЕ затрагиваются.** Этот ADR не описывает endpoint'ы, потому что компонент потребляет уже существующий `ActiveSession` тип через серверный `loader` страницы.

---

## Решение — ключевые точки

### 1. Где вычислять `isExpired`

**Решение**: внутри `useEffect → updateProgress()`, сохранять в новый `useState<boolean>(false)` и параллельно сохранять `overrunMinutes` в свой `useState<number>(0)`. **НЕ inline в JSX.**

**Decision matrix:**

| Подход | Плюсы | Минусы | Вердикт |
|--------|-------|--------|---------|
| **A. State (`useState`) + расчёт в `updateProgress`** | Перерасчёт только на тике (раз в 30 с) — синхронно с `remainingMinutes`/`progressPercent`. Тестируется через `vi.setSystemTime` + ре-рендер. Состояние карточки атомарно (3 setState на один тик). | Два дополнительных setState. | ✅ Выбрано |
| B. Inline `Date.now() >= new Date(session.endTime).getTime()` в JSX | Меньше state. | Считается на каждый ре-рендер, рассинхронизируется с `remainingMinutes` (который из state). При тестах `vi.setSystemTime` нужно форсить ре-рендер вручную. Сложнее объяснить «почему две карточки в одно мгновение разные». | Отклонено |

Решение согласуется с PO-Решением 1: расчёт через миллисекунды (`Date.now() >= endTime`), а не через округлённый `remainingMinutes === 0`.

### 2. Структура условий для трёх состояний

Без `cn`/`clsx` в проекте — сохраняем стиль шаблонных литералов, но заменяем тернарное выражение на **локальный объект-словарь стилей**, чтобы избежать вложенных тернарных:

```tsx
const state: "expired" | "ending" | "ok" =
  isExpired ? "expired" : isEnding ? "ending" : "ok";

const styles = {
  expired: {
    container: "border-red-500 bg-red-50/50",
    badge: "bg-red-100 text-red-700",
    progress: "bg-red-400",
    dot: "bg-red-500",
  },
  ending: {
    container: "border-amber-400 bg-amber-50/50",
    badge: "bg-amber-100 text-amber-700",
    progress: "bg-amber-400",
    dot: "bg-emerald-500",
  },
  ok: {
    container: "border-emerald-300 bg-emerald-50/30",
    badge: "bg-emerald-100 text-emerald-700",
    progress: "bg-emerald-400",
    dot: "bg-emerald-500",
  },
} as const;
const s = styles[state];
```

Приоритет `isExpired > isEnding` зашит в одну строку через единственный `?:`. Три состояния — взаимоисключающие. JSX использует `s.container` / `s.badge` / `s.progress` / `s.dot` без вложенных тернарных.

### 3. Точные классы Tailwind (из PRD)

| Элемент | OK (зелёный) | Ending (жёлтый) | Expired (красный) |
|---------|--------------|-----------------|-------------------|
| Контейнер `<div>` | `border-emerald-300 bg-emerald-50/30` | `border-amber-400 bg-amber-50/50` | `border-red-500 bg-red-50/50` |
| Бейдж таймера | `bg-emerald-100 text-emerald-700` | `bg-amber-100 text-amber-700` | `bg-red-100 text-red-700` |
| Прогресс-бар | `bg-emerald-400` | `bg-amber-400` | `bg-red-400` |
| Точка `animate-pulse` | `bg-emerald-500` | `bg-emerald-500` | `bg-red-500` |

Прогресс-бар при expired — **`width: 100%`** (overflow времени не «переливается» через 100%).

### 4. Overrun: расчёт и форматирование

Расчёт в том же `updateProgress`:

```ts
const overrun = isExpired ? Math.round((now - end) / 60_000) : 0;
setOverrunMinutes(overrun);
```

Форматирование — **новая локальная helper-функция** `formatOverrun(min: number): string` в этом же файле (не в `@/lib/format`, чтобы не загрязнять глобальный модуль один-единственным форматом, специфичным для PS Park):

```ts
function formatOverrun(min: number): string {
  if (min < 60) return `Просрочено: +${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0
    ? `Просрочено: +${h} ч`
    : `Просрочено: +${h} ч ${m} мин`;
}
```

**НЕ переиспользовать** существующий inline-блок в строках 81–85: тот форматирует `durationMin` без префикса «Просрочено: +», без пробелов «Y ч Z мин», и в формате `Yч Zмин` (без пробела). Семантика и формат разные — слепое переиспользование сломает читаемость. Если позже PO попросит унифицировать — отдельный refactor-тикет.

### 5. Бейдж — текст по состояниям

```tsx
<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.badge}`}>
  {isExpired ? formatOverrun(overrunMinutes) : `${remainingMinutes} мин`}
</span>
```

Старая ветка `remainingMinutes > 0 ? \`${remainingMinutes} мин\` : "Время вышло"` **удаляется** — она перекрывалась новым `isExpired` (в момент `remainingMinutes === 0` теперь работает overrun). Текст «Время вышло» больше не показывается никогда — его заменил «Просрочено: +X мин».

### 6. Точка-индикатор в шапке

```tsx
<span className={`inline-block h-2 w-2 rounded-full animate-pulse ${s.dot}`} />
```

`animate-pulse` сохраняется во всех трёх состояниях (PO-Решение 3). Цвет меняется только при `expired`.

---

## Тесты

**Файл**: `src/components/admin/ps-park/__tests__/active-session-card.test.tsx` (новый).

**Фреймворк**: Vitest + Testing Library. Время мокируется `vi.useFakeTimers()` + `vi.setSystemTime()`.

**КРИТИЧЕСКОЕ ПРЕПЯТСТВИЕ** — на момент написания ADR:

- `vitest.config.ts` использует `environment: "node"` (нет DOM).
- В `package.json` нет `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`/`happy-dom`.
- В `src/components/**/__tests__/` существующих тестов компонентов **нет** (текущее покрытие — только `src/modules/`, `src/lib/`, `src/app/api/`).

**Это первый компонентный тест в репозитории.** Чтобы его написать, требуется:
1. Добавить devDeps: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` (или `happy-dom`).
2. Либо переключить весь `vitest.config.ts` на `environment: "jsdom"`, либо добавить per-file directive `// @vitest-environment jsdom` в новом тест-файле.
3. Расширить `coverage.include` на `src/components/**/*.tsx`.

**Решение архитектора**: эти инфраструктурные изменения **выходят за scope F2** (PRD явно ограничивает один файл компонента). Developer должен:
- Реализовать компонент (продакшн-код) в этом тикете.
- Тест-файл написать с `// @vitest-environment jsdom` и закоммитить, **но** добавление devDeps оформить отдельным мини-PR с подтверждением PO («первая инфра компонентных тестов»). Если PO откажет — оставить только smoke unit-тесты на чистые helper-функции (`formatOverrun`), вынеся helper в экспортируемый именованный export.

**Минимальный fallback-набор без RTL** (если PO не даст добро на jsdom-инфру):
- Экспортировать `formatOverrun` из компонента (named export).
- Тест в `__tests__/active-session-card.test.tsx` покрывает только `formatOverrun(5) === "Просрочено: +5 мин"`, `formatOverrun(60) === "Просрочено: +1 ч"`, `formatOverrun(83) === "Просрочено: +1 ч 23 мин"`.

**Полный набор (когда jsdom доступен)** — 5 тест-кейсов из PRD (US-1 AC1–8, US-2 AC1–3): green / yellow / red / boundary `now === endTime` / `isExpired` побеждает `isEnding` при граничном округлении.

---

## Что НЕ делаем (явно)

- Backend, route handlers, Prisma, миграции, RBAC, rate limit — не трогаем.
- State-machine `BookingStatus` (CONFIRMED→CHECKED_IN→COMPLETED) — без изменений.
- Кнопки `AddItemsButton`, `ExtendSessionButton`, `CompleteSessionButton` — не трогаем (PO-Решение 4: остаются активными).
- Частоту `setInterval` (30 с) — не меняем.
- Беседки (gazebos), кафе, парковка, аренда — вне scope.
- Звуковые/push-уведомления при просрочке — отдельная фича, не F2.
- Унификация `formatOverrun` с inline-форматтером длительности (строки 81–85) — отдельный refactor-тикет.
- Кэш Redis, инвалидация — нет (компонент клиентский, обновляется по своему таймеру).

---

## Влияние на существующие модули

Никакого. Изменяется ровно один файл: `src/components/admin/ps-park/active-session-card.tsx`. Контракт props (`ActiveSession`, `onUpdate`) не меняется — родительский `src/app/admin/ps-park/sessions/page.tsx` (или аналог) остаётся как есть.

---

## Чеклист для Developer

- [ ] Добавить два `useState`: `isExpired: boolean`, `overrunMinutes: number`.
- [ ] В `updateProgress()` вычислить `now >= end` в мс и `Math.round((now - end) / 60_000)` если истекло.
- [ ] Ввести объект `styles` с тремя ключами и derived `state`.
- [ ] Заменить `bg-emerald-500` точки на `s.dot`.
- [ ] Заменить тернарную классификацию контейнера / бейджа / прогресс-бара на `s.container`/`s.badge`/`s.progress`.
- [ ] Удалить ветку `"Время вышло"` в бейдже; вместо неё — `formatOverrun(overrunMinutes)` при `isExpired`.
- [ ] Экспортировать `formatOverrun` (named export) для тестируемости даже без jsdom.
- [ ] Создать `__tests__/active-session-card.test.tsx`. Если jsdom недоступен — покрыть только `formatOverrun`. Если доступен — все 5 кейсов из PRD.
- [ ] `npm test` проходит зелёным.
- [ ] Обновить context-log: пометить `Developer — implementation` как `[x]`.

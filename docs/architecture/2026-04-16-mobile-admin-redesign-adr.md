# ADR: Мобильная переработка админ-панели

**Дата**: 2026-04-16
**Статус**: Принято
**PRD**: `docs/requirements/2026-04-16-mobile-admin-redesign-prd.md`
**Автор**: Architect (pipeline `2026-04-16-mobile-admin-redesign`)

---

## Контекст

PO требует сделать `/admin/*` пригодным для работы с телефона, не ломая десктоп (`≥ lg`, 1024px). Критический путь — создание брони стола Плей Парка за ≤ 4 касания. Backend не меняется: используем существующие `/api/ps-park/admin-book`, `/api/ps-park/timeline`, `/api/ps-park/active-sessions`, `/api/admin/permissions/me`, `/api/admin/badge-counts`.

## Варианты

### Вариант A: Два параллельных набора компонентов (mobile + desktop)

Под каждый экран создаём отдельный `*-mobile.tsx` и `*-desktop.tsx`, страницы делают `<Desktop className="hidden lg:block" />` + `<Mobile className="lg:hidden" />`.

- **+** Полная изоляция: ноль риска регрессии на десктопе.
- **+** Каждый компонент заточен под одну форму-фактор — чище код.
- **−** Удвоение кода по бизнес-логике (timeline, списки броней).
- **−** Два источника правды, легко разойтись.

### Вариант B: Один компонент + Tailwind responsive-классы

Существующие компоненты правим: добавляем `lg:`-префиксы, заменяем `<table>` на структуру, которая рендерится табл на lg и карточками на mobile.

- **+** Минимум нового кода, SOLID-адаптация.
- **+** Легко поддерживать.
- **−** Сложные случаи (таймлайн PS Park, модалка → bottom sheet) через responsive-классы не выражаются.

### Вариант C: Гибрид (выбран)

- **Лёгкие экраны** (dashboard, layouts, headers, списки броней, карточки ресурсов) — рефактор через Tailwind responsive-классы (`Вариант B`).
- **Навигация** (Sidebar) — отдельный клиентский компонент `MobileNav` (drawer) + скрытие десктопного `Sidebar` на мобильном.
- **PS Park бронирование** (сложный UX) — отдельные mobile-компоненты: `MobileTimeline`, `MobileBookingSheet`. На десктопе продолжает работать существующий `TimelineGrid` + `QuickBookingPopover`.
- Переиспользуемый примитив `<BottomSheet />` в `src/components/ui/`.

**Обоснование**: простые элементы не заслуживают дублирования, но критический сценарий PS Park требует полной переработки UX — его проще сделать отдельным компонентом, чем пытаться втиснуть touch-friendly интерфейс в горизонтальный таймлайн.

## Решение

Принят **Вариант C (гибрид)**.

Граница Desktop/Mobile проходит по Tailwind breakpoint `lg` (1024px):

| Ширина | Поведение |
|--------|-----------|
| < `lg` (0–1023px) | Mobile/tablet: hamburger + drawer, карточки, bottom sheet, `MobileTimeline` |
| ≥ `lg` (≥ 1024px) | Desktop: статичный Sidebar, таблицы, popover, `TimelineGrid` |

Переключение через Tailwind: `hidden lg:block` / `lg:hidden`. Никаких JS media-query хаков, SSR-friendly.

## Последствия

### Изменяемые файлы

| Файл | Что меняется |
|------|--------------|
| `src/app/admin/layout.tsx` | Добавить `MobileTopBar` + `MobileNav`, обернуть `Sidebar` в `hidden lg:flex`, адаптировать flex-контейнер |
| `src/components/admin/header.tsx` | Скрывать "Администратор" и сокращать padding на мобильном (`px-4 lg:px-8`) |
| `src/app/admin/ps-park/layout.tsx` | `p-8` → `p-4 lg:p-8` |
| `src/app/admin/ps-park/page.tsx` | Использовать новый `BookingList` компонент (карточки на mobile, таблица на lg), обернуть `TimelineGrid` в `hidden lg:block`, добавить `<MobileTimeline lg:hidden />` |
| `src/components/admin/shared/module-tabs.tsx` | Добавить индикатор горизонтального скролла |
| `src/app/admin/dashboard/page.tsx` | `p-8` → `p-4 lg:p-8` |
| `src/components/admin/ps-park/active-sessions-panel.tsx` | Убедиться, что grid responsive |

### Новые файлы

| Файл | Назначение |
|------|------------|
| `src/components/ui/bottom-sheet.tsx` | Переиспользуемый bottom-sheet с overlay, свайпом вниз для закрытия, sticky CTA внизу |
| `src/components/admin/mobile-nav.tsx` | Hamburger + drawer. Использует `/api/admin/permissions/me` и `/api/admin/badge-counts`. Без drag-drop |
| `src/components/admin/mobile-top-bar.tsx` | Hamburger кнопка + title + notification bell. Видна только `< lg` |
| `src/components/admin/ps-park/mobile-timeline.tsx` | Вертикальный список ресурсов, тап по ресурсу → выбор слота на мобильной сетке времени → открыть `MobileBookingSheet` |
| `src/components/admin/ps-park/mobile-booking-sheet.tsx` | Bottom-sheet форма бронирования с чипами длительности, sticky "Забронировать" |
| `src/components/admin/ps-park/booking-list-mobile.tsx` | Карточка брони (вместо таблицы) с действиями, используется в pending + history |
| `src/hooks/use-media-query.ts` | SSR-safe хук (нужен лишь там, где поведение зависит от размера экрана в JS — напр. закрытие drawer при ресайзе) |
| `src/components/ui/__tests__/bottom-sheet.test.tsx` | Тесты bottom sheet |
| `src/components/admin/__tests__/mobile-nav.test.tsx` | Тесты навигации |
| `src/components/admin/ps-park/__tests__/mobile-booking-sheet.test.tsx` | Тесты формы бронирования |
| `src/components/admin/ps-park/__tests__/mobile-timeline.test.tsx` | Тесты таймлайна |

### Влияние на существующие модули

- **Backend** — не затрагивается. API не меняется.
- **Модули `src/modules/*`** — не затрагиваются. Service/validation не меняются.
- **Public сайт** (`src/app/(public)`, `src/app/webapp`) — не затрагивается.
- **Десктопные компоненты** (`TimelineGrid`, `QuickBookingPopover`, `BookingHistoryTable`) — не удаляются. Используются на `lg+`.

## Компонентная структура

```
src/
├── app/admin/
│   ├── layout.tsx              [EDIT] — добавить MobileTopBar + MobileNav, обернуть Sidebar lg:flex
│   ├── dashboard/page.tsx      [EDIT] — адаптивные отступы
│   └── ps-park/
│       ├── layout.tsx          [EDIT] — p-4 lg:p-8
│       └── page.tsx            [EDIT] — mobile/desktop split компоненты
│
├── components/
│   ├── ui/
│   │   └── bottom-sheet.tsx    [NEW]
│   │
│   └── admin/
│       ├── sidebar.tsx         [MINIMAL EDIT] — добавить <aside className="hidden lg:flex ..."> а внутри всё как было
│       ├── header.tsx          [EDIT] — адаптивность
│       ├── mobile-nav.tsx      [NEW]
│       ├── mobile-top-bar.tsx  [NEW]
│       └── ps-park/
│           ├── timeline-grid.tsx       [NO CHANGE — desktop only]
│           ├── quick-booking-popover.tsx [NO CHANGE]
│           ├── mobile-timeline.tsx     [NEW]
│           ├── mobile-booking-sheet.tsx [NEW]
│           └── booking-list-mobile.tsx [NEW]
│
└── hooks/
    └── use-media-query.ts      [NEW]
```

## Breakpoints

Используем Tailwind defaults без кастомизации `tailwind.config.ts`:

| Breakpoint | Ширина | Назначение в админке |
|-----------|--------|-----------------------|
| (default) | 0-639 | Phone (primary mobile) |
| `sm:` | ≥ 640 | Большие телефоны + small landscape |
| `md:` | ≥ 768 | Планшеты portrait — UI близок к мобильному |
| `lg:` | ≥ 1024 | **Desktop breakpoint. Sidebar появляется.** |
| `xl:` | ≥ 1280 | Wide desktop — доп. колонки в dashboard |

**Ключевое правило**: `lg:` — единственный брейкпойнт, где меняется **макет** (sidebar appear). Остальные — только плотность/типографика.

## Bottom Sheet API

```typescript
// src/components/ui/bottom-sheet.tsx
type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Sticky footer content (CTA) */
  footer?: React.ReactNode;
  /** Max height of content area, default '80vh' */
  maxHeight?: string;
};
```

- Overlay затемняет фон, закрытие: клик по overlay, Escape, свайп вниз.
- Контейнер: `fixed inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-2xl`, slide-in анимация через Tailwind `transition-transform`.
- Footer — `sticky bottom-0 border-t bg-white p-4` — CTA не перекрывается клавиатурой (используем `100dvh` там где надо).

## Mobile Booking Sheet — поток

```
Ресурс (плитка) → Слот времени (30-мин сетка) → Bottom Sheet:
  ┌─────────────────────────────┐
  │ Стол PS 3              [✕] │
  │ 16 апр · 15:00              │
  │                             │
  │ Длительность                │
  │ [30м] [1ч ✓] [1.5ч] [2ч]   │
  │                             │
  │ Конец: 16:00 · 600 ₽       │
  │                             │
  │ Имя клиента*                │
  │ [________________]          │
  │                             │
  │ Телефон (опционально)       │
  │ [________________]          │
  │                             │
  ├─────────────────────────────┤
  │ [   Забронировать   ] ← sticky
  └─────────────────────────────┘
```

3-4 касания: слот → чип длительности → имя → кнопка. Если длительность по умолчанию подходит, то 3.

## Mobile Timeline — структура

```
[Плей Парк — расписание]  [< 16 апр >]

┌────────────────────────────────┐
│ Стол PS 1    2 игрока · 500₽/ч │
│ ━━━━━ 14:00 ━━━━━━━━━━━━━━━    │
│                                │
│ [15:00] [15:30] [16:00 ✓ 3ч]  │ ← scrollable timeline row
│                                │
│  свободно · занято · свободно  │
└────────────────────────────────┘
(повторить для каждого стола)
```

На каждый ресурс — своя полоска времени с горизонтальным скроллом. Слоты 30 минут, высота 56px, ширина 72px — ≥ 44×44px touch target. Блоки броней с именем клиента — тап открывает `BookingDetailCard` (уже существует).

## RBAC и permissions

`MobileNav` использует те же API (`/api/admin/permissions/me` и `/api/admin/badge-counts`), что `Sidebar`. RBAC-проверки на уровне UI идентичны. Серверная авторизация уже реализована в middleware — не трогаем.

## SSR и гидратация

- Mobile/desktop split через CSS (Tailwind `hidden`/`lg:block`), **не** через JS media query → оба варианта рендерятся в SSR, правильный виден после CSS применения, нет гидратационных гличей.
- `use-media-query` используется только в клиентском коде для декоративных вещей (автозакрытие drawer при ресайзе). Не влияет на первый рендер.

## Стратегия миграции

1. Добавляем `BottomSheet` и `use-media-query` (инфраструктура).
2. Добавляем `MobileNav` + `MobileTopBar`, подключаем к `layout.tsx`, оборачиваем `Sidebar` в `hidden lg:flex`.
3. Адаптируем отступы (`p-8 → p-4 lg:p-8`) в `AdminHeader` и layouts.
4. Создаём `BookingListMobile`, подменяем `<table>` на него в `ps-park/page.tsx` через responsive split.
5. Создаём `MobileTimeline` + `MobileBookingSheet`. На странице PS Park:
   ```tsx
   <div className="hidden lg:block"><TimelineGrid .../></div>
   <div className="lg:hidden"><MobileTimeline .../></div>
   ```
6. Тесты для каждого нового компонента — коммитим вместе с кодом.
7. Финальная проверка: на ширине 1440 ничего не изменилось (скриншот-сверка не автоматизирована, но ревьюер может убедиться визуально).

## Тест-план высокого уровня

### Vitest unit
- `bottom-sheet.test.tsx` — открытие/закрытие, escape, overlay click, sticky footer
- `use-media-query.test.ts` — SSR-safe поведение (не падает при отсутствии window)
- `mobile-nav.test.tsx` — разрешения фильтруют пункты, открытие/закрытие, badge-счётчики рендерятся
- `mobile-booking-sheet.test.tsx` — валидация (имя обязательно, время start < end), чипы длительности пересчитывают end, POST на `/api/ps-park/admin-book`, обработка ошибок
- `mobile-timeline.test.tsx` — рендер ресурсов, isSlotFree/getMaxEndTime, клик по свободному слоту открывает sheet
- `booking-list-mobile.test.tsx` — рендер карточек, статус-бейджи, клик по действиям

### Визуальная проверка (manual)
- iPhone SE (375×667), Pixel 5 (393×851), iPad portrait (768×1024), Desktop (1440×900).
- Критический flow: создание брони за ≤ 4 касания на iPhone SE.

### Regression guard для десктопа
- Снапшот-тестов не вводим (избыточно).
- Для `TimelineGrid` и `QuickBookingPopover` существующих тестов не трогаем.
- Добавим тест, что `Sidebar` имеет `hidden lg:flex` (защита от случайного удаления).

## Чеклист Architect

- [x] ADR записан и зафиксирован
- [x] Новые компоненты и их интерфейсы описаны
- [x] Новые API endpoints НЕ требуются (используем существующие)
- [x] Влияние на существующие модули оценено (ноль regression risks для backend)
- [x] Breakpoints определены (единый `lg` как макетный рубеж)
- [x] Стратегия миграции пошаговая
- [x] Тест-план высокого уровня

## Открытые вопросы — закрыты

- **Где хранить состояние drawer?** — локальный `useState` в клиентском `MobileNav`. Родитель (admin layout) не должен знать об этом.
- **Один компонент с responsive или два?** — гибрид: навигация и timeline разные, списки общие с responsive split.
- **Bottom-nav (4 ярлыка снизу)?** — откладываем. PO пометил как "nice to have, не Must". Не включаем в эту итерацию.

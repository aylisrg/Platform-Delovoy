# ADR: Подготовка к production-релизу -- Mobile-first, производительность, баги

**Дата:** 2026-04-14

## Статус
Предложено

---

## Контекст

Платформа функционально готова (Phase 0-4 завершены). Перед production-релизом обнаружены три категории проблем:

1. **Mobile UX** -- 70-80% клиентов приходят с телефонов, но страницы не оптимизированы: таблицы обрезаются, корзина скрыта за контентом, touch targets мелкие.
2. **Производительность** -- все публичные страницы используют `export const dynamic = "force-dynamic"`, видео загружается без оптимизации, нет viewport export в root layout.
3. **Баги UI** -- нечитаемый заголовок, плейсхолдерные контакты, отсутствие единой навигации на 4 из 6 публичных страниц.

### Текущее состояние кода (верифицировано)

| Проблема | Файл | Строка | Суть |
|----------|------|--------|------|
| BUG-1: Нечитаемый заголовок | `src/app/(public)/gazebos/page.tsx` | L61 | `text-[#1d1d1f]` (тёмный текст) на overlay `from-black/70` (тёмный фон) |
| BUG-2: Таблицы без overflow | `src/app/(public)/dashboard/page.tsx` | L107, L162 | `<table className="w-full">` без wrapper с `overflow-x-auto` |
| BUG-3: Корзина скрыта | `src/components/public/cafe/menu-list.tsx` | L96 | `grid-cols-1 lg:grid-cols-3` -- корзина в третьей колонке, на mobile внизу за пределами экрана |
| BUG-4: Плейсхолдерные контакты | `landing-delovoy-park.ru/components/contacts-section.tsx` | L4-5 | `+7 (XXX) XXX-XX-XX`, `tel:+7XXXXXXXXXX`, `wa.me/7XXXXXXXXXX` |
| BUG-5: JSON-LD плейсхолдер | `src/app/page.tsx` | L36 | `telephone: "+7-000-000-00-00"` |
| BUG-6: Нет viewport export | `src/app/layout.tsx` | (отсутствует) | Next.js 15 требует `export const viewport: Viewport` отдельно от metadata |
| BUG-7: Нет Navbar/Footer cafe | `src/app/(public)/cafe/page.tsx` | L30-48 | Собственный header вместо `<Navbar />` + `<Footer />` |
| BUG-8: Нет Navbar/Footer parking | `src/app/(public)/parking/page.tsx` | L25-108 | Собственный header, нет Footer |
| BUG-9: Нет Navbar/Footer rental | `src/app/(public)/rental/page.tsx` | L46-147 | Собственный header, нет Footer |
| BUG-10: Нет Navbar/Footer ps-park | `src/app/(public)/ps-park/page.tsx` | L129-345 | Собственный nav + footer (не общий компонент) |

**force-dynamic на публичных страницах** (5 страниц):
- `src/app/(public)/gazebos/page.tsx:10`
- `src/app/(public)/ps-park/page.tsx:9`
- `src/app/(public)/cafe/page.tsx:6`
- `src/app/(public)/rental/page.tsx:9`
- `src/app/(public)/dashboard/page.tsx:10`

**force-dynamic на API routes** (5 routes) -- admin API, оставляем как есть.

---

## Варианты

### Вариант A: Полный редизайн всех страниц (отклонён)
Перерисовать все страницы mobile-first с нуля.

Минусы: слишком долго, рискованно перед релизом, текущий дизайн landing-уровня качественный (Apple-like стиль).

### Вариант B: Точечные исправления по User Stories (выбрано)
Фиксить конкретные баги, добавлять мобильные адаптации к существующим компонентам, менять стратегию кэширования постранично.

Плюсы:
- Минимальный риск регрессий
- Каждая User Story -- изолированный коммит
- Можно деплоить инкрементально

### Вариант C: Next.js middleware для мобильной версии (отклонён)
Отдельный `_mobile` вариант для каждой страницы, middleware определяет User-Agent.

Минусы: удвоение кода, сложность поддержки, Tailwind уже решает responsive через breakpoints.

---

## Решение

Реализовать **Вариант B** -- точечные исправления, разбитые на 12 User Stories с чёткими зависимостями.

### Порядок реализации (dependency graph)

```
US-1 (viewport) ──┐
                   ├──> US-4 (hero text) ──> US-7 (LCP/CLS)
US-6 (контакты) ──┘
                        │
US-5 (navbar) ─────────>│
                        │
US-2 (таблицы ЛК) ─────> US-10 (touch targets)
US-3 (корзина кафе) ────> US-10
                        │
US-8 (ISR кэш) ────────> US-9 (видео) ──> US-7
                        │
US-11 (auth modal) ─────> US-10
US-12 (sticky booking) ─> US-10
```

**Три волны:**
1. **Wave 1 (Must Have, нет зависимостей):** US-1, US-6, US-4, US-2, US-3
2. **Wave 2 (Should Have, зависят от Wave 1):** US-5, US-8, US-9, US-10, US-11
3. **Wave 3 (Could Have):** US-12, US-7 (финальная верификация метрик)

---

## Детальный план по User Stories

### US-1: Viewport и базовая мобильная совместимость

**Проблема:** В `src/app/layout.tsx` нет `export const viewport`. В Next.js 15 viewport-мета тег вынесен из `metadata` в отдельный экспорт `Viewport`. Без этого мобильные браузеры могут некорректно масштабировать страницу.

**Файлы для изменения:**
- `src/app/layout.tsx`

**Техническое решение:**

Добавить в `src/app/layout.tsx` (перед `export const metadata`):

```typescript
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};
```

**Почему `maximumScale: 5`:** Не блокируем zoom (accessibility), но предотвращаем случайный масштаб выше 5x. Значение `maximumScale: 1` использовать нельзя -- нарушает WCAG 2.1 SC 1.4.4.

**Зависимости:** Нет. Можно делать первым.

---

### US-2: Мобильная адаптация таблиц в Личном кабинете

**Проблема:** Таблицы бронирований (L107-149) и заказов (L162-199) в `src/app/(public)/dashboard/page.tsx` содержат по 5 колонок. На экранах < 640px таблица обрезается, горизонтальный скролл отсутствует.

**Файлы для изменения:**
- `src/app/(public)/dashboard/page.tsx`

**Техническое решение:**

Два подхода, оба надо применить:

**A. Обёртка `overflow-x-auto` для таблиц (quick fix для medium screens):**

Обернуть каждый `<table>` в:
```tsx
<div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
  <table className="w-full text-sm min-w-[600px]">
    ...
  </table>
</div>
```

`min-w-[600px]` гарантирует, что таблица не сжимается и на средних экранах можно проскроллить.

**B. Card-layout на mobile (< 640px) -- основное решение:**

Заменить `<table>` на responsive-компонент, который рендерит:
- `sm:` и выше -- таблицу (как сейчас)
- `< sm` -- стек карточек

Шаблон карточки бронирования:
```tsx
{/* Mobile card */}
<div className="sm:hidden space-y-3">
  {bookings.map((b) => (
    <div key={b.id} className="rounded-xl border border-zinc-100 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900">
          {moduleLabels[b.moduleSlug] ?? b.moduleSlug}
        </span>
        <Badge variant={bookingStatusVariant[b.status]}>
          {bookingStatusLabel[b.status]}
        </Badge>
      </div>
      <p className="text-sm text-zinc-600">
        {resourceNameMap.get(b.resourceId) ?? "—"}
      </p>
      <p className="text-xs text-zinc-500">
        {new Date(b.date).toLocaleDateString("ru-RU")} ·{" "}
        {new Date(b.startTime).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
        {" — "}
        {new Date(b.endTime).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  ))}
</div>
{/* Desktop table */}
<div className="hidden sm:block">
  <table>...</table>
</div>
```

Аналогичный card-layout для заказов.

**Зависимости:** Нет.

---

### US-3: Мобильная корзина кафе

**Проблема:** В `src/components/public/cafe/menu-list.tsx` (L96) используется `grid-cols-1 lg:grid-cols-3`. На mobile корзина (`<div>` в L153) рендерится под всем списком меню, пользователь может не заметить что добавил товар.

**Файлы для изменения:**
- `src/components/public/cafe/menu-list.tsx`

**Техническое решение:**

**A. Sticky-плашка корзины (bottom bar) на mobile:**

Добавить мобильный mini-cart bar (показывается при `cart.length > 0`):

```tsx
{/* Mobile cart summary bar */}
{cart.length > 0 && (
  <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white border-t border-zinc-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 py-3">
    <div className="max-w-6xl mx-auto flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-zinc-900">{totalAmount} ₽</p>
        <p className="text-xs text-zinc-500">
          {cart.reduce((sum, c) => sum + c.quantity, 0)} позиций
        </p>
      </div>
      <Button onClick={() => scrollToCart()} size="sm">
        Перейти к заказу
      </Button>
    </div>
  </div>
)}
```

Также добавить `ref` на div корзины и `scrollToCart()`:
```typescript
const cartRef = useRef<HTMLDivElement>(null);
function scrollToCart() {
  cartRef.current?.scrollIntoView({ behavior: "smooth" });
}
```

**B. Добавить `pb-20 lg:pb-0` на `<main>` в cafe page:**

Чтобы sticky bar не перекрывал последние элементы меню. Файл: `src/app/(public)/cafe/page.tsx`, L45:

```tsx
<main className="max-w-6xl mx-auto px-4 py-8 pb-20 lg:pb-8">
```

**Зависимости:** Нет.

---

### US-4: Исправление заголовка Барбекю Парк

**Проблема:** В `src/app/(public)/gazebos/page.tsx` (L61) заголовок `<h1>` имеет `text-[#1d1d1f]` (почти чёрный), а overlay фона -- `from-black/70` (L50). Тёмный текст на тёмном фоне = нечитаем.

**Файлы для изменения:**
- `src/app/(public)/gazebos/page.tsx`

**Техническое решение:**

Изменить L61:
```diff
- className="font-[family-name:var(--font-manrope)] font-[500] text-[#1d1d1f] mt-6"
+ className="font-[family-name:var(--font-manrope)] font-[500] text-white mt-6"
```

Одно слово: `text-[#1d1d1f]` -> `text-white`.

**Зависимости:** Нет.

---

### US-5: Единообразная навигация на всех страницах

**Проблема:** Только 2 из 6 публичных страниц используют общие `<Navbar />` и `<Footer />`:
- Landing (`src/app/page.tsx`) -- да
- Gazebos (`src/app/(public)/gazebos/page.tsx`) -- да
- Cafe (`src/app/(public)/cafe/page.tsx`) -- нет (свой `<header>`)
- PS Park (`src/app/(public)/ps-park/page.tsx`) -- нет (свой nav + footer)
- Parking (`src/app/(public)/parking/page.tsx`) -- нет (свой `<header>`, нет Footer)
- Rental (`src/app/(public)/rental/page.tsx`) -- нет (свой `<header>`, нет Footer)
- Dashboard (`src/app/(public)/dashboard/page.tsx`) -- нет (свой `<header>`)

**Файлы для изменения:**
- `src/app/(public)/cafe/page.tsx`
- `src/app/(public)/parking/page.tsx`
- `src/app/(public)/rental/page.tsx`
- `src/app/(public)/dashboard/page.tsx`
- `src/app/(public)/ps-park/page.tsx` (частично)
- `landing-delovoy-park.ru/components/navbar.tsx` (расширение navLinks)

**Техническое решение:**

**A. Добавить `<Navbar />` и `<Footer />` на 4 страницы:**

Паттерн для cafe, parking, rental, dashboard:

```tsx
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

// Удалить собственный <header>
// Заменить на:
<div className="bg-white min-h-screen">
  <Navbar />
  <div className="pt-14"> {/* отступ под fixed navbar */}
    {/* existing content */}
  </div>
  <Footer />
</div>
```

**B. PS Park -- особый случай:**

PS Park использует тёмную тему (`bg-zinc-950 text-white`). Стандартный `<Navbar />` -- белый (`bg-white/80`). Варианты:
1. **Добавить prop `variant="dark"` к Navbar** -- Navbar рендерит тёмную версию (`bg-zinc-900/80 border-zinc-800`). Меньше кода, но усложняет Navbar.
2. **Оставить PS Park со своей навигацией** -- PS Park стилистически отличается (gaming-тема), отдельный nav оправдан.

**Рекомендация:** Вариант 2. PS Park -- единственная тёмная страница. Его nav уже содержит "Главная" ссылку. Добавить только общую кнопку "Войти" из Navbar для консистентности. Для Footer -- добавить ссылки из общего Footer в существующий `<footer>` PS Park.

**C. Расширить navLinks в Navbar:**

В `landing-delovoy-park.ru/components/navbar.tsx` (L7-14) добавить:

```typescript
const navLinks = [
  { label: "О парке", href: "#advantages" },
  { label: "Офисы", href: "/rental" },         // Было: "#offices"
  { label: "Барбекю Парк", href: "/gazebos" },
  { label: "Плей Парк", href: "/ps-park" },
  { label: "Кафе", href: "/cafe" },
  { label: "Контакты", href: "#contacts" },
];
```

Заменить `href: "#offices"` на `href: "/rental"` -- чтобы Navbar работал и со внутренних страниц. Но `#advantages` и `#contacts` -- anchor-ссылки, которые работают только на landing. На внутренних страницах они не будут работать.

**Решение для anchor-ссылок на внутренних страницах:**

Для навигации с внутренних страниц на секции лендинга:
```typescript
const navLinks = [
  { label: "О парке", href: "/#advantages" },    // абсолютный anchor
  { label: "Офисы", href: "/rental" },
  { label: "Барбекю Парк", href: "/gazebos" },
  { label: "Плей Парк", href: "/ps-park" },
  { label: "Кафе", href: "/cafe" },
  { label: "Контакты", href: "/#contacts" },      // абсолютный anchor
];
```

И заменить `<a>` на `<Link>` для внутренних маршрутов (без `#`):
```tsx
{navLinks.map((link) =>
  link.href.startsWith("#") || link.href.startsWith("/#") ? (
    <a key={link.href} href={link.href} className="...">
      {link.label}
    </a>
  ) : (
    <Link key={link.href} href={link.href} className="...">
      {link.label}
    </Link>
  )
)}
```

**Зависимости:** US-1 (viewport) должна быть выполнена первой, т.к. Navbar содержит fixed positioning.

---

### US-6: Реальные контактные данные

**Проблема:**
1. `landing-delovoy-park.ru/components/contacts-section.tsx` (L1-20): телефон `+7 (XXX) XXX-XX-XX`, WhatsApp `+7 (XXX) XXX-XX-XX`
2. `src/app/page.tsx` (L36): JSON-LD `telephone: "+7-000-000-00-00"`

**Файлы для изменения:**
- `landing-delovoy-park.ru/components/contacts-section.tsx`
- `src/app/page.tsx`

**Техническое решение:**

**A. Интеграция с telephony-сервисом:**

Проект уже имеет модуль `src/modules/telephony/service.ts` с функцией `getPublicPhone()`. Его уже используют gazebos (L28) и ps-park (L122).

Проблема: `contacts-section.tsx` -- это `"use client"` компонент. Вызов серверной функции `getPublicPhone()` невозможен напрямую.

Два варианта:
1. **Сделать contacts-section серверным**: удалить `"use client"` (если нет client-side логики) -- но он лежит в `landing-delovoy-park.ru/`, вне src. Проверка: файл не содержит `"use client"`, значит это серверный компонент. Можно вызывать `getPublicPhone()` напрямую.

Оказывается, `contacts-section.tsx` не содержит директиву `"use client"` -- это уже серверный компонент. Значит можно:

```tsx
import { getPublicPhone } from "@/modules/telephony/service";

export async function ContactsSection() {
  const phoneInfo = await getPublicPhone("general");

  const contacts = [
    {
      type: "Телефон",
      value: phoneInfo?.displayPhone ?? "+7 (XXX) XXX-XX-XX",
      href: phoneInfo ? `tel:${phoneInfo.phone}` : "#",
      icon: "phone",
    },
    // ...
  ];
```

**Если telephony-модуль ещё не содержит реальный номер** -- нужно добавить номер в seed/env. Добавить переменную окружения:
```env
DELOVOY_PHONE="+74951234567"
DELOVOY_PHONE_DISPLAY="+7 (495) 123-45-67"
```

И fallback в telephony-сервисе.

**B. JSON-LD:**

В `src/app/page.tsx` (L36) заменить плейсхолдер:

```typescript
const APP_PHONE = process.env.DELOVOY_PHONE || "+7-000-000-00-00";

const jsonLd = {
  // ...
  telephone: APP_PHONE,
  // ...
};
```

**Зависимости:** Нет. Может быть сделана параллельно с US-1.

---

### US-7: Производительность (LCP < 2.5s, CLS < 0.1)

**Проблема:** Метрики Web Vitals не измерены, но архитектурные проблемы очевидны:
- Все страницы -- `force-dynamic` (нет кэша, каждый запрос идёт в БД)
- Видео на gazebos загружается без poster, без preload
- Hero видео на landing -- `preload="metadata"` (хорошо), `hidden md:block` (хорошо)

**Это meta-story -- она закрывается через US-8 и US-9.**

**Файлы для изменения:**
- Верификация после реализации US-8, US-9
- Добавление `next/web-vitals` reporting (опционально)

**Техническое решение:**

1. После US-8 (ISR) -- замерить LCP через Lighthouse для каждой страницы
2. После US-9 (видео) -- замерить CLS для gazebos и landing
3. Если LCP > 2.5s -- добавить `priority` на LCP-изображения, `fetchpriority="high"` на hero
4. Если CLS > 0.1 -- добавить explicit `width`/`height` на изображения, `aspect-ratio` на видео

**CLS-источники в текущем коде:**
- Gazebos hero video (L40-48): нет `poster`, при загрузке видео layout может сдвигаться. Fix: добавить `poster="/media/gazebo-poster.jpg"` и CSS `aspect-ratio`.
- Landing hero (уже имеет `poster="/media/hero-poster.jpg"` -- хорошо).

**Зависимости:** US-8, US-9.

---

### US-8: Кэширование (ISR вместо force-dynamic)

**Проблема:** 5 публичных страниц используют `export const dynamic = "force-dynamic"`. Каждый запрос пользователя -- запрос в PostgreSQL. Для страниц с редко меняющимися данными (меню кафе, список офисов, парковка) это неоправданно.

**Файлы для изменения:**
- `src/app/(public)/gazebos/page.tsx`
- `src/app/(public)/ps-park/page.tsx`
- `src/app/(public)/cafe/page.tsx`
- `src/app/(public)/rental/page.tsx`
- `src/app/(public)/dashboard/page.tsx`
- `next.config.ts`

**Стратегия кэширования по страницам:**

| Страница | Текущее | Новое | Обоснование |
|----------|---------|-------|-------------|
| `/` (landing) | static (нет dynamic) | static | Контент не зависит от БД (кроме отзывов, которые грузятся client-side через fetch) |
| `/gazebos` | force-dynamic | **ISR, revalidate: 300** (5 мин) | Список беседок меняется редко. Доступность -- client-side через API |
| `/ps-park` | force-dynamic | **ISR, revalidate: 60** (1 мин) | Список столов стабилен, но availability grid обновляется через client-side fetch |
| `/cafe` | force-dynamic | **ISR, revalidate: 300** (5 мин) | Меню обновляется редко. При обновлении -- revalidate через API |
| `/rental` | force-dynamic | **ISR, revalidate: 600** (10 мин) | Каталог офисов меняется крайне редко |
| `/parking` | static | static | Уже статическая, данные из `getParkingInfo()` -- hardcoded |
| `/dashboard` | force-dynamic | **force-dynamic** (оставить) | Личные данные пользователя, кэширование невозможно |

**Техническое решение:**

**A. Замена `force-dynamic` на ISR:**

Для gazebos, ps-park, cafe, rental -- заменить:

```diff
- export const dynamic = "force-dynamic";
+ export const revalidate = 300; // ISR: обновлять каждые 5 минут
```

**B. On-demand revalidation при изменении данных:**

Добавить вызов `revalidatePath()` в API routes, которые мутируют данные:

```typescript
import { revalidatePath } from "next/cache";

// В POST/PATCH/DELETE handlers:
revalidatePath("/gazebos");
revalidatePath("/cafe");
revalidatePath("/rental");
```

Файлы, куда добавить revalidation:
- `src/app/api/gazebos/route.ts` -- POST (создание ресурса)
- `src/app/api/cafe/menu/route.ts` -- POST, PATCH, DELETE (меню)
- `src/app/api/rental/offices/route.ts` -- PATCH (статус офиса)

**C. next.config.ts -- добавить image optimization:**

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
  },
};
```

**Зависимости:** US-5 (navbar) должна быть выполнена до, т.к. navbar -- client component, и его взаимодействие с ISR нужно верифицировать (Navbar с `"use client"` будет корректно работать в ISR-страницах, т.к. Next.js рендерит его на клиенте).

---

### US-9: Оптимизация видео на мобильном

**Проблема:**
1. Gazebos hero (`src/app/(public)/gazebos/page.tsx`, L40-48): видео `gazebo.mp4` без `poster`, `preload` по умолчанию (auto), загружается на всех устройствах включая мобильные.
2. Landing hero (`landing-delovoy-park.ru/components/hero-section-with-video.tsx`, L27-38): уже оптимизирован (`hidden md:block`, `preload="metadata"`, `poster`). Хорошо.

**Файлы для изменения:**
- `src/app/(public)/gazebos/page.tsx`

**Техническое решение:**

**A. Gazebos -- добавить poster и mobile fallback:**

```tsx
{/* Video background -- desktop only */}
<video
  autoPlay
  muted
  loop
  playsInline
  preload="metadata"
  poster="/media/gazebo-poster.jpg"
  className="absolute inset-0 w-full h-full object-cover hidden md:block"
>
  <source src="/media/gazebo.mp4" type="video/mp4" />
</video>

{/* Mobile poster fallback */}
<div className="absolute inset-0 md:hidden">
  <img
    src="/media/gazebo-poster.jpg"
    alt=""
    className="w-full h-full object-cover"
    onError={(e) => { e.currentTarget.style.display = "none"; }}
  />
</div>
```

Паттерн повторяет landing hero (L42-51 `hero-section-with-video.tsx`).

**B. Создать poster-изображение:**

Нужен файл `/public/media/gazebo-poster.jpg` -- первый кадр из `gazebo.mp4`. Если его нет, использовать placeholder.

**Зависимости:** Нет. Но лучше делать после US-8 для верификации LCP.

---

### US-10: Touch targets >= 44x44px

**Проблема:** Некоторые интерактивные элементы имеют area < 44x44px (Apple HIG / WCAG recommendation):
- Navbar burger button (`landing-delovoy-park.ru/components/navbar.tsx`, L114-122): `p-2` на элемент с 18px контентом -- итого ~34px
- Category filter pills в cafe (`src/components/public/cafe/menu-list.tsx`, L102-108): `px-3 py-1.5` -- высота ~30px
- Cart +/- buttons (`src/components/public/cafe/menu-list.tsx`, L171-183): `w-7 h-7` = 28x28px
- Navbar desktop nav links: `gap-7` между мелкими текстовыми ссылками -- на mobile неактуально (скрыты за burger)

**Файлы для изменения:**
- `landing-delovoy-park.ru/components/navbar.tsx`
- `src/components/public/cafe/menu-list.tsx`
- `src/components/ui/auth-modal.tsx`

**Техническое решение:**

**A. Navbar burger:**
```diff
- className="md:hidden text-[#1d1d1f] p-2"
+ className="md:hidden text-[#1d1d1f] p-3 -mr-1"
```
`p-3` = 12px padding -> 18px icon + 24px padding = 42px. Или:
```diff
+ className="md:hidden text-[#1d1d1f] p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
```

**B. Cafe category pills:**
```diff
- className="px-3 py-1.5 rounded-full text-sm ..."
+ className="px-4 py-2.5 rounded-full text-sm ..."
```
`py-2.5` = 10px + ~20px line-height = 40px. Или добавить `min-h-[44px]`.

**C. Cart +/- buttons:**
```diff
- className="w-7 h-7 rounded bg-zinc-100 ..."
+ className="w-9 h-9 rounded bg-zinc-100 ..."
```
36px -- ближе к 44px. Или `w-11 h-11` = 44px.

**Зависимости:** US-2, US-3, US-11 (работать с теми же файлами).

---

### US-11: Мобильная оптимизация модального окна авторизации

**Проблема:** AuthModal (`src/components/ui/auth-modal.tsx`) и SignIn page (`src/app/auth/signin/page.tsx`) не имеют критических мобильных багов, но:
- AuthModal (L179): `max-w-md` -- может быть слишком широким на маленьких экранах (< 375px)
- Внутренние padding `px-8 pt-8 pb-8` (L191, L204) -- много для мобильных
- OTP input (L381): `tracking-[0.3em]` -- может не вместить 6 цифр на узких экранах

**Файлы для изменения:**
- `src/components/ui/auth-modal.tsx`

**Техническое решение:**

```diff
- <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden ...">
+ <div className="relative w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-white shadow-2xl overflow-hidden ...">
```

```diff
- <div className="px-8 pt-8 pb-2 text-center">
+ <div className="px-5 sm:px-8 pt-6 sm:pt-8 pb-2 text-center">
```

```diff
- <div className="px-8 pb-8 pt-4">
+ <div className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">
```

**Зависимости:** US-1 (viewport).

---

### US-12: Sticky-панель бронирования Плей Парк (Could Have)

**Проблема:** На PS Park при выборе слотов в `DarkAvailabilityGrid` пользователь должен скроллить вниз к кнопке подтверждения. На mobile это неудобно.

**Файлы для изменения:**
- `src/components/public/ps-park/dark-availability-grid.tsx`

**Техническое решение:**

Добавить sticky bottom bar, аналогичный US-3 (корзина кафе):

```tsx
{selectedSlots.length > 0 && (
  <div className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800 px-4 py-3 safe-area-pb">
    <div className="flex items-center justify-between max-w-6xl mx-auto">
      <div>
        <p className="text-sm font-semibold text-white">
          {selectedSlots.length} слот(ов) выбрано
        </p>
        <p className="text-xs text-zinc-400">
          {/* resource name + total price */}
        </p>
      </div>
      <button
        onClick={handleBook}
        disabled={bookingLoading}
        className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-6 py-2.5 rounded-full"
      >
        Забронировать
      </button>
    </div>
  </div>
)}
```

`safe-area-pb` -- Tailwind класс для `padding-bottom: env(safe-area-inset-bottom)` на iPhone с notch/home indicator. Добавить в `globals.css`:

```css
.safe-area-pb {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

**Зависимости:** US-10 (touch targets).

---

## Кэширование: сводная таблица

| Страница | Тип | revalidate | On-demand revalidation trigger |
|----------|-----|-----------|-------------------------------|
| `/` | Static | -- | -- |
| `/gazebos` | ISR | 300s | API: POST/PATCH /api/gazebos |
| `/ps-park` | ISR | 60s | API: POST/PATCH /api/ps-park |
| `/cafe` | ISR | 300s | API: POST/PATCH/DELETE /api/cafe/menu |
| `/rental` | ISR | 600s | API: PATCH /api/rental/offices |
| `/parking` | Static | -- | -- |
| `/dashboard` | Dynamic | -- | -- (персональные данные) |
| Admin pages | Dynamic | -- | -- (всегда актуальные данные) |
| API routes | Dynamic | -- | -- |

---

## Миграция force-dynamic -> ISR: план действий

### Шаг 1: Аудит data-fetching

Для каждой страницы определить:
- Какие данные загружаются server-side (через `await`)
- Какие данные загружаются client-side (через `fetch` в `useEffect`)
- Содержит ли страница user-specific данные

Результат аудита:

| Страница | Server-side data | Client-side data | User-specific |
|----------|-----------------|------------------|---------------|
| `/gazebos` | `listResources()`, `getPublicPhone()` | Booking flow (auth-gated) | Нет |
| `/ps-park` | `listTables()`, `getAvailability()`, `getPublicPhone()` | Slot selection, booking | Нет |
| `/cafe` | `getMenu()`, `getMenuCategories()` | Cart, order submit | Нет |
| `/rental` | `listOffices()` | InquiryForm submit | Нет |
| `/dashboard` | `prisma.booking.findMany({userId})`, `prisma.order.findMany({userId})` | NotificationSettings | **Да** |

**Вывод:** `/dashboard` остаётся force-dynamic. Остальные 4 страницы безопасно переводятся на ISR, т.к. серверные данные -- общие (не per-user), а пользовательские действия происходят через client-side fetch.

### Шаг 2: Замена директив (одна строка на файл)

```diff
# gazebos/page.tsx
- export const dynamic = "force-dynamic";
+ export const revalidate = 300;

# ps-park/page.tsx
- export const dynamic = "force-dynamic";
+ export const revalidate = 60;

# cafe/page.tsx
- export const dynamic = "force-dynamic";
+ export const revalidate = 300;

# rental/page.tsx
- export const dynamic = "force-dynamic";
+ export const revalidate = 600;
```

### Шаг 3: On-demand revalidation в mutation handlers

Добавить `revalidatePath()` в существующие API handlers, которые мутируют данные, отображаемые на ISR-страницах. Пример:

```typescript
// src/app/api/gazebos/route.ts (POST handler)
import { revalidatePath } from "next/cache";

// после успешного создания/обновления ресурса:
revalidatePath("/gazebos");
```

### Шаг 4: Верификация

1. `npm run build` -- убедиться, что страницы корректно определяются как ISR (в build output: `ISR: 300 seconds`)
2. Вручную проверить: изменить данные через API -> убедиться, что страница обновилась

---

## Влияние на next.config.ts

Текущий `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
};
```

Добавить:

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
  },
};
```

`images.formats` -- включить AVIF (лучше compression ratio) с fallback на WebP. Это применяется к изображениям через `next/image`. В текущем коде `next/image` не используется (все `<img>` -- нативные), но это подготовка для будущего использования.

---

## Тестирование

### Unit-тесты

Для US-2 (card layout) -- тест не требуется (pure UI, Tailwind CSS classes).

Для US-8 (ISR) -- integration test:
```typescript
// __tests__/pages/gazebos.test.tsx
describe("Gazebos page", () => {
  it("exports revalidate = 300", async () => {
    const mod = await import("@/app/(public)/gazebos/page");
    expect(mod.revalidate).toBe(300);
  });
});
```

Для US-6 (контакты) -- если используется telephony service:
```typescript
describe("ContactsSection", () => {
  it("renders real phone from telephony service", async () => {
    // mock getPublicPhone
  });
});
```

### Manual QA checklist

- [ ] US-1: Открыть на iOS Safari -- нет горизонтального скролла, zoom работает
- [ ] US-2: Dashboard на 375px -- карточки вместо таблиц
- [ ] US-3: Cafe на mobile -- sticky bar корзины виден при добавлении товара
- [ ] US-4: Gazebos hero -- "Барбекю Парк" читается (белый на тёмном)
- [ ] US-5: Cafe, Parking, Rental -- есть Navbar и Footer
- [ ] US-6: Contacts -- реальный телефон, WhatsApp ссылка работает
- [ ] US-7: Lighthouse LCP < 2.5s, CLS < 0.1 на landing, gazebos, ps-park
- [ ] US-8: Cafe page загружается быстро (ISR hit)
- [ ] US-9: Gazebos на mobile -- poster вместо видео
- [ ] US-10: Все кнопки на mobile -- удобно нажимать пальцем
- [ ] US-11: AuthModal на 375px -- не обрезается
- [ ] US-12: PS Park booking -- sticky bar при выборе слотов

---

## Риски

| Риск | Вероятность | Импакт | Митигация |
|------|-------------|--------|-----------|
| ISR stale data (пользователь видит устаревшее меню) | Средняя | Низкий | revalidatePath() + короткий TTL (60-300s) |
| Navbar конфликт с тёмными страницами | Низкая | Средний | PS Park сохраняет свою навигацию |
| Telephony service не содержит реальный номер | Средняя | Высокий | Fallback на env variable + warning в CI |
| Poster-изображения отсутствуют | Средняя | Низкий | Graceful degradation: видео показывается всем |
| Auth modal scroll lock на iOS Safari | Низкая | Средний | `overflow: hidden` уже реализован (L38-46 auth-modal.tsx) |

---

## Оценка трудоёмкости

| US | Story Points | Часы (примерно) |
|----|-------------|-----------------|
| US-1 | 1 | 0.5 |
| US-2 | 3 | 2 |
| US-3 | 3 | 2 |
| US-4 | 1 | 0.25 |
| US-5 | 5 | 4 |
| US-6 | 3 | 2 |
| US-7 | 2 | 1 (верификация) |
| US-8 | 3 | 2 |
| US-9 | 2 | 1 |
| US-10 | 2 | 1.5 |
| US-11 | 2 | 1 |
| US-12 | 3 | 2 |
| **Итого** | **30** | **~19 часов** |

---

## Последствия решения

### Позитивные
- Mobile-first опыт для 70-80% аудитории
- Улучшение Web Vitals (LCP, CLS) -> лучшее ранжирование в поисковиках
- Единообразная навигация -> снижение bounce rate
- ISR -> снижение нагрузки на PostgreSQL в 10-50x для публичных страниц

### Требующие внимания
- После перехода на ISR -- мутации через API должны вызывать `revalidatePath()`
- При добавлении новых публичных страниц -- следовать паттерну ISR + Navbar/Footer
- Poster-изображения для видео нужно сгенерировать из реальных видеофайлов
- Реальные контактные данные нужно получить от PO перед релизом

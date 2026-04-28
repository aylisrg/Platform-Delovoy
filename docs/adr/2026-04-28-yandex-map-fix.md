# ADR: Фикс CSP для Яндекс-карт + переиспользуемый `<YandexMap />`

**Дата:** 2026-04-28
**Статус:** Принято
**Автор:** System Architect
**Связано с:** `next.config.ts:27`, `landing-delovoy-park.ru/components/contacts-section.tsx`, `src/app/(public)/ps-park/page.tsx`

---

## Контекст

1. На лендинге `delovoy-park.ru` карта Яндекса не рендерится — CSP `frame-src https://oauth.telegram.org` блокирует iframe `https://yandex.ru/map-widget/v1/...`. Браузер режет молча.
2. Карту нужно добавить на `/ps-park` перед футером (тёмная тема), переиспользуемо.
3. Координаты единые для всех бизнесов: `55.519479, 36.978566` (Промышленная ул., с1, Селятино). Shortlink Яндекса экспирится — оставляем explicit-coords.

---

## Решение

### 1. CSP — итоговая строка

Iframe-виджет Яндекса грузится с `yandex.ru`. Внутри iframe Яндекс сам тянет тайлы/api/телеметрию — это **его** CSP, не наша. Родительский документ должен разрешить только сам frame и (как опционально-полезное) referrer-картинки для og-preview, если будут. `connect-src` для виджета не нужен — XHR происходит внутри iframe.

```diff
- "frame-src https://oauth.telegram.org",
+ "frame-src https://oauth.telegram.org https://yandex.ru https://*.yandex.ru",
```

`img-src` уже содержит `https://mc.yandex.ru` и `https://avatars.yandex.net` — для метрики/аватарок. Добавлять ничего не нужно. `connect-src` — не трогаем.

**Wildcard `*.yandex.ru`** нужен на случай, если виджет редиректит на поддомены (`api-maps.yandex.ru`, `core-renderer-tiles.maps.yandex.net` — последний внутри iframe, нам не важен).

### 2. Компонент `<YandexMap />`

**Где лежит:** `src/components/ui/yandex-map.tsx` (в основном проекте).

**Обоснование:** `landing-delovoy-park.ru/` — это поддиректория для landing-сборки, **не** отдельный пакет. У них общий `package.json`, общий Tailwind-конфиг. Если положить компонент в landing-папку, импорт из `src/app/(public)/ps-park/page.tsx` будет некрасивым cross-folder. Если положить в `src/components/ui/` — оба места импортируют через `@/components/ui/yandex-map`. Это канонично для shared UI (см. CLAUDE.md → `src/components/ui/` = базовые UI-компоненты).

**Сигнатура:**

```tsx
interface YandexMapProps {
  lat: number;
  lon: number;
  zoom?: number;          // default 16
  title: string;          // a11y + iframe title (обязателен)
  theme?: "light" | "dark"; // default "light" — влияет только на обёртку (рамка/фон placeholder), не на сам Яндекс-виджет
  className?: string;     // override обёртки (height, aspect)
  showRouteCta?: boolean; // default true — показывать ли CTA "Построить маршрут"
  ctaLabel?: string;      // default "Построить маршрут в Яндекс Картах"
}
```

**Реализация:**

```tsx
"use client"; // не обязательно — iframe работает и в RSC, оставляем server component

export function YandexMap({ lat, lon, zoom = 16, title, theme = "light", className, showRouteCta = true, ctaLabel = "Построить маршрут в Яндекс Картах" }: YandexMapProps) {
  const embedUrl = `https://yandex.ru/map-widget/v1/?ll=${lon}%2C${lat}&z=${zoom}&pt=${lon}%2C${lat}%2Cpm2rdl&l=map&lang=ru_RU`;
  const openUrl  = `https://yandex.ru/maps/?ll=${lon}%2C${lat}&z=${zoom}&pt=${lon}%2C${lat}&mode=routes&rtext=~${lat}%2C${lon}&rtt=auto`;

  const wrapperLight = "bg-[#f5f5f7] ring-1 ring-black/5 shadow-[0_8px_30px_rgba(0,0,0,0.08)]";
  const wrapperDark  = "bg-zinc-900 ring-1 ring-zinc-800";
  const ctaLight     = "bg-[#f5f5f7] hover:bg-[#ebebed] text-[#1d1d1f]";
  const ctaDark      = "bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800";

  // ... render: iframe + (optional) CTA <a target="_blank" rel="noopener noreferrer">
}
```

- **SSR safety:** iframe — обычный HTML, рендерится на сервере без проблем. `"use client"` не нужен.
- **Lazy loading:** `<iframe loading="lazy">` (нативно).
- **Accessibility:** prop `title` обязателен → пробрасывается в `iframe[title]`. CTA-ссылка имеет `aria-label={ctaLabel}`.
- **`referrerPolicy="no-referrer-when-downgrade"`** на iframe — как сейчас.
- **Темизация:** компонент сам по себе цветовой нейтральности iframe не меняет (Яндекс рендерит тайлы как есть). `theme` влияет на **обёртку** (border/shadow/CTA). Если в будущем понадобится тёмная тема внутри карты — добавим `&theme=dark` в URL (Яндекс поддерживает на новых виджетах).

### 3. CTA "Построить маршрут"

Нужна **в обоих** местах. На лендинге — уже есть; на `/ps-park` — добавляем. Контракт через `showRouteCta` (default `true`). Если в будущем где-то не нужна — выключается флагом.

### 4. Вставка в `/ps-park`

Между `</section>` (booking, line 402) и `<footer>` (line 405):

```tsx
{/* ── LOCATION ── */}
<section id="location" className="max-w-6xl mx-auto px-4 py-16">
  <div className="mb-8">
    <h2
      className="font-[family-name:var(--font-manrope)] font-bold text-white"
      style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-1px" }}
    >
      Как добраться
    </h2>
    <p className="text-zinc-500 text-sm mt-2">
      Селятино, Промышленная ул., 1 · 30 км от Москвы по Киевскому шоссе · бесплатная парковка
    </p>
  </div>
  <YandexMap
    lat={55.519479}
    lon={36.978566}
    title="Плей Парк — Бизнес-парк «Деловой», Селятино"
    theme="dark"
    className="aspect-[4/3] min-h-[400px] rounded-2xl"
  />
</section>
```

### 5. Рефакторинг лендинга

`contacts-section.tsx` — заменить inline-iframe (lines 96–126) на `<YandexMap lat={PARK_LAT} lon={PARK_LON} title="..." theme="light" />`. Константы `MAP_EMBED_URL`/`MAP_OPEN_URL` удаляются — они теперь внутри компонента.

---

## Тесты

`src/components/ui/__tests__/yandex-map.test.tsx` (Vitest + jsdom):

1. **URL-конструктор (unit):** компонент с `lat=55.5`, `lon=36.9`, `zoom=14` → iframe `src` содержит `ll=36.9%2C55.5`, `z=14`, `pt=36.9%2C55.5%2Cpm2rdl`, `lang=ru_RU`.
2. **CTA toggle:** `showRouteCta={false}` → `<a>` с `target="_blank"` отсутствует в DOM.
3. **Theme classes:** `theme="dark"` → wrapper содержит `bg-zinc-900`; `theme="light"` → `bg-[#f5f5f7]`.
4. **a11y:** `iframe[title]` равен переданному prop; CTA-`<a>` имеет `rel="noopener noreferrer"`.

CSP-фикс — без unit-теста (это конфиг). Покрывается E2E-чеклистом ниже.

---

## Acceptance criteria (для QA)

- [ ] Карта отображается на `/` (лендинг, секция "Как нас найти") — виден маркер на координатах парка.
- [ ] Карта отображается на `/ps-park` (новая секция "Как добраться" перед футером) — тёмная обёртка, маркер виден.
- [ ] Клик по "Построить маршрут" открывает `yandex.ru/maps` в **новой вкладке** (target=_blank, noopener).
- [ ] DevTools → Console: **нет** ошибок `Refused to frame ... violates Content Security Policy`.
- [ ] DevTools → Network: запрос на `yandex.ru/map-widget/v1/` возвращает 200, iframe не пустой.
- [ ] Lighthouse (mobile, перфоманс): не падает ниже текущего baseline на `/` (карта lazy-loaded).
- [ ] Скриншот-проверка: на лендинге обёртка светлая (`#f5f5f7` фон, тень), на `/ps-park` — тёмная (`zinc-900`, рамка `zinc-800`).
- [ ] Iframe имеет `title="..."` (читается скринридером).

---

## Последствия

- **Изменяется:** `next.config.ts` (1 строка CSP), `landing-delovoy-park.ru/components/contacts-section.tsx` (рефакторинг), `src/app/(public)/ps-park/page.tsx` (+1 секция).
- **Создаётся:** `src/components/ui/yandex-map.tsx`, `src/components/ui/__tests__/yandex-map.test.tsx`.
- **Влияние на модули:** нет (UI-only, не трогает API/БД/auth).
- **RBAC:** N/A — публичные страницы, без auth.
- **Rate limiting:** N/A — статичный iframe, нет API-вызовов с нашей стороны.
- **Внешние зависимости:** не добавляются.
- **Backward compat:** полная — старый код просто заменяется на компонент с тем же URL-форматом.

---

## Артефакт

ADR: `docs/adr/2026-04-28-yandex-map-fix.md`

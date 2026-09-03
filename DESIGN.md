# Дизайн-система «Деловой Парк» / Delovoy Park Design System

> **Источник правды:** `design/tokens.json` (W3C Design Tokens) + канвас Claude Design
> https://claude.ai/code/artifact/e304994a-9761-479c-b3fe-b86d3e445d34 (артборды в `design/canvas/`).
> Этот документ — словарь и правила применения; значения токенов здесь только для ориентира,
> при расхождении прав `tokens.json`. Прежняя редакция «Apple Light» (`#86868b` как secondary,
> без токенов) и `BRAND_CODE.md` (палитра `#2563EB`/zinc, Bold 700) — устарели.
> ТЗ и аудит: `docs/product/2026-09-03-landing-design-system-brief.md`.
>
> **Source of truth:** `design/tokens.json` + the Claude Design canvas above. This file is the
> vocabulary and the usage rules; where a value here disagrees with `tokens.json`, the JSON wins.
> The previous "Apple Light" edition and `BRAND_CODE.md` are superseded. English section below.

Область: публичный лендинг (`src/app/page.tsx`, `landing-delovoy-park.ru/components/*`) и публичные
примитивы `src/components/ui/*`. Админка (`admin-dark`) и Mini App — вне области, только совместимость
имён токенов.

---

## RU

### 1. Характер

Светлая, тихая, содержательная система: белый и светло-серый чередуются по секциям, типографика и
фотографии парка делают всю работу, один синий акцент отмечает только интерактивное. Manrope 600 с
отрицательным трекингом в заголовках, Inter в тексте. Надёжно · Просто · Рядом · По делу · Современно.

### 2. Цвет (`color.*`)

| Токен | Значение | Применение |
|-------|----------|------------|
| `surface.0` | `#ffffff` | страница, белые карточки, инпуты |
| `surface.1` | `#f5f5f7` | чередующиеся секции, серые карточки |
| `surface.2` | `#e8e8ed` | hover серых карточек, чипы, подложка под фото |
| `surface.inverse` | `#1d1d1f` | только тосты и тултипы |
| `text.primary` | `#1d1d1f` | заголовки, основной текст, текст отзывов |
| `text.secondary` | `#6e6e73` | описания и подписи любого размера (5.2:1 на белом, 4.7:1 на `surface.1`) |
| `text.tertiary` | `#86868b` | только текст ≥15px и декоративные подписи |
| `text.onAccent` | `#ffffff` | текст на `accent` и модульных цветах |
| `accent.default / hover / active` | `#0071e3` / `#0077ed` / `#0066cc` | кнопки, ссылки, фокус, выделенное слово в hero |
| `accent.subtle` | accent 8% | фон иконок, выделенная карточка |
| `border.subtle / default / strong` | black 4% / 8% / 12% | разделители / инпуты / hover |
| `focus.ring` | accent 24%, 3px | только `:focus-visible` |
| `module.rental` | `#0071e3` | Офисы |
| `module.gazebos` | `#15803d` | Барбекю Парк |
| `module.psPark` | `#7c3aed` | Плей Парк |
| `module.cafe` | `#c2410c` | Кафе |
| `module.parking` | `#0e7490` | Автостоянка |
| `rating` | `#fbc02d` | звёзды рейтинга (только заливка иконки) |
| `brand.yandex / twoGis / telegram / whatsapp` | `#fc3f1d` / `#00b140` / `#229ed9` / `#25d366` | только логотипы и кнопки перехода к партнёру |
| `status.success / warning / danger` | `#15803d` / `#b45309` / `#dc2626` | формы, тосты, бейдж «Сдан» |

Правила:
- `accent` — единственный интерактивный цвет вне карточек модулей. Никогда как декоративный фон.
- Модульный цвет живёт только внутри карточки своего модуля: тег на фото, кнопка, иконка на тинте 8%.
  Все пять дают ≥4.5:1 под белым текстом, поэтому кнопки модулей — белый текст на заливке.
- Цвета партнёров и `rating` никогда не становятся UI-акцентом или цветом текста.
- Тёмных фонов для контента нет; `surface.inverse` — только тост и тултип.

### 3. Типографика (`typography.*`)

Manrope 600 для заголовков, статистики и имён; Inter 400/500 для всего остального. Вес 700 не
используется. Файлы шрифтов self-hosted в `src/app/fonts/` (latin + cyrillic).

| Токен | Desktop | Mobile | Трекинг |
|-------|---------|--------|---------|
| `display.hero` | 96 / 0.9 | 48 / 0.92 | −0.04em / −2px |
| `display.section` | 64 / 1 | 40 / 1 | −0.03em / −1.2px |
| `heading.lg` | 32 / 1.1 | 28 / 1.1 | −1px / −0.8px |
| `heading.md` | 24 / 1.15 | 22 / 1.15 | −0.5px |
| `heading.sm` | 20 / 1.2 | 18 / 1.25 | −0.4px |
| `heading.xs` | 16 / 1.3 | — | −0.3px |
| `stat` | 40 / 1.1 | 32 / 1.1 | −1.2px, `tabular-nums` |
| `body.lg` | 18 / 1.5 | 17 / 1.5 | — |
| `body.md` | 15 / 1.6 | 15 / 1.6 | — |
| `body.sm` | 14 / 1.5 | — | только `text.secondary` |
| `caption` | 13 / 1.4 | — | — |
| `label` | 12 / 1.4, 500 | — | +0.3px, единственный uppercase |
| `button` | 15 / 1, 500 | — | — |
| `input` | 15 / 1.5 | 16 / 1.5 | 16px на мобильных, чтобы iOS не зумил |

Минимальный размер текста 12px. Длинные слова («Барбекю Парк», «бронирование») переносятся вручную
через `&shy;`, `hyphens: manual`.

### 4. Отступы, сетка, радиусы, тени, motion

- База 4px; секция `space.section` 96 desktop / 64 mobile; от заголовка до сетки 56 / 40; карточки gap 16
  (20 для крупных), padding 24 / 20.
- Контейнер 1200, gutter 24 / 16. Брейкпоинты Tailwind: sm 640 · md 768 · lg 1024 · xl 1280.
  Сетки 3 → 2 → 1, офисы 4 → 2 → 1; на мобильных офисы и отзывы — горизонтальная лента со snap.
- Радиусы: `sm` 8 (теги), `md` 12 (инпуты, иконки), `lg` 16 (карточки), `xl` 24 (панели), `full` (кнопки, чипы).
- Тени, нейтральные и без цвета: `sm` 0 1 2 / 5% (белая карточка на сером), `md` 0 4 12 / 8% (hover,
  дропдаун), `lg` 0 12 32 / 12% (модалка, hover карточки услуги).
- Motion: easing `cubic-bezier(0.2, 0.8, 0.2, 1)`; `fast` 150ms (цвет, рамка), `base` 250ms (тень, сдвиг);
  reveal при скролле 500ms, opacity 0→1 + translateY 16→0, threshold 0.15, один раз; hover карточки
  translateY −4 + `shadow.lg`, фото scale 1.04 за 500ms; `prefers-reduced-motion` → только opacity 150ms.

### 5. Компоненты

- **Button**: `primary` (синяя пилюля, белый текст), `secondary` (`text.primary` 6% фон), `ghost`
  (синий текст), `danger`; размеры `lg` 52 (hero, формы), `md` 44, `sm` 36 (только desktop-навигация).
  Состояния: hover, `focus-visible` (кольцо 3px, на цветном фоне через белый зазор), active (scale
  0.98, `accent.active`), disabled (opacity 0.4), loading. На мобильных CTA во всю ширину.
- **Input / Textarea**: 48px, `radius.md`, `border.default` → `accent` + `focus.ring`; ошибка
  `status.danger` с подписью; disabled на `surface.1`.
- **Card**: серая на белом (`surface.1`, hover `surface.2`), белая на сером (`surface.0` + `border.subtle`
  + `shadow.sm`), выделенная (`accent.subtle` + рамка accent 12%), интерактивная с фото (lift + `shadow.lg`).
- **Badge / Chip / Tag**: `radius.full`, Inter 500 12–13px. Цветной чип — тинт 8% цвета, точка 6px этого
  цвета и текст `text.primary` (цветной текст на тинте не проходит AA на `surface.1`); чипы-фильтры 40px;
  бейдж рейтинга — белая карточка с логотипом Яндекса; «Сдан» — `status.warning` с белым uppercase 12px.
- **Navbar**: 56px; над hero прозрачный, после скролла белый 96% + `border.subtle`, без `backdrop-blur`.
- **Toast**: `surface.inverse`, белый текст, иконка статуса; **Empty state** отзывов — пунктирная
  карточка на `surface.1` со ссылкой на Яндекс Карты.

### 6. Нельзя

Тёмные фоны для контента, градиенты как декор, glassmorphism и `backdrop-blur`, цветные тени, serif,
вес 700+, новые шрифты, новые акцентные цвета вне таблицы, emoji вместо иконок, текст меньше 12px,
`text.tertiary` на тексте ≤14px.

### 7. Внедрение

По разделу 8 ТЗ одним PR: `@theme` в `globals.css` из `tokens.json`, публичный вариант примитивов
`src/components/ui`, замена хардкода hex в компонентах лендинга, удаление мёртвого `hero-section.tsx`,
снапшот-тесты и e2e-скрины на 1440 и 390. До этого код лендинга остаётся на старых значениях.

---

## EN

### Character

A light, quiet, content-first system: white and light-gray surfaces alternate by section, typography and
park photography do the work, one blue accent marks only what is interactive. Manrope 600 with negative
tracking for headings, Inter for text. No dark content surfaces, no decorative gradients, no glass.

### Tokens (names from `design/tokens.json`)

- **Surfaces**: `surface.0` `#ffffff` page and white cards; `surface.1` `#f5f5f7` alternating sections and
  gray cards; `surface.2` `#e8e8ed` hover and chips; `surface.inverse` `#1d1d1f` toasts only.
- **Text**: `text.primary` `#1d1d1f`; `text.secondary` `#6e6e73` for descriptions at any size (AA on both
  surfaces); `text.tertiary` `#86868b` only at ≥15px; `text.onAccent` white.
- **Accent**: `accent.default` `#0071e3`, `hover` `#0077ed`, `active` `#0066cc`, `subtle` 8% tint;
  the only interactive color outside module cards, never a decorative background.
- **Module accents**, used only inside their module's card: `rental` `#0071e3`, `gazebos` `#15803d`,
  `psPark` `#7c3aed`, `cafe` `#c2410c`, `parking` `#0e7490`. All pass 4.5:1 under white text.
- **Partners** (`brand.yandex` `#fc3f1d`, `twoGis` `#00b140`, `telegram` `#229ed9`, `whatsapp` `#25d366`)
  and `rating` `#fbc02d` appear only in logos, star icons and partner buttons.
- **Status**: `success` `#15803d`, `warning` `#b45309` ("Сдан" badge), `danger` `#dc2626`.
- **Borders**: black 4% / 8% / 12%; **focus**: accent 24%, 3px, `:focus-visible` only.
- **Type**: `display.hero` 96/0.9 (48 mobile), `display.section` 64/1 (40), `heading.lg/md/sm/xs`
  32/24/20/16, `stat` 40 tabular, `body.lg/md/sm` 18/15/14, `caption` 13, `label` 12 uppercase,
  `button` 15/500, `input` 15 (16 on mobile). Minimum 12px; weight 700 is never used.
- **Space**: 4px base; section padding 96 / 64; container 1200, gutter 24 / 16; Tailwind breakpoints.
- **Radius**: 8 / 12 / 16 / 24 / full. **Shadows**: sm, md, lg, neutral only.
- **Motion**: one easing `cubic-bezier(0.2, 0.8, 0.2, 1)`, 150 / 250 ms, scroll reveal 500 ms once,
  reduced motion → opacity only.

### Component prompts for agents

- "Primary CTA: 52px pill, `bg-accent text-text-on-accent`, hover `accent.hover`, active scale 0.98,
  focus ring accent 24% with a white gap, full-width on mobile."
- "Gray card: `bg-surface-1 rounded-lg p-6`, hover `bg-surface-2`, heading `heading.sm` in
  `text.primary`, body `body.sm` in `text.secondary`, 44px icon tile on `accent.subtle`."
- "Tinted chip: 8% tint background, a 6px dot in the module color, `text.primary` label at 12px/500."
- "Module card: photo 4:3 with a 12px module-colored tag, `heading.md`, `body.sm`, 44px pill button
  filled with the module color and white text."
- "Navbar: 56px, transparent over the hero, white 96% plus `border.subtle` after scroll, no blur,
  links 13px/500 at `text.primary` 70%, 40px pill CTA on the right."
- "Input: 48px, `rounded-md`, `border.default`, on focus `border-accent` plus `focus.ring`; error uses
  `status.danger` border and a 12px message."

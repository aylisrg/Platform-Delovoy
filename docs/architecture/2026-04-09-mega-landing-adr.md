# ADR-001: Мега-лендинг — видео-фон Hero + секция отзывов с Яндекс Карт

## Статус
Предложено

## Контекст

Текущий лендинг бизнес-парка "Деловой" статичен, без визуального вау-эффекта. Hero секция — чистый текст на чёрном фоне. Упоминание "300+ отзывов" есть, но сами отзывы не показаны, что снижает социальное доказательство и конверсию.

**Требования от PO:**
1. Видео-фон на Hero секции (autoplay, loop, muted) с fallback на чёрный фон
2. Новая секция "Отзывы" между "Преимущества" и "Контакты" с данными из Яндекс Карт
3. Серверное кэширование отзывов (минимум 1 час)
4. Мобильная оптимизация: постер вместо видео на мобильных устройствах
5. Дизайн остаётся в рамках DESIGN.md (Framer-style, тёмная тема)

**Метрики успеха:**
- Время на первом экране: ~3 сек → >6 сек (видео удерживает)
- Скролл до секции контактов: ~30% → >50% (отзывы мотивируют)
- Клики на waitlist CTA: baseline TBD → +20%

## Варианты

### Вариант A: Клиентский парсинг отзывов (отклонён)
- **Плюсы**: Простота реализации на фронтенде
- **Минусы**:
  - CORS-блокировка Яндекс Карт
  - Парсинг на каждый запрос (нагрузка на клиента)
  - Невозможность кэширования
  - Зависимость от скорости клиентского интернета

### Вариант B: Серверный API route с кэшированием в Redis (выбран)
- **Плюсы**:
  - Обход CORS через серверный запрос
  - Кэширование в Redis (1 час) — минимальная нагрузка на Яндекс
  - Единообразие с существующими API (`apiResponse` / `apiError`)
  - Graceful degradation при недоступности API
  - Контроль TTL и стратегии обновления
- **Минусы**:
  - Зависимость от Redis (уже используется в проекте)
  - Дополнительный API route

### Вариант C: Server Component с прямым fetch (отклонён)
- **Плюсы**: Минималистичный подход, без API route
- **Минусы**:
  - Нет кэширования между запросами разных пользователей
  - Медленный SSR на каждый page load
  - Невозможность client-side обновления без полной перезагрузки

## Решение

**Выбран вариант B: Серверный API route с кэшированием в Redis.**

### Архитектурные решения

#### 1. Видео-фон Hero

**Стратегия:**
- HTML5 `<video>` элемент с `autoplay`, `loop`, `muted`, `playsInline`
- Атрибут `preload="metadata"` для оптимизации загрузки
- Мобильная детекция через CSS media query: `display: none` на `<640px`, показ постера
- Абсолютное позиционирование видео с `z-index: 0`, контент с `z-index: 10`
- Тёмный overlay (`bg-black/60`) поверх видео для читаемости текста

**Graceful degradation:**
- Если видео не загружено (`public/media/hero.mp4` отсутствует) — fallback на чёрный фон через CSS `background: #000`
- Error handling через `onError` event на `<video>` → скрывает элемент, оставляя чёрный фон

**Производительность:**
- Lazy load: `loading="lazy"` (нативная поддержка браузеров)
- Видео сжато до ~2MB (рекомендация пользователю)
- На мобильных: только постер (`public/media/hero-poster.jpg`), видео не загружается

#### 2. API для отзывов с Яндекс Карт

**Эндпоинт:** `GET /api/reviews`

**Задачи API:**
1. Проверить наличие отзывов в Redis (`reviews:yandex`)
2. Если есть и TTL > 0 → вернуть из кэша
3. Если нет → парсить со страницы Яндекс Карт (URL из `YANDEX_MAPS_URL` env)
4. Сохранить в Redis с TTL 3600 секунд (1 час)
5. Вернуть стандартный формат `{ success: true, data: [...] }`

**Парсинг отзывов:**
- Библиотека: **Cheerio** (server-side HTML parsing)
- Fetching: встроенный `fetch()` (Node 18+)
- Селекторы: парсинг DOM Яндекс Карт (структура может меняться — fallback обязателен)

**Fallback стратегия:**
- Если парсинг падает (изменился DOM, недоступен URL) → вернуть `{ success: true, data: [] }`
- UI показывает заглушку: "300+ отзывов на Яндекс Картах" + ссылка
- Логирование ошибки в `SystemEvent` с уровнем `WARNING`

**Формат данных отзыва:**
```typescript
type Review = {
  id: string;           // hash от имени + даты (уникальность)
  author: string;       // Имя автора
  rating: number;       // 1-5
  text: string;         // Текст отзыва
  date: string;         // ISO string или "2 месяца назад"
  source: "yandex";     // Источник (будущее расширение: google, 2gis)
}
```

#### 3. Секция отзывов на лендинге

**Позиция:** Между `<AdvantagesSection />` и `<ContactsSection />` в `src/app/page.tsx`

**Компонент:** `src/components/public/landing/reviews-section.tsx`

**Функционал:**
- Загрузка отзывов через `fetch('/api/reviews')` на клиенте (useEffect)
- Карусель: горизонтальный scroll на мобиле (CSS `overflow-x: auto`), стрелки на десктопе
- Карточка отзыва: тёмная (чёрный фон), Framer Blue акценты, pill-shape рейтинг
- Fallback при ошибке: показ статичного текста "300+ отзывов" + внешняя ссылка

**Дизайн карточки отзыва:**
- Фон: `bg-black` или `bg-[#090909]` (elevated)
- Граница: `border border-white/6` или Framer Blue ring `rgba(0, 153, 255, 0.15) 0px 0px 0px 1px`
- Рейтинг: 5 звёзд в виде `★★★★★` (текст, цвет `#0099ff`)
- Имя автора: `font-manrope font-semibold text-white text-base`
- Текст отзыва: `font-inter text-[#a6a6a6] text-sm leading-relaxed`
- Дата: `font-inter text-white/40 text-xs`
- Border radius: `14px` (соответствие DESIGN.md)

**Карусель:**
- Библиотека: **без внешних зависимостей** — чистый CSS scroll snap
- CSS: `scroll-snap-type: x mandatory`, `scroll-snap-align: start` на карточках
- Кнопки навигации (desktop): стрелки `←` `→` с `scrollBy({ left: cardWidth })`
- Индикаторы (desktop): dots внизу карусели, активный — Framer Blue

#### 4. Кэширование в Redis

**Ключ:** `reviews:yandex`

**TTL:** 3600 секунд (1 час)

**Структура:**
```typescript
{
  fetchedAt: number;      // timestamp
  reviews: Review[];      // массив отзывов
}
```

**Логика обновления:**
- Автоматическое: Redis TTL истекает → следующий запрос парсит заново
- Принудительное: добавить query param `?refresh=1` (только для SUPERADMIN, опционально)

## Последствия

### Изменения в структуре проекта

#### Новые файлы

1. **`src/app/api/reviews/route.ts`**
   - API Route Handler для отзывов
   - Логика: проверка кэша → парсинг → сохранение в Redis → возврат
   - Использует: `cheerio`, `@/lib/redis`, `@/lib/api-response`, `@/lib/logger`

2. **`src/components/public/landing/reviews-section.tsx`**
   - React-компонент секции отзывов
   - Client Component (использует `useState`, `useEffect`)
   - Карусель, карточки, fallback UI

3. **`src/components/public/landing/hero-section-with-video.tsx`**
   - Обновлённая версия `hero-section.tsx` с видео-фоном
   - Встраивает `<video>` элемент, overlay, мобильный fallback
   - Server Component (без state)

4. **`src/lib/parsers/yandex-reviews.ts`**
   - Утилита для парсинга отзывов с Яндекс Карт
   - Функция: `parseYandexReviews(url: string): Promise<Review[]>`
   - Использует: `cheerio`, обработка ошибок, логирование

5. **`public/media/.gitkeep`** (директория уже создана, добавить в `.gitignore` сами файлы)
   - Пользователь загружает: `hero.mp4`, `hero-poster.jpg`

#### Изменённые файлы

1. **`src/app/page.tsx`**
   - Обновить импорт: `HeroSection` → `HeroSectionWithVideo`
   - Добавить `<ReviewsSection />` между `<AdvantagesSection />` и `<ContactsSection />`

2. **`.env.example`**
   - Добавить:
     ```env
     # Yandex Maps
     YANDEX_MAPS_URL="https://yandex.ru/maps/org/delovoy/..."
     ```

3. **`package.json`**
   - Добавить зависимость: `"cheerio": "^1.0.0"`

4. **`.gitignore`**
   - Добавить:
     ```
     # Media files (user uploads)
     public/media/*.mp4
     public/media/*.jpg
     public/media/*.png
     ```

5. **`public/media/README.md`** (создать)
   - Инструкция для пользователя:
     ```markdown
     # Media Assets

     Поместите сюда:
     - `hero.mp4` — фоновое видео для Hero секции (рекомендуемый размер: 1920x1080, до 2MB, формат H.264)
     - `hero-poster.jpg` — постер для мобильных устройств (1920x1080, JPEG, до 200KB)

     Эти файлы не коммитятся в git (исключены через .gitignore).
     ```

### Схема данных

Изменений в Prisma схеме **НЕТ**. Отзывы не хранятся в БД, только в Redis (кэш).

**Логирование ошибок парсинга:**
Используется существующая таблица `SystemEvent`:
```prisma
// Пример записи при ошибке парсинга
{
  level: "WARNING",
  source: "reviews-parser",
  message: "Не удалось спарсить отзывы с Яндекс Карт",
  metadata: {
    url: "https://...",
    error: "Selector not found: .review-card"
  }
}
```

### API-контракт

#### `GET /api/reviews`

**Request:**
```http
GET /api/reviews HTTP/1.1
Host: localhost:3000
```

**Response (успех):**
```json
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "author": "Иван Петров",
      "rating": 5,
      "text": "Отличный бизнес-парк! Работаю здесь уже год, всё устраивает.",
      "date": "2 месяца назад",
      "source": "yandex"
    },
    {
      "id": "def456",
      "author": "Мария С.",
      "rating": 5,
      "text": "Удобная парковка, охрана, хороший интернет. Рекомендую.",
      "date": "3 месяца назад",
      "source": "yandex"
    }
  ]
}
```

**Response (fallback при ошибке парсинга):**
```json
{
  "success": true,
  "data": []
}
```
_UI показывает fallback: "300+ отзывов на Яндекс Картах" + ссылка._

**Response (ошибка сервера, редко):**
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Внутренняя ошибка сервера"
  }
}
```

### Влияние на существующие модули

**Нет влияния** на другие модули. Изменения изолированы в:
- Публичном лендинге (`src/app/page.tsx`, `src/components/public/landing/`)
- Новом API route (`src/app/api/reviews/`)
- Утилите парсинга (`src/lib/parsers/`)

**Зависимости:**
- Redis (уже используется в проекте)
- `cheerio` (новая зависимость, только для парсинга)

### Необходимые миграции

**БД:** Миграции не требуются.

**Env-переменные:** Добавить в `.env`:
```env
YANDEX_MAPS_URL="https://yandex.ru/maps/org/delovoy/..."
```

**Установка зависимостей:**
```bash
npm install cheerio
```

**Создание директории:**
```bash
mkdir -p public/media
```

## Типы и схемы валидации

### `src/lib/parsers/types.ts` (создать)

```typescript
export type Review = {
  id: string;           // Уникальный ID (hash от author + date)
  author: string;       // Имя автора
  rating: number;       // 1-5
  text: string;         // Текст отзыва
  date: string;         // Дата (может быть "2 месяца назад" или ISO)
  source: "yandex";     // Источник (расширяемо: google, 2gis)
};

export type ReviewsCache = {
  fetchedAt: number;    // Unix timestamp
  reviews: Review[];
};
```

### Zod-схема (опционально, для валидации env)

```typescript
// src/lib/parsers/validation.ts
import { z } from "zod";

export const reviewSchema = z.object({
  id: z.string(),
  author: z.string().min(1).max(100),
  rating: z.number().int().min(1).max(5),
  text: z.string().max(1000),
  date: z.string(),
  source: z.literal("yandex"),
});

export const reviewsCacheSchema = z.object({
  fetchedAt: z.number(),
  reviews: z.array(reviewSchema),
});
```

## Детали реализации компонентов

### `HeroSectionWithVideo` структура

```tsx
<section className="relative min-h-screen">
  {/* Video background */}
  <video
    className="absolute inset-0 w-full h-full object-cover md:block hidden"
    autoPlay loop muted playsInline preload="metadata"
    poster="/media/hero-poster.jpg"
    onError={(e) => { e.currentTarget.style.display = 'none' }}
  >
    <source src="/media/hero.mp4" type="video/mp4" />
  </video>

  {/* Mobile poster (shown instead of video on <640px) */}
  <div className="absolute inset-0 md:hidden bg-black">
    <img
      src="/media/hero-poster.jpg"
      className="w-full h-full object-cover opacity-40"
      alt=""
    />
  </div>

  {/* Dark overlay */}
  <div className="absolute inset-0 bg-black/60 z-[1]" />

  {/* Content (existing hero content) */}
  <div className="relative z-10">
    {/* ... existing hero content from hero-section.tsx ... */}
  </div>
</section>
```

### `ReviewsSection` структура

```tsx
<section className="bg-black py-24 px-6 border-t border-white/5">
  <div className="max-w-[1200px] mx-auto">
    {/* Heading */}
    <div className="mb-10">
      <h2 className="font-manrope font-[500] text-white ...">Отзывы</h2>
      <p className="text-[#a6a6a6] ...">
        Реальные мнения арендаторов и гостей
      </p>
    </div>

    {/* Carousel container */}
    {reviews.length > 0 ? (
      <div className="relative">
        {/* Cards scroll container */}
        <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory hide-scrollbar">
          {reviews.map(review => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>

        {/* Desktop navigation arrows */}
        <button className="absolute left-0 top-1/2 ...">←</button>
        <button className="absolute right-0 top-1/2 ...">→</button>
      </div>
    ) : (
      /* Fallback */
      <div className="text-center p-12 border border-white/10 rounded-[14px]">
        <p className="text-white text-lg mb-4">300+ отзывов на Яндекс Картах</p>
        <a href={process.env.NEXT_PUBLIC_YANDEX_MAPS_URL} className="...">
          Читать отзывы →
        </a>
      </div>
    )}

    {/* Link to all reviews */}
    <div className="mt-8 text-center">
      <a href={process.env.NEXT_PUBLIC_YANDEX_MAPS_URL} className="...">
        Все отзывы на Яндекс Картах →
      </a>
    </div>
  </div>
</section>
```

### `ReviewCard` компонент

```tsx
function ReviewCard({ review }: { review: Review }) {
  return (
    <div className="min-w-[300px] md:min-w-[400px] snap-start
                    bg-[#090909] border border-white/6 rounded-[14px] p-6">
      {/* Rating stars */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[#0099ff] text-lg">
          {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
        </span>
        <span className="text-white/40 text-xs">{review.date}</span>
      </div>

      {/* Review text */}
      <p className="text-[#a6a6a6] text-sm leading-relaxed mb-4">
        {review.text}
      </p>

      {/* Author */}
      <p className="font-manrope font-semibold text-white text-base">
        {review.author}
      </p>
    </div>
  );
}
```

## Производительность и оптимизация

### Видео-фон
- **Размер видео:** Рекомендация пользователю — до 2MB, H.264 codec, 1920x1080
- **Загрузка:** `preload="metadata"` — загружает только метаданные, не весь файл сразу
- **Мобильный трафик:** Видео не загружается на `<640px`, только постер (200KB)

### API отзывов
- **Кэш:** Redis с TTL 3600 сек → 1 запрос к Яндексу в час (максимум)
- **Парсинг:** Серверный, не блокирует UI
- **Fallback:** Если парсинг падает → мгновенный fallback UI, без задержек

### Карусель отзывов
- **CSS Scroll Snap:** Нативная браузерная функция, без JS-библиотек
- **Lazy render:** Рендерим только видимые карточки (в будущей оптимизации, если отзывов > 20)

## Риски и ограничения

### Риск 1: Изменение структуры DOM Яндекс Карт
**Вероятность:** Высокая (Яндекс периодически обновляет дизайн)
**Смягчение:**
- Graceful fallback → показ статичного текста "300+ отзывов" + ссылка
- Логирование в `SystemEvent` → алерт в Telegram суперадмину
- Мониторинг: раз в неделю проверять статус парсера

### Риск 2: CAPTCHA или блокировка IP Яндексом
**Вероятность:** Низкая (1 запрос в час с сервера)
**Смягчение:**
- Увеличить TTL до 6-12 часов (если понадобится)
- Добавить User-Agent header, имитирующий браузер
- Rotate IP через прокси (опция для будущего)

### Риск 3: Размер видео-файла
**Вероятность:** Средняя (пользователь может загрузить большой файл)
**Смягчение:**
- Инструкция в `public/media/README.md` — максимум 2MB
- Добавить автоматическую проверку размера через Git hook (опционально)
- Compression на CI/CD (будущая оптимизация)

### Ограничение 1: Нет админки для загрузки видео
**Текущее решение:** Ручная загрузка в `public/media/` через FTP/SSH
**Будущее:** Админ-панель с upload (вне скоупа текущей итерации)

### Ограничение 2: Только Яндекс Карты
**Текущее решение:** Парсинг только с Яндекс Карт
**Будущее:** Интеграция с Google Reviews, 2GIS (расширяемая архитектура через `source` поле)

## Чеклист для Developer

- [ ] Создать директорию `public/media/` и добавить README.md с инструкцией
- [ ] Обновить `.gitignore` — исключить `public/media/*.mp4`, `*.jpg`, `*.png`
- [ ] Обновить `.env.example` — добавить `YANDEX_MAPS_URL`
- [ ] Установить зависимость: `npm install cheerio`
- [ ] Создать `src/lib/parsers/types.ts` с типом `Review` и `ReviewsCache`
- [ ] Создать `src/lib/parsers/yandex-reviews.ts` с функцией парсинга
- [ ] Создать `src/app/api/reviews/route.ts` с логикой кэширования и fallback
- [ ] Создать `src/components/public/landing/reviews-section.tsx` с каруселью
- [ ] Обновить `src/components/public/landing/hero-section.tsx` → добавить видео-фон, overlay, мобильный fallback (или переименовать в `hero-section-with-video.tsx`)
- [ ] Обновить `src/app/page.tsx` — добавить `<ReviewsSection />` между `<AdvantagesSection />` и `<ContactsSection />`
- [ ] Написать тесты для `parseYandexReviews()` — mock HTML, проверка на корректность парсинга
- [ ] Написать тесты для API route `/api/reviews` — mock Redis, проверка кэша и fallback
- [ ] Проверить мобильную адаптивность: видео скрыто на `<640px`, постер показан
- [ ] Проверить accessibility: карусель управляется клавиатурой, alt-тексты на изображениях
- [ ] Задеплоить на staging → попросить пользователя загрузить `hero.mp4` и `hero-poster.jpg`
- [ ] Проверить метрики: время на Hero секции, скролл до контактов, клики на CTA

## Связанные документы

- **PRD:** `docs/requirements/2026-04-09-mega-landing-prd.md`
- **Дизайн-система:** `DESIGN.md`
- **Архитектура проекта:** `CLAUDE.md`

## История изменений

| Дата | Версия | Изменения |
|------|--------|-----------|
| 2026-04-09 | 1.0 | Первая версия ADR — предложение архитектуры |

---

**Следующий шаг:** Передать ADR Developer для реализации.

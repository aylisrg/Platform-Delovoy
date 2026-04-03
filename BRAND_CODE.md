# Бренд-код «Деловой Парк» — Техническое задание для дизайнера

> **Цель документа:** Полная спецификация дизайн-системы платформы «Деловой Парк» (Селятино, Московская обл.). На основании этого ТЗ дизайнер разрабатывает и отрисовывает все элементы бренда и интерфейса в Figma.

---

## ЧАСТЬ 1. БРЕНД-ИДЕНТИЧНОСТЬ

### 1.1 О продукте

«Деловой Парк» — бизнес-парк в Селятино (Московская область). Платформа решает две задачи:

- **B2C (клиенты):** Бронирование беседок, PlayStation-столов, заказ еды из кафе, информация о парковке, личный кабинет.
- **B2B (бизнес):** Аренда офисов, CRM арендаторов, управление договорами.
- **Admin (внутри):** Панели менеджеров каждого модуля + суперадмин-дашборд с мониторингом.

### 1.2 Позиционирование бренда

| Атрибут | Описание |
|---------|----------|
| **Характер** | Надёжный, современный, деловой — но не холодный |
| **Ценности** | Прозрачность, удобство, профессионализм, локальность |
| **Аудитория B2C** | Сотрудники офисов парка, местные жители, семьи (беседки) |
| **Аудитория B2B** | Предприниматели, малый и средний бизнес МО |
| **Тон коммуникации** | Деловой, но дружелюбный. Без канцелярита. Без излишней официальности |

### 1.3 Ключевые слова бренда

`Надёжно` · `Просто` · `Рядом` · `По делу` · `Современно`

---

## ЧАСТЬ 2. ЦВЕТОВАЯ СИСТЕМА

> Все цвета должны быть представлены в форматах: HEX, RGB, HSL, Figma Token.

### 2.1 Основная палитра (Primary)

Базовый цвет платформы — **глубокий синий**. Ассоциируется с деловым пространством, доверием, технологиями.

| Токен | HEX | Применение |
|-------|-----|-----------|
| `primary-50` | `#EFF6FF` | Фон hover-состояний, светлые подложки |
| `primary-100` | `#DBEAFE` | Фоны info-badges, выделения в таблицах |
| `primary-200` | `#BFDBFE` | Границы активных элементов |
| `primary-300` | `#93C5FD` | Иллюстративные акценты |
| `primary-400` | `#60A5FA` | Второстепенные интерактивные элементы |
| `primary-500` | `#3B82F6` | Иконки, ссылки |
| `primary-600` | `#2563EB` | **Основная кнопка, активные ссылки** ← главный цвет |
| `primary-700` | `#1D4ED8` | Hover основной кнопки |
| `primary-800` | `#1E40AF` | Pressed-состояние |
| `primary-900` | `#1E3A8A` | Тёмные тексты на светлом primary-фоне |

**Логотип/акцент:** Рассмотреть добавление фирменного тёмно-синего `#0F2351` как brand-blue для логотипа.

### 2.2 Нейтральная палитра (Neutral / Zinc)

| Токен | HEX | Применение |
|-------|-----|-----------|
| `neutral-0` | `#FFFFFF` | Фон карточек, модалок, форм |
| `neutral-50` | `#FAFAFA` | Фон страниц, admin layout |
| `neutral-100` | `#F4F4F5` | Фон disabled, hover строк таблиц |
| `neutral-200` | `#E4E4E7` | Разделители, границы карточек |
| `neutral-300` | `#D4D4D8` | Границы инпутов в normal-состоянии |
| `neutral-400` | `#A1A1AA` | Placeholder текст |
| `neutral-500` | `#71717A` | Secondary текст, подписи |
| `neutral-600` | `#52525B` | Body текст второго уровня |
| `neutral-700` | `#3F3F46` | Body текст основной |
| `neutral-800` | `#27272A` | Заголовки |
| `neutral-900` | `#18181B` | Основной текст |

### 2.3 Семантические цвета (Semantic)

#### Success (Зелёный)
| Токен | HEX | Применение |
|-------|-----|-----------|
| `success-50` | `#F0FDF4` | Фон success-alert |
| `success-100` | `#DCFCE7` | Фон success-badge |
| `success-500` | `#22C55E` | Иконки успеха |
| `success-600` | `#16A34A` | Текст success, основной success |
| `success-800` | `#166534` | Тёмный текст на success-фоне |

#### Warning (Жёлтый/Янтарный)
| Токен | HEX | Применение |
|-------|-----|-----------|
| `warning-50` | `#FFFBEB` | Фон warning-alert |
| `warning-100` | `#FEF3C7` | Фон warning-badge |
| `warning-500` | `#F59E0B` | Иконки предупреждения |
| `warning-600` | `#D97706` | Текст warning |
| `warning-800` | `#92400E` | Тёмный текст на warning-фоне |

#### Danger / Error (Красный)
| Токен | HEX | Применение |
|-------|-----|-----------|
| `danger-50` | `#FFF1F2` | Фон error-alert |
| `danger-100` | `#FFE4E6` | Фон danger-badge |
| `danger-500` | `#EF4444` | Иконки ошибок |
| `danger-600` | `#DC2626` | Текст danger, кнопка Delete |
| `danger-800` | `#7F1D1D` | Тёмный текст на danger-фоне |

#### Info (Голубой)
| Токен | HEX | Применение |
|-------|-----|-----------|
| `info-100` | `#DBEAFE` | Фон info-badge |
| `info-500` | `#3B82F6` | Иконки info |
| `info-800` | `#1E3A8A` | Тёмный текст на info-фоне |

### 2.4 Модульные акцентные цвета

Каждый B2C-модуль имеет свой акцентный цвет для визуальной идентификации в навигации, иконках и карточках главной страницы.

| Модуль | Цвет | HEX | Обоснование |
|--------|------|-----|-------------|
| **Беседки** | Зелёный | `#16A34A` | Природа, свежий воздух |
| **PS Park** | Фиолетовый | `#7C3AED` | Игры, развлечения |
| **Кафе** | Оранжевый | `#EA580C` | Еда, тепло, аппетит |
| **Парковка** | Серо-синий | `#475569` | Транспорт, инфраструктура |
| **Аренда офисов** | Тёмно-синий | `#1D4ED8` | Бизнес, профессионализм |

### 2.5 Что нужно отрисовать (цвета)

- [ ] Палитра всех цветов в виде свотч-листа (5 колонок × 10 строк оттенков)
- [ ] Таблица применения каждого цвета с примером контекста
- [ ] Цветовые пары: фон + текст + border для каждого семантического состояния
- [ ] Модульные акцентные цвета на карточках главной страницы

---

## ЧАСТЬ 3. ТИПОГРАФИКА

### 3.1 Шрифтовая пара

| Роль | Шрифт | Источник | Обоснование |
|------|-------|----------|-------------|
| **Основной (UI)** | `Inter` | Google Fonts / Bunny Fonts | Читаемость в интерфейсах, кириллица, современный |
| **Акцентный (заголовки лендинга)** | `Manrope` | Google Fonts | Геометрический, деловой, хорошая кириллица |
| **Моноширинный (код, ID, цены)** | `JetBrains Mono` | Google Fonts | Техничность, числа, коды бронирований |

> Альтернатива если Inter/Manrope не подходят: `Nunito Sans` (основной) + `Playfair Display` (акцент для лендинга).

### 3.2 Типографическая шкала

| Токен | Размер | Line Height | Weight | Применение |
|-------|--------|-------------|--------|-----------|
| `display-2xl` | 72px | 90px | 700 Bold | Hero-заголовок главной (только лендинг) |
| `display-xl` | 60px | 72px | 700 Bold | Секционные заголовки лендинга |
| `display-lg` | 48px | 60px | 700 Bold | Заголовки страниц |
| `display-md` | 36px | 44px | 700 Bold | H1 внутренних страниц |
| `display-sm` | 30px | 38px | 600 Semibold | H2 |
| `display-xs` | 24px | 32px | 600 Semibold | H3, заголовки секций |
| `text-xl` | 20px | 30px | 500 Medium | Подзаголовки, lead-текст |
| `text-lg` | 18px | 28px | 400 Regular | Основной body крупный |
| `text-md` | 16px | 24px | 400 Regular | **Основной body** ← базовый |
| `text-sm` | 14px | 20px | 400 Regular | Secondary текст, описания |
| `text-xs` | 12px | 18px | 400 Regular | Микро-текст, badge, метки |
| `text-xxs` | 10px | 14px | 500 Medium | Timestamps, системные метки |

### 3.3 Примеры применения

```
H1 страницы беседок:        display-md / Manrope Bold 36px
Цена за час:                display-xs / Inter Semibold 24px + JetBrains Mono для числа
Описание ресурса:           text-sm / Inter Regular 14px / neutral-600
Кнопка основная:            text-sm / Inter Semibold 14px
Лейбл формы:               text-xs / Inter Medium 12px / neutral-700
Placeholder инпута:         text-md / Inter Regular 16px / neutral-400
Badge статуса:              text-xs / Inter Medium 12px / uppercase
Timestamp в таблице:        text-xs / JetBrains Mono / neutral-500
```

### 3.4 Что нужно отрисовать (типографика)

- [ ] Typescale-таблица: все уровни с примерами текста на русском
- [ ] Шрифтовые образцы обоих шрифтов: Кириллица + Latin, все веса
- [ ] Примеры заголовков H1–H4 в контексте страниц
- [ ] Пример параграфного текста (2–3 абзаца) в правильном стиле
- [ ] Примеры цен/числе в JetBrains Mono

---

## ЧАСТЬ 4. СЕТКА И ОТСТУПЫ

### 4.1 Базовая единица

**Base unit = 4px.** Все отступы кратны 4px.

| Токен | px | rem | Применение |
|-------|----|----|-----------|
| `space-1` | 4px | 0.25rem | Micro-gap внутри компонентов |
| `space-2` | 8px | 0.5rem | Внутренний padding иконки, gap в badge |
| `space-3` | 12px | 0.75rem | Padding кнопки sm, gap в inline-группах |
| `space-4` | 16px | 1rem | Padding кнопки md, gap в form-группах |
| `space-5` | 20px | 1.25rem | Padding секций карточки |
| `space-6` | 24px | 1.5rem | Padding карточки, gap в grid |
| `space-8` | 32px | 2rem | Padding страниц (мобайл), gap между секциями |
| `space-10` | 40px | 2.5rem | Отступы между крупными блоками |
| `space-12` | 48px | 3rem | Padding страниц (десктоп) |
| `space-16` | 64px | 4rem | Hero padding, section gaps |
| `space-20` | 80px | 5rem | Крупные section margins |
| `space-24` | 96px | 6rem | Header высота, top padding лендинга |

### 4.2 Сетка (Grid)

#### Публичные страницы (B2C)

```
Контейнер:    max-width: 1280px, auto margin, padding: 0 24px (mobile: 0 16px)
Колонки:      12 columns
Gutter:       24px (mobile: 16px)
Margin:       24px (mobile: 16px)

Breakpoints:
  xs:  < 640px    (мобайл, 1 колонка)
  sm:  640–767px  (мобайл L, 2 колонки)
  md:  768–1023px (планшет, 2–3 колонки)
  lg:  1024–1279px (десктоп S, 3–4 колонки)
  xl:  ≥ 1280px   (десктоп, полная сетка)
```

#### Типичные layout-паттерны

| Страница | Desktop | Tablet | Mobile |
|----------|---------|--------|--------|
| Главная (hero) | 1 колонка full-width | 1 колонка | 1 колонка |
| Карточки модулей | 3 колонки | 2 колонки | 1 колонка |
| Список беседок/столов | 3 колонки | 2 колонки | 1 колонка |
| Страница бронирования | 2 колонки (кал + форма) | 1 колонка | 1 колонка |
| Меню кафе | 4 колонки | 2 колонки | 2 колонки |
| Личный кабинет | 2 колонки | 1 колонка | 1 колонка |

#### Admin панели

```
Контейнер:    Sidebar (256px) + Content (flex-1)
Content max:  max-width: 1440px
Padding:      32px (content area)

Admin grid:
  Stats widgets:  4 колонки → 2 → 1
  Data tables:    full-width
  Forms:          max-width: 640px centered
```

### 4.3 Что нужно отрисовать (сетка)

- [ ] Desktop layout grid на примере главной страницы
- [ ] Tablet и mobile breakpoints одной и той же страницы
- [ ] Admin layout: sidebar + content area

---

## ЧАСТЬ 5. РАДИУСЫ, ТЕНИ, ELEVATION

### 5.1 Радиусы скругления

| Токен | px | Применение |
|-------|----|-----------| 
| `radius-sm` | 4px | Теги, микро-элементы |
| `radius-md` | 6px | Инпуты, кнопки sm |
| `radius-lg` | 8px | Кнопки md/lg, dropdown |
| `radius-xl` | 12px | Карточки, панели |
| `radius-2xl` | 16px | Модальные окна, крупные панели |
| `radius-3xl` | 24px | Hero-блоки, промо-карточки |
| `radius-full` | 9999px | Badge, avatar, таблетки-фильтры |

### 5.2 Система теней (Elevation)

| Токен | CSS Shadow | Уровень | Применение |
|-------|-----------|---------|-----------|
| `shadow-none` | none | 0 | Flat-элементы |
| `shadow-xs` | `0 1px 2px rgba(0,0,0,0.05)` | 1 | Инпуты, inline-элементы |
| `shadow-sm` | `0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)` | 2 | Карточки default |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)` | 3 | Карточки hover, dropdown |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.10), 0 4px 6px rgba(0,0,0,0.05)` | 4 | Модальные окна, поповеры |
| `shadow-xl` | `0 20px 25px rgba(0,0,0,0.10), 0 10px 10px rgba(0,0,0,0.04)` | 5 | Sidebar мобайл, hero |
| `shadow-primary` | `0 4px 14px rgba(37,99,235,0.30)` | — | Hover основной кнопки |
| `shadow-danger` | `0 4px 14px rgba(220,38,38,0.30)` | — | Hover danger-кнопки |

### 5.3 Border styles

```
default:   1px solid neutral-200
focused:   2px solid primary-600 (+ shadow-xs primary-100)
error:     1px solid danger-600
disabled:  1px solid neutral-100
```

---

## ЧАСТЬ 6. ИКОНОГРАФИЯ

### 6.1 Иконный набор

**Основной:** [Lucide Icons](https://lucide.dev/) — React-native, MIT license, 1500+ иконок, единый стиль (2px stroke, rounded caps).

**Принцип:** Только outline-стиль (не filled), strokeWidth = 2px, одинаковый во всём продукте.

### 6.2 Размеры иконок

| Токен | px | Применение |
|-------|----|-----------| 
| `icon-xs` | 12px | Inline в badge, рядом с текстом xs |
| `icon-sm` | 16px | Inline в кнопках sm, лейблах |
| `icon-md` | 20px | **Основной размер** — кнопки, навигация |
| `icon-lg` | 24px | Заголовки секций, крупные кнопки |
| `icon-xl` | 32px | Empty state, модальные иконки |
| `icon-2xl` | 48px | Hero-иконки модулей |
| `icon-3xl` | 64px | Иллюстративные иконки |

### 6.3 Иконки по модулям (обязательный набор)

| Модуль | Иконка Lucide | Применение |
|--------|--------------|-----------|
| Беседки | `Tent` / `TreePine` | Навигация, карточка модуля |
| PS Park | `Gamepad2` | Навигация, карточка модуля |
| Кафе | `Coffee` / `UtensilsCrossed` | Навигация, карточка модуля |
| Парковка | `ParkingSquare` / `Car` | Навигация, карточка модуля |
| Аренда офисов | `Building2` | Навигация, карточка модуля |
| Пользователь | `User` / `Users` | Auth, admin |
| Бронирование | `CalendarCheck` | Статус, таблицы |
| Заказ | `ShoppingCart` / `Package` | Корзина кафе |
| Настройки | `Settings` | Admin |
| Мониторинг | `Activity` / `HeartPulse` | Дашборд |
| Уведомления | `Bell` | Header |
| Выход | `LogOut` | Auth |
| Поиск | `Search` | Фильтры |
| Фильтр | `Filter` | Таблицы |
| Добавить | `Plus` / `PlusCircle` | Кнопки создания |
| Редактировать | `Pencil` / `Edit3` | CRUD actions |
| Удалить | `Trash2` | CRUD actions |
| Подтвердить | `CheckCircle` | Статус confirmed |
| Отменить | `XCircle` | Статус cancelled |
| В работе | `Clock` | Статус pending |
| Успех | `Check` | Успешное действие |
| Ошибка | `AlertCircle` | Ошибки |
| Предупреждение | `AlertTriangle` | Warnings |
| Деньги | `Banknote` / `Wallet` | Цены, финансы |
| Договор | `FileText` | Rental модуль |
| Телефон | `Phone` | Контакты |
| Email | `Mail` | Контакты |
| Локация | `MapPin` | Адрес, карта |
| Время | `Clock` | Расписание |
| Дата | `Calendar` | Бронирование |
| Стрелка назад | `ChevronLeft` | Навигация |
| Меню | `Menu` | Мобайл header |
| Закрыть | `X` | Модалки |
| Загрузка | `Loader2` (spin) | Loading states |
| Telegram | Кастомная SVG | Ссылка на бот |

### 6.4 Что нужно отрисовать (иконки)

- [ ] Иконный глоссарий: все 35+ иконок с названиями в сетке
- [ ] Иконки в 4 размерах: sm / md / lg / xl
- [ ] Иконки со всеми статусными цветами (neutral / primary / success / warning / danger)
- [ ] Примеры иконок внутри кнопок (с текстом и без)
- [ ] Модульные «hero»-иконки 64px с фоновыми плашками


---

## ЧАСТЬ 7. UI-КОМПОНЕНТЫ — ПОЛНАЯ СПЕЦИФИКАЦИЯ

> Каждый компонент отрисовывается во ВСЕХ состояниях: default, hover, focus, active, disabled, loading, error.

---

### 7.1 КНОПКИ (Button)

#### Варианты (Variant)

| Вариант | Стиль | Применение |
|---------|-------|-----------|
| `primary` | bg-primary-600, text-white | Основное действие на странице |
| `secondary` | bg-neutral-100, text-neutral-800, border neutral-200 | Второстепенное действие |
| `outline` | border-2 primary-600, text-primary-600, bg-transparent | Альтернативное действие |
| `ghost` | bg-transparent, text-neutral-700 | Третичное действие, nav-кнопки |
| `danger` | bg-danger-600, text-white | Удаление, деструктивные действия |
| `danger-outline` | border-2 danger-600, text-danger-600 | Деструктивное, менее акцентное |
| `link` | text-primary-600, underline-offset-2 | Текстовые ссылки |

#### Размеры (Size)

| Размер | Height | Padding X | Font | Radius | Icon size |
|--------|--------|-----------|------|--------|-----------|
| `xs` | 28px | 10px | 12px Medium | radius-md | 14px |
| `sm` | 32px | 12px | 14px Medium | radius-md | 16px |
| `md` | 40px | 16px | 14px Semibold | radius-lg | 18px |
| `lg` | 48px | 20px | 16px Semibold | radius-lg | 20px |
| `xl` | 56px | 24px | 18px Semibold | radius-xl | 22px |

#### Состояния каждой кнопки

```
default  → нормальное состояние
hover    → +затемнение 10%, cursor: pointer, shadow-primary (для primary)
focus    → ring 2px primary-300, ring-offset 2px
active   → +затемнение 15%, scale 0.98
disabled → opacity-50, cursor: not-allowed
loading  → icon Loader2 spinning слева, текст «Загрузка...», disabled
icon-only → квадратная, padding равный
```

#### Специальные кнопки

- **Кнопка с иконкой слева:** Icon(md) + Gap(8px) + Text
- **Кнопка с иконкой справа:** Text + Gap(8px) + Icon(md) (→ для навигации)
- **Кнопка-иконка:** Только иконка, квадратная, три размера

#### Что нужно отрисовать

- [ ] 7 вариантов × 5 размеров = 35 кнопок в default
- [ ] Primary кнопка во всех 6 состояниях
- [ ] 3 примера с иконкой слева/справа/только
- [ ] Группа кнопок (Button Group) горизонтальная

---

### 7.2 ПОЛЯ ВВОДА (Input / Form Controls)

#### Text Input

```
Структура сверху вниз:
  Label (text-sm, neutral-700, font-medium)
  Gap: 6px
  Input field (height: 40px, padding: 12px 14px)
  Gap: 6px
  Helper text / Error message (text-xs, neutral-500 / danger-600)
```

| Состояние | Border | Background | Label color |
|-----------|--------|-----------|-------------|
| `default` | neutral-300 | white | neutral-700 |
| `hover` | neutral-400 | white | neutral-700 |
| `focus` | primary-600 (2px) | white | primary-700 |
| `filled` | neutral-300 | white | neutral-700 |
| `error` | danger-600 | danger-50 | danger-700 |
| `disabled` | neutral-200 | neutral-50 | neutral-400 |
| `read-only` | neutral-200 | neutral-50 | neutral-600 |

#### Типы инпутов

- **Text** — однострочный
- **Textarea** — многострочный, resize-y, min-height 80px
- **Number** — для количества, кол-ва часов, цен
- **Date** — календарный пикер
- **Time** — выбор времени (HH:MM)
- **Phone** — с префиксом +7 (Россия)
- **Search** — с иконкой Search слева, кнопкой ×-clear справа
- **Password** — с кнопкой show/hide справа

#### Select / Dropdown

- Высота 40px, стрелка ChevronDown справа
- Открытый список: карточка shadow-lg, radius-xl, max-h 240px overflow-scroll
- Опция: padding 10px 12px, hover bg-neutral-50
- Выбранная опция: bg-primary-50, text-primary-700, check-иконка справа
- Пустая опция: italic, neutral-400

#### Checkbox и Radio

```
Checkbox:
  Размер: 16×16px, radius-sm (4px)
  Unchecked: border neutral-300, bg white
  Checked:   bg primary-600, border primary-600, check-icon white
  Indeterminate: bg primary-600, minus-icon white

Radio:
  Размер: 16×16px, border-radius full
  Unchecked: border neutral-300
  Checked:   border primary-600, dot primary-600 inside

Оба: label справа (text-sm neutral-800), gap 8px
     disabled: opacity-50
```

#### Toggle (Switch)

```
Track:  36×20px, radius-full
  Off: bg neutral-200
  On:  bg primary-600

Thumb:  16×16px, bg white, shadow-sm, radius-full
  Анимация: transition 200ms ease
```

#### Что нужно отрисовать

- [ ] Text input во всех 7 состояниях + с label + с helper text + с error
- [ ] Input с иконкой слева / справа / с обеих сторон
- [ ] Textarea (default + error)
- [ ] Select: closed + open с опциями + выбранная опция
- [ ] Checkbox: 3 состояния × 2 (enabled/disabled)
- [ ] Radio group: 3 опции, одна выбрана
- [ ] Toggle: on / off / disabled
- [ ] Полная форма бронирования (Label + Input + Error в связке)

---

### 7.3 КАРТОЧКИ (Card)

#### Base Card

```
bg: white
border: 1px solid neutral-200
border-radius: radius-xl (12px)
shadow: shadow-sm
padding: space-6 (24px)
hover (интерактивная): shadow-md, translate-y -2px, transition 200ms
```

#### Варианты карточек

**Resource Card (беседка, PlayStation-стол)**
```
┌─────────────────────────────┐
│  [Фото / Иллюстрация]       │  height: 180px, object-fit: cover, radius-xl top
│                             │
├─────────────────────────────┤
│  Беседка №3          [Badge]│  title text-lg semibold + status badge
│  Вместимость: 8 чел.        │  meta text-sm neutral-500
│  ─────────────────────────  │
│  ₽ 500 / час                │  price display-xs semibold primary-700 + JetBrains Mono
│                             │
│  [Проверить доступность →]  │  кнопка primary full-width
└─────────────────────────────┘
```

**Module Card (главная страница)**
```
┌─────────────────────────────┐
│  [Иконка 48px в цветном bg] │  icon-hero с accentColor bg, radius-xl
│                             │
│  Кафе                       │  display-xs semibold
│  Заказ еды с доставкой      │  text-sm neutral-500
│  в ваш офис                 │
│                 [→]         │  стрелка-кнопка ghost
└─────────────────────────────┘
hover: цветная border-left (4px, accentColor), shadow-md
```

**Order/Booking Card (личный кабинет)**
```
┌─────────────────────────────┐
│  Беседка №2  [ПОДТВЕРЖДЕНО] │  title + badge
│  15 мая 2025 · 14:00–18:00  │  meta: calendar icon + text-sm
│  ─────────────────────────  │
│                  ₽ 2 000    │  price right-aligned
│  [Отменить]                 │  danger-outline кнопка
└─────────────────────────────┘
```

**Status Widget (admin dashboard)**
```
┌─────────────────────────────┐
│  Бронирований сегодня       │  label text-sm neutral-500
│  42                         │  value display-md bold neutral-900
│  ↑ +12% к вчера             │  trend: success-600 / danger-600
│  [иконка CalendarCheck]     │  icon right-bottom, neutral-200
└─────────────────────────────┘
```

**Alert Card**
```
Варианты: info / success / warning / danger
┌─────────────────────────────┐
│  [!] Заголовок алерта       │  icon + title semibold
│  Описание происходящего     │  body text-sm
│  [Действие]    [Закрыть]    │  actions
└─────────────────────────────┘
```

#### Что нужно отрисовать

- [ ] Resource Card: default / hover / unavailable (disabled)
- [ ] Module Card: все 5 модулей с их акцентными цветами
- [ ] Order Card: статусы PENDING / CONFIRMED / CANCELLED / COMPLETED
- [ ] Status Widget: 4 штуки в ряд (дашборд)
- [ ] Alert: 4 варианта (info / success / warning / danger)
- [ ] Пустое состояние карточки (Empty State с иконкой и текстом)

---

### 7.4 БЕЙДЖИ И СТАТУСЫ (Badge / Status)

#### Status Badge

| Статус | Label | bg | text | dot |
|--------|-------|----|------|-----|
| `PENDING` | Ожидает | warning-100 | warning-800 | warning-500 |
| `CONFIRMED` | Подтверждено | success-100 | success-800 | success-500 |
| `CANCELLED` | Отменено | danger-100 | danger-800 | danger-500 |
| `COMPLETED` | Завершено | neutral-100 | neutral-600 | neutral-400 |
| `AVAILABLE` | Доступно | success-100 | success-800 | success-500 |
| `OCCUPIED` | Занято | danger-100 | danger-800 | danger-500 |
| `MAINTENANCE` | На обслуживании | warning-100 | warning-800 | warning-500 |
| `ACTIVE` | Активен | success-100 | success-800 | success-500 |
| `EXPIRING` | Истекает | warning-100 | warning-800 | warning-500 |
| `EXPIRED` | Истёк | neutral-100 | neutral-600 | neutral-400 |
| `NEW` | Новый | info-100 | info-800 | info-500 |
| `PREPARING` | Готовится | warning-100 | warning-800 | warning-500 |
| `READY` | Готово | success-100 | success-800 | success-500 |
| `DELIVERED` | Доставлено | neutral-100 | neutral-600 | neutral-400 |

```
Структура badge:
  [● dot 6px] [Label text-xs font-medium]
  padding: 2px 8px
  border-radius: radius-full
  height: 20px
```

#### Pill (теги-фильтры)

```
Деактивный: bg neutral-100, text neutral-700, border neutral-200
Активный:   bg primary-50, text primary-700, border primary-200
```

#### Что нужно отрисовать

- [ ] Все 14 статусных бейджей в ряд
- [ ] Badge в 3 размерах (xs / sm / md)
- [ ] Pill-фильтры: группа из 5 штук, один активный
- [ ] Badge на карточке (in-context пример)

---

### 7.5 ТАБЛИЦЫ (Table)

#### Base Table

```
Структура:
  Table header row: bg neutral-50, border-b neutral-200
    Th: text-xs uppercase letter-spacing-wide neutral-500 font-semibold
        padding: 12px 16px
  
  Table body rows: bg white, border-b neutral-100
    hover row: bg neutral-50
    Td: text-sm neutral-700, padding: 14px 16px
    
  Striped variant: нечётные строки bg neutral-50/50

Сортировка:
  Th с сортировкой: cursor pointer, иконка ChevronsUpDown neutral-400
  Активная сортировка: иконка ChevronUp/Down primary-600

Pagination:
  [← Пред.]  [1] [2] [3] ... [8]  [След. →]
  text-sm, кнопки ghost, активная страница: bg primary-50 text-primary-700
```

#### Таблица бронирований (admin)

```
Колонки: ID | Клиент | Ресурс | Дата | Время | Статус | Сумма | Действия
Действия: кнопки-иконки: CheckCircle(confirm) / XCircle(cancel) / Eye(view)
```

#### Таблица заказов кафе (admin)

```
Колонки: №Заказа | Клиент | Офис | Позиции | Сумма | Статус | Действия
```

#### Что нужно отрисовать

- [ ] Полная таблица бронирований: 5 строк, разные статусы
- [ ] Таблица с пагинацией (3 страницы)
- [ ] Пустая таблица (empty state)
- [ ] Mobile view таблицы (карточки-аккордеоны)

---

### 7.6 ФОРМЫ БРОНИРОВАНИЯ (Booking Form)

#### Форма беседки / PS Park

```
Шаг 1 — Выбор даты и времени:
  [Датапикер: сетка месяца]
    Дни: circle 36px
    Сегодня: border primary-600
    Выбранный: bg primary-600 text-white
    Недоступный: text neutral-200, strikethrough
    Прошедший: text neutral-300
  
  [Выбор времени]
    Слоты 30мин, сетка 2 колонки:
    Доступно:    bg white, border neutral-200, hover primary-50
    Выбрано:     bg primary-600, text white
    Недоступно:  bg neutral-100, text neutral-300, cursor-not-allowed

Шаг 2 — Детали:
  Количество гостей (Number input, иконка Users)
  Ваше имя (Text input)
  Телефон (Phone input, +7 prefix)
  Комментарий (Textarea, optional)

Шаг 3 — Подтверждение:
  Карточка-резюме:
    Беседка №3
    15 мая 2025
    14:00 – 18:00  (4 часа)
    ─────────────
    Итого:  ₽ 2 000
  
  [Подтвердить бронирование →] (primary lg full-width)
  
Шаг 4 — Успех:
  Иконка CheckCircle (64px, success-600)
  Заголовок «Бронирование подтверждено!»
  Номер брони #GZB-2025-042
  CTA: [Мои брони] [На главную]
```

#### Прогресс шагов (Step Indicator)

```
[1 Дата] ─── [2 Детали] ─── [3 Оплата] ─── [4 Готово]
  ●              ○               ○               ○

Активный:    ● circle 32px bg primary-600 text white
Завершённый: ● circle 32px bg success-600, check-icon
Будущий:     ○ circle 32px border neutral-300 text neutral-400
Линия:       2px neutral-200 / primary-600 (если завершён)
```

#### Что нужно отрисовать

- [ ] Шаг 1: Датапикер (месячный вид) + слоты времени
- [ ] Шаг 2: Форма деталей (все поля)
- [ ] Шаг 3: Карточка-резюме + кнопка
- [ ] Шаг 4: Success screen
- [ ] Step Indicator во всех комбинациях прогресса
- [ ] Мобильная версия каждого шага

---

### 7.7 НАВИГАЦИЯ

#### Header (публичный)

```
┌────────────────────────────────────────────────────────────┐
│ [Логотип]    Беседки  PS Park  Кафе  Парковка    [Войти]  │
│              Аренда                              [Личный кабинет] │
└────────────────────────────────────────────────────────────┘
height: 64px (desktop), 56px (mobile)
bg: white, border-b neutral-200, shadow-xs
sticky top-0, z-50

Активная ссылка: text primary-600, border-b-2 primary-600
Hover ссылка:    text neutral-900

Mobile header:
  [Логотип]              [☰ Меню]
  Drawer: появляется справа, overlay bg-black/40
```

#### Sidebar (admin)

```
width: 256px (desktop), fullscreen drawer (mobile)
bg: white, border-r neutral-200

Логотип-зона:
  height: 64px, border-b, padding 20px
  [Логотип] Деловой Парк

Navigation группы:
  Группа «Модули»:
    label: text-xs uppercase neutral-400 font-semibold, padding 8px 20px
    Items: icon(md) + label text-sm neutral-700
      default: padding 10px 20px, hover bg-neutral-50 rounded-lg
      active:  bg-primary-50 text-primary-700 font-medium, border-l-3 primary-600

Нижняя зона:
  Статус пользователя:
    [Avatar] Имя пользователя
    Роль: Суперадмин
    [LogOut кнопка ghost]
```

#### Breadcrumb

```
Главная / Беседки / Бронирование #042
text-sm, neutral-500, separator «/» neutral-300
последний элемент: neutral-900 font-medium
```

#### Pagination

```
[← Предыдущая]  [1]  [2]  [3]  ...  [12]  [Следующая →]
кнопки: 36×36px, radius-lg
active: bg primary-50 text primary-700 border primary-200
```

#### Что нужно отрисовать

- [ ] Desktop header: не авторизован / авторизован (USER) / SUPERADMIN
- [ ] Mobile header + открытый drawer
- [ ] Admin sidebar: collapsed и expanded (mobile)
- [ ] Sidebar: активный пункт, hover, normal, с badge (кол-во)
- [ ] Breadcrumb (2 уровня и 3 уровня)
- [ ] Pagination: страница 3 из 12

---

### 7.8 МОДАЛЬНЫЕ ОКНА (Modal / Dialog)

#### Base Modal

```
Overlay: bg-black/50, backdrop-blur-sm
Modal:   bg white, radius-2xl, shadow-xl
         max-width: 480px (sm) / 640px (md) / 800px (lg) / fullscreen (mobile)
         padding: 32px

Шапка:
  Заголовок display-xs semibold neutral-900
  Кнопка X (ghost icon-only) top-right

Контент: text-sm neutral-700, line-height relaxed

Footer:
  [Отмена (secondary)]  [Подтвердить (primary)]
  justify: flex-end, gap: 12px
```

#### Специальные модалки

- **Confirm Delete:** danger-icon + заголовок + warning text + [Отмена] [Удалить]
- **Booking Details:** полная информация о брони с историей статусов
- **Add Resource:** форма создания нового ресурса
- **Image Preview:** fullscreen с кнопками навигации

#### Что нужно отрисовать

- [ ] Base modal (sm / md)
- [ ] Confirm Delete модалка
- [ ] Мобильная версия (bottom sheet, 100% ширина)

---

### 7.9 УВЕДОМЛЕНИЯ И TOAST

#### Toast notifications

```
Позиция: bottom-right, gap 8px между тостами
Ширина: 360px (desktop), full-width - 32px (mobile)
Animation: slide-in from right, fade-out

Variants:
  success: border-l-4 success-600, icon CheckCircle success-600
  error:   border-l-4 danger-600,  icon XCircle danger-600
  warning: border-l-4 warning-500, icon AlertTriangle warning-500
  info:    border-l-4 primary-600, icon Info primary-600

Структура:
  [Иконка]  [Заголовок semibold]     [×]
            [Описание text-sm neutral-600]

Автозакрытие: 5 секунд, прогресс-бар снизу
```

#### Что нужно отрисовать

- [ ] 4 варианта toast в стеке
- [ ] Toast с прогресс-баром
- [ ] Мобильный toast (top, full-width)

---

### 7.10 ЗАГРУЗОЧНЫЕ СОСТОЯНИЯ (Loading States)

#### Skeleton

```
Анимация: shimmer (gradient slide left→right)
Цвет: neutral-200 (base), neutral-100 (shine)

Skeleton вариации:
  - Текст: h-4 rounded-full (разные ширины: 60%, 80%, 40%)
  - Карточка: полный skeleton карточки ресурса
  - Строка таблицы: 5 колонок skeleton
  - Avatar: circle skeleton
```

#### Spinner

```
Компонент: Loader2 icon, анимация spin
Варианты: xs(16px) / sm(20px) / md(24px) / lg(32px) / xl(48px)
Цвет: primary-600 (основной) / white (на тёмном) / neutral-400 (secondary)
```

#### Что нужно отрисовать

- [ ] Skeleton карточки ресурса (3 в ряд)
- [ ] Skeleton строки таблицы (3 строки)
- [ ] Spinner в кнопке
- [ ] Full-page loading overlay


---

## ЧАСТЬ 8. ЭКРАНЫ — СПЕЦИФИКАЦИЯ ПО СТРАНИЦАМ

> Для каждого экрана указаны: структура, ключевые элементы, состояния, Desktop + Mobile.

---

### 8.1 ГЛАВНАЯ СТРАНИЦА (/)

#### Hero-секция

```
Фон: градиент primary-900 → primary-700 (или фотография бизнес-парка с overlay)
Высота: 480px (desktop) / 360px (mobile)

Содержимое (выровнено по центру):
  Надпись сверху:  «Бизнес-парк Деловой · Селятино»  (text-sm, white/70, uppercase)
  H1:              «Всё для вашего        »  (display-xl, white, Manrope Bold)
                    «бизнеса — в одном месте»
  Подзаголовок:   «Аренда офисов, беседки, кафе, PlayStation-зона  »  (text-xl, white/80)
                   «и многое другое в одном пространстве»
  CTA:             [Забронировать →] (primary xl) + [Об аренде] (outline xl, border white)
  
  Снизу: scroll-indicator (ChevronDown анимация)
```

#### Секция модулей

```
Заголовок секции: «Что есть в Деловом» (display-sm, neutral-900)
Подзаголовок:     «Выберите услугу» (text-lg, neutral-500)

Grid 3 колонки (desktop), 2 (tablet), 1 (mobile):
  [Module Card × 5: Беседки / PS Park / Кафе / Парковка / Аренда]
```

#### Секция «Как забронировать»

```
Шаги (горизонтально, desktop):
  [1 Выберите] → [2 Выберите время] → [3 Подтвердите]
  icon + title + description

Mobile: вертикально
```

#### Секция контактов/местоположения

```
Два блока:
  Левый: Адрес, телефон, email, режим работы
  Правый: Карта (статичный скриншот или iframe)
```

#### Footer

```
Колонки 3 (desktop) / 1 (mobile):
  Логотип + краткое описание + соцсети (Telegram)
  Услуги: ссылки на модули
  Контакты: адрес, телефон, email

Нижняя строка:
  © 2025 Деловой Парк · Политика конфиденциальности
```

**Отрисовать:** Desktop (1280px) + Mobile (375px), все секции

---

### 8.2 СТРАНИЦА БЕСЕДОК (/gazebos)

#### Структура

```
Breadcrumb: Главная / Беседки

H1: «Беседки для отдыха и встреч»
Subtext: «Уютные беседки с мангалами на свежем воздухе. Вместимость 4–12 человек.»

Фильтры (pill-tabs горизонтально):
  [Все] [Маленькие до 4 чел.] [Средние 4–8] [Большие 8+]

Сетка ресурсов (3 колонки → 2 → 1):
  [Resource Card × 6]
  
  Каждая карточка:
    Фото беседки
    «Беседка №3» + badge ДОСТУПНО/ЗАНЯТО
    Вместимость: 8 чел. · Мангал: есть
    ₽ 500 / час
    [Проверить доступность]

Боковая панель (desktop) ИЛИ modal/drawer (mobile):
  Календарь доступности + форма бронирования
```

**Состояния ресурса:** Available / Occupied (все слоты) / Partially occupied

**Отрисовать:** Desktop список + мобайл + состояния карточки

---

### 8.3 СТРАНИЦА PS PARK (/ps-park)

#### Структура

```
Hero-баннер (compact): bg gradient purple-900→purple-600
  Иконка Gamepad2 (64px, white)
  «PlayStation Park»
  «Профессиональные консоли PS5 · до 4 игроков · онлайн-сессии»
  [Забронировать стол]

Как это работает:
  [Три шага: Выбери стол → Выбери время → Играй]

Столы (grid 2 колонки → 1):
  Resource Card стола:
    Фото / иллюстрация консоли
    «Стол PS5 #2» + badge
    2–4 игрока · PS5 Pro
    ₽ 300 / час
    [Забронировать]
```

**Отрисовать:** Desktop + Mobile

---

### 8.4 СТРАНИЦА КАФЕ (/cafe)

#### Структура

```
Шапка кафе:
  Фото интерьера / логотип кафе
  «Кафе Деловой»
  «Доставка в ваш офис · Меню дня · Время работы: 8:00–20:00»

Корзина (sticky справа desktop / fab-кнопка mobile):
  [🛒 2 позиции · ₽ 850 →]

Фильтры меню (pill-tabs):
  [Все] [Завтраки] [Основное] [Напитки] [Десерты] [Пицца]

Сетка меню (4 колонки desktop / 2 mobile):
  Menu Item Card:
    ┌─────────────┐
    │   [Фото]    │  aspect-ratio: 4/3
    ├─────────────┤
    │ Название    │  text-sm semibold
    │ Описание    │  text-xs neutral-500, 2 строки
    │ ₽ 350       │  display-xs semibold primary-700
    │     [+ Add] │  кнопка primary sm (или counter если добавлено)
    └─────────────┘

Counter в карточке (если уже в корзине):
  [−] [2] [+]  (цвет primary)

Недоступная позиция:
  Overlay «Недоступно» + opacity-50
```

#### Корзина (боковая панель / модалка)

```
Заголовок: «Ваш заказ» + кол-во позиций
Список позиций:
  [Фото tiny] Название · ₽ 350  ×2  = ₽ 700   [×]
Разделитель
Итого: ₽ 1 200
Доставить в: [Выбор офиса/этажа dropdown]
[Оформить заказ →]  primary lg full-width
```

**Отрисовать:** Desktop (меню + корзина) + Mobile (меню + FAB + bottom sheet корзина)

---

### 8.5 СТРАНИЦА ПАРКОВКИ (/parking)

```
Hero: фото парковки + overlay
  «Парковка»
  «Бесплатная · 200 мест · Видеонаблюдение»

Блок информации (3 карточки-иконки):
  [🚗 200 мест]  [📹 Видеонаблюдение]  [🕐 Круглосуточно]

Правила парковки:
  Список с иконками CheckCircle

Схема проезда:
  Статичная карта + маршрут

Контакты охраны:
  Телефон + Telegram-бот
```

---

### 8.6 ЛИЧНЫЙ КАБИНЕТ (/dashboard)

```
Header: «Привет, Александр 👋»
Subtext: «Ваши бронирования и заказы»

Две вкладки (Tab):
  [Бронирования]  [Заказы]

Таб «Бронирования»:
  Список Order Cards:
    Active (CONFIRMED): highlighted border-l-4 success-600
    Past (COMPLETED):   opacity-80
    Cancelled:          opacity-60, strikethrough на дате
  
  Пустое состояние:
    Иконка CalendarX (64px)
    «Нет активных бронирований»
    [Забронировать беседку]  [Зайти в PS Park]

Таб «Заказы»:
  Список заказов кафе:
    Статус + дата + сумма + состав

Профиль:
  Имя, телефон, кнопка редактирования
```

---

### 8.7 ADMIN DASHBOARD (/admin/dashboard)

```
Шапка: «Дашборд» + сегодняшняя дата + [Обновить данные]

Row 1 — Stats (4 виджета):
  [Бронирований сегодня: 42 ↑+12%]
  [Заказов в кафе: 18 ↑+5%]
  [Активных договоров: 24 →]
  [Выручка сегодня: ₽ 28 500 ↑+8%]

Row 2 — Статус модулей (grid 5 колонок):
  Карточка модуля с индикатором:
    ● зелёный — Online
    ● жёлтый  — Degraded
    ● красный — Offline
  Последний health check: «2 мин назад»

Row 3 — Последние события (таблица):
  [SystemEvent: level / source / message / time]

Row 4 — Ближайшие бронирования (таблица):
  Сегодня + завтра, 10 записей
```

---

### 8.8 ADMIN БЕСЕДКИ (/admin/gazebos)

```
Header: «Управление беседками»
Кнопки: [+ Добавить беседку] [Экспорт CSV]

Табы:
  [Бронирования]  [Ресурсы]

Таб «Бронирования»:
  Фильтры: [Дата] [Статус dropdown] [Поиск по имени]
  Таблица:
    ID | Клиент | Беседка | Дата | Время | Статус | Сумма | Действия
    Действия: [✓ Подтвердить] [✗ Отменить] [👁 Детали]

Таб «Ресурсы»:
  Карточки беседок (grid 3):
    Фото + название + статус toggle (вкл/выкл)
    Кнопки: [Редактировать] [Управление слотами]
```

---

### 8.9 ADMIN КАФЕ (/admin/cafe)

```
Два таба: [Меню] [Заказы]

Таб «Меню»:
  Кнопка [+ Добавить позицию]
  Фильтр по категориям (pills)
  Таблица: Фото | Название | Категория | Цена | Доступность | Действия

Таб «Заказы»:
  Фильтр: [Новые] [Готовятся] [Готовы] [Доставлены]
  Kanban-колонки ИЛИ таблица с pipeline:
    NEW → PREPARING → READY → DELIVERED
  Карточка заказа:
    #018 · Офис 301 · Александр
    Пицца Маргарита × 1, Кофе × 2
    ₽ 980
    [→ Готовится]  (кнопка перевода статуса)
```

---

### 8.10 ADMIN MONITORING (/admin/monitoring)

```
Header: «Мониторинг системы»

Health Status: большой индикатор
  🟢 «Все системы работают нормально»  ИЛИ
  🔴 «Обнаружены проблемы»

Grid 3: PostgreSQL / Redis / App
  Каждый: статус + latency + last check

Последние события (SystemEvent):
  Лента: [CRITICAL/ERROR/WARNING/INFO] badge + source + message + time
  Фильтр по уровню

Аптайм-график (упрощённый):
  7-дневный баChart или sparkline: зелёный/красный по дням
```

---

### 8.11 ЭКРАНЫ АУТЕНТИФИКАЦИИ

#### Страница входа (/auth/signin)

```
Центрированная карточка (max-width: 400px):
  [Логотип]
  «Войти в Деловой Парк»
  
  Telegram-кнопка (primary lg full-width):
    [Telegram иконка] Войти через Telegram
  
  — или —
  
  Email (text input) + кнопка «Получить ссылку»
  
  Внизу: «Нет аккаунта? Зарегистрироваться»
```

#### Success login / Error

```
Success: иконка CheckCircle + «Ссылка отправлена на email»
Error:   Alert danger «Произошла ошибка. Попробуйте снова.»
```

---

## ЧАСТЬ 9. B2B ЭКРАНЫ — АРЕНДА ОФИСОВ (Phase 3)

> Планируются в следующей фазе. Отрисовать как wireframe/concept.

### 9.1 Каталог офисов (/rental)

```
Схема этажей (Floor Plan):
  Интерактивная SVG-схема здания
  Цвета офисов: зелёный (свободен) / красный (занят) / жёлтый (скоро освободится)
  Клик по офису → карточка с деталями

Список офисов (альтернативный вид):
  Таблица: Номер | Площадь | Этаж | Цена/мес | Статус | Действие
```

### 9.2 Admin CRM арендаторов (/admin/rental)

```
Три таба: [Арендаторы] [Договоры] [Счета]

Таб «Договоры»:
  Таблица: Арендатор | Офис | Срок | Статус | Сумма/мес
  Фильтр: [Активные] [Истекают (30 дней)] [Истёкшие]
  
  Истекающий договор:
    Строка с bg warning-50, badge «Истекает 15.06.25»
    Кнопка [Продлить]

Дашборд аренды:
  Выручка за месяц / заполняемость / договоры на продление
```

---

## ЧАСТЬ 10. МОБИЛЬНОЕ ПРИЛОЖЕНИЕ / АДАПТАЦИЯ

> Все страницы адаптируются под 375px (iPhone SE) как минимальный размер.

### Мобильные паттерны

#### Bottom Navigation Bar

```
Высота: 56px + safe-area-bottom
Иконки (md) + labels (text-xxs):
  [🏠 Главная] [📅 Бронирования] [☕ Кафе] [👤 Профиль]
Active: primary-600 icon + label
```

#### Pull-to-refresh

```
Spinner primary-600 + «Обновление...»
```

#### Bottom Sheet

```
Замещает модальные окна на мобайле
Drag handle: 4×32px rounded-full neutral-300
Backdrop: overlay
Высота: авто до 90vh
```

#### Touch targets

```
Минимальный размер: 44×44px для всех интерактивных элементов
```

---

## ЧАСТЬ 11. БРЕНДОВЫЕ ЭЛЕМЕНТЫ ДЛЯ ОТРИСОВКИ

### 11.1 Логотип

**Варианты для отрисовки:**

- [ ] **Горизонтальный:** Символ + «Деловой» (bold) + «Парк» (regular/light)
- [ ] **Вертикальный:** Символ сверху + название снизу
- [ ] **Монограмма:** Только символ (буква «Д» или стилизованная иконка)
- [ ] **Favicon:** 32×32px, 16×16px

**Концепции символа:**
- Геометрическая «Д» в квадрате с rounded corners
- Стилизованный бизнес-парк (здание + дерево + точка)
- Абстрактный гексагон / grid-паттерн

**Цветовые версии:**
- [ ] На белом фоне (основная)
- [ ] На тёмном фоне (reversed)
- [ ] Монохромная (чёрная)
- [ ] Монохромная (белая)
- [ ] На primary-600 фоне

### 11.2 Паттерны и текстуры

- [ ] Dot-grid паттерн (используется как bg-subtle в hero-секциях)
- [ ] Градиентные плашки для hero каждого модуля
- [ ] Декоративные blob/shape для лендинга

### 11.3 Иллюстрации Empty State

- [ ] «Нет бронирований» — иллюстрация с калendarём
- [ ] «Нет заказов» — иллюстрация с тарелкой
- [ ] «Нет офисов» — иллюстрация со зданием
- [ ] «Ошибка» — иллюстрация с облаком
- [ ] «Страница не найдена» (404) — иллюстрация

### 11.4 Аватары и плейсхолдеры

- [ ] Default user avatar (инициалы в круге)
- [ ] Placeholder для фото ресурса (беседка / стол / кафе)
- [ ] Placeholder для фото меню

---

## ЧАСТЬ 12. ЧЕКЛИСТ ДЛЯ ДИЗАЙНЕРА

### Figma-файл: структура

```
├── 🎨 Brand (Tokens)
│   ├── Colors
│   ├── Typography
│   ├── Spacing & Grid
│   ├── Shadows & Radius
│   └── Icons Glossary
│
├── 🧩 Components
│   ├── Buttons (7 variants × 5 sizes × 6 states)
│   ├── Inputs (8 types × 7 states)
│   ├── Cards (6 variants × 3 states)
│   ├── Badges & Status (14 statuses)
│   ├── Tables
│   ├── Navigation (Header / Sidebar / Breadcrumb)
│   ├── Modals & Dialogs
│   ├── Toast Notifications
│   └── Loading States
│
├── 📱 Screens — Public (B2C)
│   ├── Home — Desktop + Mobile
│   ├── Gazebos — Desktop + Mobile
│   ├── PS Park — Desktop + Mobile
│   ├── Cafe — Desktop + Mobile (menu + cart)
│   ├── Parking — Desktop + Mobile
│   └── User Dashboard — Desktop + Mobile
│
├── 🏢 Screens — Admin
│   ├── Dashboard
│   ├── Gazebos Manager
│   ├── PS Park Manager
│   ├── Cafe Manager (Menu + Orders Kanban)
│   ├── Users Management
│   ├── Module Registry
│   └── Monitoring
│
├── 🏗 Screens — B2B (Concept/Wireframe)
│   ├── Rental Catalog (Floor Plan)
│   └── Admin CRM (Tenants + Contracts)
│
├── 📐 Flows
│   ├── Booking Flow (4 steps) — Gazebo
│   ├── Booking Flow — PS Park
│   ├── Order Flow — Cafe (Add to cart → Checkout)
│   └── Auth Flow (Sign In → Email / Telegram)
│
└── 📏 Style Guide (PDF export)
    ├── Brand Manifesto
    ├── Color Swatches
    ├── Type Specimen
    └── Component Overview
```

### Приоритет отрисовки

| Приоритет | Элементы |
|-----------|---------|
| **P0 — Срочно** | Логотип, цветовая палитра, типографика, кнопки, инпуты, карточки, бейджи |
| **P1 — Высокий** | Главная страница, беседки, кафе, auth, личный кабинет |
| **P2 — Средний** | PS Park, парковка, admin dashboard, admin беседки, admin кафе |
| **P3 — Нормальный** | Мониторинг, пользователи, модули, все mobile-версии |
| **P4 — Низкий** | B2B rental (concept), иллюстрации, паттерны |

### Форматы сдачи

- Figma-файл с компонентами и Auto Layout
- Design Tokens в JSON (для разработчика)
- Набор иконок SVG (экспорт)
- Логотип в SVG + PNG (2×, 3×)
- PDF Style Guide

---

## ПРИЛОЖЕНИЕ А. СУЩЕСТВУЮЩИЙ КОД — СПРАВОЧНИК ДЛЯ ДИЗАЙНЕРА

> Дизайнер может изучить эти файлы, чтобы понять текущую реализацию.

| Файл | Что там |
|------|---------|
| `src/components/ui/button.tsx` | Кнопки: primary/secondary/danger/ghost, sm/md/lg |
| `src/components/ui/card.tsx` | Базовая карточка с header/content |
| `src/components/ui/badge.tsx` | Статусные бейджи |
| `src/components/admin/sidebar.tsx` | Сайдбар админки |
| `src/app/globals.css` | CSS-переменные (пока минимальны) |
| `src/app/page.tsx` | Главная страница |
| `src/app/(public)/gazebos/page.tsx` | Страница беседок |
| `src/app/(public)/cafe/page.tsx` | Страница кафе |
| `src/app/admin/dashboard/page.tsx` | Дашборд администратора |

**Стек:** Next.js 15, React 19, Tailwind CSS v4, TypeScript

---

*Документ подготовлен на основе архитектуры платформы Деловой Парк. Версия 1.0 · Апрель 2025*

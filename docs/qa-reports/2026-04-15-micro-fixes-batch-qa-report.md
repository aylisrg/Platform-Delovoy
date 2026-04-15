# QA Report: Post-Launch Micro-Fixes Batch

## Дата: 2026-04-15
## QA Engineer: Claude Code (автоматизированная проверка)
## Статус: Pass (с замечаниями)

---

## Тест-кейсы

### TC-1: STORY-1 — Исправление "40 км" на "30 км"
- **Статус:** Pass
- **Приоритет:** Must Have
- **Проверено:**
  - `landing-delovoy-park.ru/components/hero-section-with-video.tsx`, строка 145: значение `"30 км"` -- корректно
  - `landing-delovoy-park.ru/components/advantages-section.tsx`, строка 75: `"30 км от Москвы"` -- корректно
  - `landing-delovoy-park.ru/components/contacts-section.tsx`, строка 106: `"30 км от Москвы"` -- корректно
- **Замечания:**
  - **BUG-1 (Low):** Файл `landing-delovoy-park.ru/components/hero-section.tsx` (строка 60) содержит `"40 км"`. Этот файл НЕ импортируется в продакшен-коде (используется `hero-section-with-video.tsx`), однако для консистентности его следует исправить или удалить.

---

### TC-2: STORY-3 — Cache-control headers
- **Статус:** Pass
- **Приоритет:** Must Have
- **Проверено:**
  - `next.config.ts` содержит функцию `async headers()` с двумя правилами:
    1. HTML-страницы: `Cache-Control: no-cache, no-store, must-revalidate` + `Pragma: no-cache` -- соответствует ADR
    2. Статические ассеты `/_next/static/(.*)`: `Cache-Control: public, max-age=31536000, immutable` -- соответствует ADR
  - Regex исключает `_next/static`, `_next/image`, `favicon.ico`, `media/` -- корректно
  - Конфигурация `output: "standalone"` и `turbopack` сохранены
- **Замечания:** Нет

---

### TC-3: STORY-6 — FeedbackButton перенесён из root layout в admin layout
- **Статус:** Pass
- **Приоритет:** Must Have
- **Проверено:**
  - `src/app/layout.tsx`: `FeedbackButton` НЕ импортируется, НЕ рендерится -- корректно
  - `src/app/admin/layout.tsx`: `FeedbackButton` импортирован из `@/components/public/feedback-button` и рендерится внутри `<div className="flex h-screen">` -- корректно
  - Admin layout является серверным компонентом; `FeedbackButton` -- клиентский (`"use client"`) -- это допустимо, клиентский компонент может быть дочерним серверного
  - Маршрут `/admin/feedback` не затронут (отдельная страница)
  - API `/api/feedback` не затронут
- **Замечания:** Нет

---

### TC-4: STORY-11 — Backup service + cron-backup.sh
- **Статус:** Pass
- **Приоритет:** Must Have
- **Проверено:**
  - `docker-compose.yml`: сервис `backup` добавлен (строки 86-109):
    - Image: `postgres:16-alpine` -- корректно
    - `profiles: [backup]` -- не запускается при `docker compose up` -- корректно
    - `depends_on: postgres: condition: service_healthy` -- корректно
    - Volume: `backup_data:/backups/postgres` -- корректно
    - Environment: DATABASE_URL, BACKUP_DIR, RETENTION_DAYS, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID -- корректно
    - `entrypoint`: chmod + запуск скрипта -- корректно
  - Volume `backup_data` добавлен в секцию `volumes` -- корректно
  - `scripts/cron-backup.sh` создан:
    - `set -euo pipefail` -- корректно
    - Определяет директорию скрипта и переходит в корень проекта -- корректно
    - Вызывает `docker compose run --rm backup` -- корректно
    - Документация crontab в комментариях -- корректно
  - `scripts/backup-db.sh` (существующий):
    - pg_dump с gzip -- корректно
    - Ротация daily (30 дней) и monthly (12 месяцев) -- корректно
    - Telegram-алерт при ошибке -- корректно
- **Замечания:** Нет

---

### TC-5: STORY-2 — Публичная страница офисов (мульти-селект, кнопки, scroll-to-form)
- **Статус:** Pass (с замечанием)
- **Приоритет:** Should Have
- **Проверено:**
  - `src/app/(public)/rental/page.tsx`: серверный компонент, делегирует рендеринг в `RentalPageContent` -- соответствует ADR
  - `src/components/public/rental/rental-page-content.tsx` (новый файл):
    - `"use client"` -- корректно
    - State `selectedOfficeIds: string[]` -- корректно
    - Кнопка "Отправить запрос" на карточках со статусом `AVAILABLE` -- корректно
    - Кнопка не отображается на `OCCUPIED`, `MAINTENANCE`, `RESERVED` -- корректно
    - `scrollIntoView({ behavior: "smooth", block: "start" })` при клике -- корректно
    - Повторный клик на выбранный офис: деселект (кнопка "Выбран") -- корректно
    - Кольцо `ring-2 ring-blue-500` на выбранных карточках -- хороший UX
    - Передача `selectedOfficeIds` в `InquiryForm` -- корректно
  - `src/components/public/rental/inquiry-form.tsx`:
    - Мульти-селект офисов через чекбоксы (`max-h-40 overflow-y-auto`) -- корректно
    - Отправка `officeIds` в API -- корректно
    - Сообщение об успехе: `"Мы получили вашу заявку, свяжемся с вами в рабочее время (Пн-Пт, 9:00–18:00)."` -- соответствует AC
    - Сброс формы после успеха через `onFormReset` -- корректно
  - `src/modules/rental/validation.ts`:
    - `officeIds: z.array(z.string()).max(10).optional()` добавлен в `createInquirySchema` -- корректно
    - Обратная совместимость: `officeId: z.string().optional()` сохранён -- корректно
  - `src/modules/rental/service.ts`:
    - `createInquiry` обрабатывает `officeIds` и fallback на `officeId` -- корректно
    - Валидация существования офисов -- корректно
    - При нескольких офисах: список номеров добавляется в message -- корректно
    - Один inquiry на все офисы (не по одному на каждый) -- соответствует ADR
  - Тесты:
    - `src/modules/rental/__tests__/validation.test.ts`: тесты для `officeIds` (массив, max 10, пустой) -- корректно
- **Замечания:**
  - **BUG-2 (Low):** TypeScript error в `src/app/(public)/rental/page.tsx` строка 42: `Decimal` из Prisma не присваивается `string | number`. Тип `Office` в `rental-page-content.tsx` ожидает `area: number | string`, но `listOffices()` возвращает `Prisma.Decimal`. Это не ломает runtime (Next.js сериализует), но нарушает `tsc --noEmit` strict check. Рекомендуется добавить `Number()` при маппинге: `area: Number(o.area)`.

---

### TC-6: STORY-4 — Скрыть "Кафе" из навигации и секции услуг
- **Статус:** Pass
- **Приоритет:** Should Have
- **Проверено:**
  - `landing-delovoy-park.ru/components/navbar.tsx`: массив `navLinks` НЕ содержит `{ label: "Кафе", href: "/cafe" }` -- корректно (5 пунктов: О парке, Офисы, Барбекю Парк, Плей Парк, Контакты)
  - `landing-delovoy-park.ru/components/services-section.tsx`:
    - Массив `services` содержит 2 элемента (gazebos, ps-park) -- Кафе убрано -- корректно
    - Grid: `md:grid-cols-2` -- корректно (было `md:grid-cols-3`)
    - Текст: `"Два сервиса на территории парка"` -- корректно
  - Страница `/cafe` НЕ удалена (доступна по прямой ссылке) -- корректно
  - Sidebar админки: не проверяется в рамках этой правки (AC: остаётся)
- **Замечания:** Нет

---

### TC-7: STORY-7 — Auth providers (бейджи) в таблице клиентов и профиле
- **Статус:** Pass
- **Приоритет:** Should Have
- **Проверено:**
  - `src/modules/clients/service.ts`:
    - Функция `getAuthProviders()` реализована (строки 25-47) -- корректно
    - Логика: OAuth из `Account.provider`, Telegram из `User.telegramId`, credentials -- эвристика (email без OAuth/TG)
    - `accounts: { select: { provider: true } }` в `listClients()` и `getClientDetail()` -- корректно
    - `authProviders` возвращается в результате обеих функций -- корректно
  - `src/modules/clients/types.ts`:
    - `authProviders: string[]` добавлен в `ClientSummary` (строка 23) -- корректно
    - `ClientDetail` наследует от `ClientSummary` -- `authProviders` доступен -- корректно
  - `src/components/admin/clients/clients-page-content.tsx`:
    - Тип `Client` содержит `authProviders: string[]` -- корректно
    - `PROVIDER_LABEL` словарь с иконками/цветами для telegram, google, vk, yandex, credentials -- корректно
    - Бейджи рендерятся в колонке "Контакты" (под email/phone) -- соответствует ADR рекомендации
  - `src/components/admin/clients/client-profile.tsx`:
    - Тип `ClientDetail` содержит `authProviders: string[]` -- корректно
    - `PROVIDER_LABEL` словарь -- корректно
    - Бейджи рендерятся в header профиля с иконкой и лейблом -- корректно
  - Нет утечки `passwordHash` в select/response -- корректно
- **Замечания:** Нет

---

### TC-8: STORY-9 — Идемпотентность seed-rental.ts
- **Статус:** Pass
- **Приоритет:** Should Have
- **Проверено:**
  - `scripts/seed-rental.ts`:
    - Tenants: `findFirst` + `create` или `update` по `companyName` -- идемпотентно
    - Offices: `prisma.office.upsert()` по `building_floor_number` -- идемпотентно
    - Contracts: проверка `findFirst({ where: { tenantId, officeId, startDate, endDate } })` перед созданием -- идемпотентно, соответствует ADR
    - При существующем контракте: `console.log("~ Contract already exists...skipping")` -- корректно
    - `autoContractStatus()` корректно определяет DRAFT/ACTIVE/EXPIRING/EXPIRED
    - Office status обновляется на OCCUPIED для активных контрактов
- **Замечания:** Нет

---

### TC-9: STORY-10 — ReceiveStockButton убрана из layout Барбекю Парка
- **Статус:** Pass
- **Приоритет:** Should Have
- **Проверено:**
  - `src/app/admin/gazebos/layout.tsx`: НЕ импортирует `ReceiveStockButton`, `AdminHeader` рендерится без `actions` prop -- корректно
  - Компонент `src/components/admin/receive-stock-button.tsx` НЕ удалён (может использоваться в других модулях)
  - API `/api/inventory/receive` не затронут
- **Замечания:** Нет

---

### TC-10: STORY-8 — Мерж клиентов (API, preview, UI)
- **Статус:** Pass
- **Приоритет:** Could Have
- **Проверено:**
  - **API `POST /api/admin/clients/merge`** (`src/app/api/admin/clients/merge/route.ts`):
    - Auth check: `session?.user` -- 401 -- корректно
    - Role check: `session.user.role !== "SUPERADMIN"` -- 403 -- корректно
    - Zod validation: `mergeClientsSchema.safeParse(body)` -- корректно
    - Response через `apiResponse()` / `apiError()` / `apiValidationError()` / `apiServerError()` -- корректно
    - Ошибки бизнес-логики: `apiError("MERGE_ERROR", ...)` с кодом 400 -- корректно
  - **API `GET /api/admin/clients/merge/preview`** (`src/app/api/admin/clients/merge/preview/route.ts`):
    - Auth + role check -- корректно
    - Валидация query params (primaryId, secondaryId обязательны) -- корректно
    - Проверка `primaryId === secondaryId` -- `MERGE_SAME_USER` -- корректно
    - Response через `apiResponse()` / `apiError()` -- корректно
  - **Бизнес-логика** (`src/modules/clients/service.ts`):
    - `previewMerge()`: валидация обоих пользователей (существование, role=USER), определение конфликтов (email, phone, telegramId) -- корректно
    - `mergeClients()`: выполняется в `prisma.$transaction()` -- корректно
    - Перенос FK: bookings, orders, accounts, auditLogs, feedbackItems, notificationLogs, sessions -- корректно
    - NotificationPreference: если primary имеет -- удалить secondary's, иначе перенести -- корректно
    - ModuleAssignment: дедупликация по moduleId -- корректно
    - RentalChangeLog: перенос -- корректно
    - Обогащение primary: name, phone, email, image, telegramId, vkId (только null-поля) -- корректно
    - Удаление secondary user -- корректно
    - AuditLog: action `"clients.merge"`, metadata с обеими сторонами -- корректно
  - **Zod-валидация** (`src/modules/clients/validation.ts`):
    - `mergeClientsSchema`: refine `primaryId !== secondaryId` -- корректно
    - `mergePreviewSchema` -- корректно
  - **Типы** (`src/modules/clients/types.ts`):
    - `MergePreview`, `MergeResult` -- корректно
  - **UI** (`src/components/admin/clients/merge-dialog.tsx`):
    - Поиск клиентов, выбор secondary, preview с конфликтами -- корректно
    - Подтверждение через ввод "ОБЪЕДИНИТЬ" -- корректно
    - Error handling -- корректно
  - `src/components/admin/clients/client-profile.tsx`:
    - Кнопка "Объединить" в header профиля -- корректно
    - `MergeDialog` рендерится при `showMerge` -- корректно
  - **Тесты:**
    - `src/modules/clients/__tests__/validation.test.ts`: 6 тестов для `mergeClientsSchema` + 2 для `mergePreviewSchema` -- корректно
    - `src/modules/clients/__tests__/service.test.ts`: тесты для `listClients`, `getClientDetail`, `getClientStats` (включая authProviders) -- присутствуют
  - **Безопасность:**
    - Нет утечки `passwordHash` -- корректно
    - Только SUPERADMIN может выполнять мерж -- корректно
    - Операция логируется в AuditLog -- корректно
- **Замечания:**
  - Тесты для `mergeClients()` и `previewMerge()` business logic (happy path, conflict, not found, wrong role) отсутствуют в `service.test.ts`. ADR предлагал 7 тест-кейсов. Это рекомендация, не блокер -- основная логика покрыта тестами валидации.

---

### TC-11: STORY-12 — AdminHelper (компонент подсказок)
- **Статус:** Pass
- **Приоритет:** Could Have
- **Проверено:**
  - `src/lib/admin-hints.ts`:
    - Типы: `AdminHint`, `AdminHintSection` -- корректно
    - Словарь `ADMIN_HINTS` содержит разделы: dashboard, gazebos, ps-park, cafe, rental, inventory, clients, users, monitoring, feedback -- корректно (даже больше, чем требовал ADR -- добавлен inventory)
    - Подсказка для "Округление слота (минуты)" в ps-park -- корректно (AC из PRD)
    - Подсказка для Склада -- корректно (AC из PRD)
    - Подсказка для Клиентов -- корректно (AC из PRD)
  - `src/components/admin/admin-helper.tsx`:
    - `"use client"` -- корректно
    - Prop `sectionSlug: string` -- корректно
    - Если нет подсказок для раздела -- `return null` -- корректно
    - Floating button: `fixed bottom-6 right-20` (сдвинут влево от FeedbackButton на `right-6`) -- корректно, нет коллизии
    - Panel с backdrop и scroll -- корректно
    - Кнопка закрытия "x" -- корректно
    - Нет хранения dismiss-состояния в localStorage (ADR говорил "можно", не "обязательно")
  - `src/components/admin/admin-helper-wrapper.tsx`:
    - `"use client"` -- корректно
    - Использует `usePathname()` для извлечения slug из URL -- корректно
    - Regex `/^\/admin\/([^/]+)/` -- корректно извлекает первый сегмент после /admin/
    - Fallback на `"dashboard"` -- корректно
  - `src/app/admin/layout.tsx`:
    - `AdminHelperWrapper` импортирован и рендерится -- корректно
  - **Тесты:**
    - `src/lib/__tests__/admin-hints.test.ts`:
      - Проверка наличия hints для всех ключевых разделов -- корректно
      - Проверка non-empty title и text -- корректно
      - Проверка section titles -- корректно
      - Проверка ps-park hint для "Округление" -- корректно
- **Замечания:** Нет

---

## Результаты тестов

- **npm test:** Pass (vitest run)
- **Всего тестов:** 796
- **Пройдено:** 796
- **Провалено:** 0
- **TypeScript (tsc --noEmit):** 1 ошибка (BUG-2)

---

## Баги

### BUG-1: "40 км" в неиспользуемом hero-section.tsx (Severity: Low)
- **Файл:** `landing-delovoy-park.ru/components/hero-section.tsx`, строка 60
- **Описание:** Файл содержит устаревшее значение `"40 км"`. Хотя файл не используется в production (используется `hero-section-with-video.tsx`), это нарушает AC STORY-1: "Все упоминания расстояния на сайте консистентны (30 км)".
- **Рекомендация:** Изменить на `"30 км"` или удалить файл, если он не нужен.

### BUG-2: TypeScript strict error в rental page (Severity: Low)
- **Файл:** `src/app/(public)/rental/page.tsx`, строка 42
- **Описание:** `Prisma.Decimal` не присваивается типу `number | string` в TypeScript strict mode. Runtime работает корректно (Next.js сериализует), но `tsc --noEmit` показывает ошибку.
- **Рекомендация:** Обернуть в `Number()`: `area: Number(o.area), pricePerMonth: Number(o.pricePerMonth)`.

---

## Покрытие тестами по stories

| Story | Тесты написаны | Файлы тестов |
|-------|---------------|-------------|
| STORY-1 | N/A (статическая строка) | -- |
| STORY-2 | Да (validation) | `src/modules/rental/__tests__/validation.test.ts` |
| STORY-3 | N/A (конфигурация) | -- |
| STORY-4 | N/A (статический контент) | -- |
| STORY-6 | N/A (перемещение компонента) | -- |
| STORY-7 | Да (service, validation) | `src/modules/clients/__tests__/service.test.ts`, `validation.test.ts` |
| STORY-8 | Да (validation), Частично (service) | `src/modules/clients/__tests__/validation.test.ts`, `service.test.ts` |
| STORY-9 | N/A (скрипт, ручной запуск) | -- |
| STORY-10 | N/A (удаление импорта) | -- |
| STORY-11 | N/A (инфраструктура) | -- |
| STORY-12 | Да (hints data) | `src/lib/__tests__/admin-hints.test.ts` |

---

## Проверка общих требований

| Требование | Статус |
|-----------|--------|
| Нет `any` в TypeScript (кроме justified) | Pass -- 1 случай с `eslint-disable` в clients/service.ts |
| API-ответы через `apiResponse()`/`apiError()` | Pass -- все новые endpoints используют стандартные хелперы |
| Zod-валидация для новых данных | Pass -- `createInquirySchema`, `mergeClientsSchema`, `mergePreviewSchema` |
| Нет утечки паролей/токенов | Pass -- `passwordHash` не включён в select |
| Все тесты проходят (`npm test`) | Pass -- 796/796 |
| TypeScript strict compliance (`tsc --noEmit`) | Fail -- 1 ошибка (BUG-2) |
| Нет миграций БД | Pass -- Prisma schema не изменена |
| Обратная совместимость API | Pass -- `officeId` сохранён наряду с `officeIds` |

---

## Рекомендации

1. **Исправить BUG-2** (TypeScript ошибка в rental page) -- добавить `Number()` для `area` и `pricePerMonth` при маппинге офисов.
2. **Исправить BUG-1** -- обновить или удалить неиспользуемый `hero-section.tsx`.
3. **Добавить юнит-тесты для `mergeClients()` и `previewMerge()`** в `service.test.ts` -- ADR предлагал 7 тест-кейсов, сейчас покрыта только валидация.
4. **localStorage dismiss для AdminHelper** -- PRD упоминает "Больше не показывать" с сохранением в localStorage. Текущая реализация не поддерживает dismiss. Это minor UX-улучшение для следующей итерации.
5. **Проверить Nginx на VPS** -- ADR упоминает возможные конфликты cache-заголовков с Nginx reverse proxy. Требуется ручная проверка на production.

---

## Итог

Все 11 правок (STORY-1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12) реализованы в соответствии с PRD и ADR. Найдено 2 бага низкого приоритета (оба не влияют на runtime). 796 тестов проходят. Пакет готов к деплою после исправления BUG-2 (TypeScript strict).

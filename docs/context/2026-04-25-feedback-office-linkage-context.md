# Context Log: feedback-office-linkage

**RUN_ID:** 2026-04-25-feedback-office-linkage
**Started:** 2026-04-25
**Branch:** claude/refactor-codebase-quality-Iv47v (продолжаем эту же ветку — рефакторинг ещё не смержен)

## Задача (от CTO)

Владелец сказал: «В обращениях надо бы номер офиса прописать, какой арендую. Предусмотри, что надо будет позже сделать железную связку с реестром офисов, и в UI предусмотреть удобный инструмент!»

Это две связанные задачи:
1. **Сейчас:** позволить юзеру указать офис при создании обращения; показывать его в дашборде USER и в админке.
2. **Позже:** автоподстановка офиса из активного `RentalContract` пользователя — это **не часть данной итерации**, но текущая архитектура должна это поддерживать без миграции.

## Стартовая позиция в коде

**Schema (`prisma/schema.prisma`):**
- `model FeedbackItem` (строка ~656): `userId, type, description, screenshotPath, pageUrl, isUrgent, status, createdAt, updatedAt`. **Поля офиса нет.**
- `model Office`: `id, number, floor, building, officeType, area, pricePerMonth, status...`. Есть `@@unique([building, floor, number])`.
- `RentalContract`, `RentalInquiry`, `RentalDeal` уже имеют `officeId String?` + relation на Office.

**UI:**
- Форма обращения — `src/components/public/feedback-button.tsx` (модалка с FormData POST на `/api/feedback`).
- Дашборд — секция "Мои обращения" в `src/app/(public)/dashboard/page.tsx` (строки ~284-336).
- Админка — `src/app/admin/feedback/page.tsx` + `src/app/admin/feedback/[id]/page.tsx`.

**API:**
- POST `/api/feedback` — приём. Принимает FormData.
- Существует API офисов для админки/витрины аренды — нужно проверить, подходит ли он для autocomplete или нужен отдельный endpoint.

## Стадии pipeline

- [x] Stage 0 (CTO): context-log + аудит кода
- [x] Stage 1 (PO): PRD
- [x] Stage 2 (Architect): ADR (миграция + combobox API)
- [x] Stage 3 (Dev): миграция + API + form + dashboard + admin + tests
- [x] Stage 4 (Reviewer): NEEDS_CHANGES → исправлено CTO (см. секцию "Stage 4 follow-up")
- [ ] Stage 5 (QA): функциональная проверка

## Stage 4 follow-up — CTO fixes after Reviewer

Reviewer (`docs/qa-reports/2026-04-25-feedback-office-linkage-review.md`) выдал
**NEEDS_CHANGES**. Корень: между PRD и ADR было расхождение по фильтру статусов
офисов в combobox — PRD PO Decision 4 говорит "скрываем `MAINTENANCE` И `RESERVED`",
ADR §2 включил `RESERVED` в список разрешённых. Senior Dev следовал ADR. PRD главнее.

**Исправлено в follow-up коммите:**

1. `src/modules/rental/service.ts` — `searchOffices` фильтрует только `AVAILABLE`
   и `OCCUPIED`. RESERVED исключён.
2. `src/modules/rental/__tests__/service.test.ts` — тест переписан под новый
   фильтр (`{ in: ["AVAILABLE", "OCCUPIED"] }` + явный `not.toContain("RESERVED")`).
3. `src/components/ui/office-combobox.tsx` — `OfficeOption.status` сужен до
   `"AVAILABLE" | "OCCUPIED"`, ключ `RESERVED` удалён из `STATUS_LABEL`.

**Решение CTO по RTL-тестам combobox (ADR §7 п.4):**

ADR требовал три RTL-теста — debounce, selection, clear. Senior Dev пропустил
их, поскольку `@testing-library/react` и `jsdom` не установлены в репозитории.
Reviewer пометил как "ЖЕЛАТЕЛЬНО".

**Принято CTO: пропуск допустим в текущей итерации**, потому что:
- Подтяжка `jsdom` + `@testing-library/react` ради одного компонента — отдельная
  toolchain-задача, несоразмерная этой фиче.
- Серверная логика (фильтр статусов, RBAC, FK constraint) полностью покрыта
  юнит/integration-тестами.
- Поведение combobox в production будет проверено вручную в Stage 5 / на staging.

Зафиксировано как **техдолг**: следующий feature pipeline с интерактивным UI
должен поднять RTL-инфру как отдельную задачу в backlog.

## Антипаттерны прошлых прогонов (для всех агентов)

- Scope creep: только эта фича, не «за компанию» переделывать форму обращения целиком.
- Schema-миграции — только через ADR. Нельзя ничего изменить в `prisma/schema.prisma` без согласованного решения.
- Новые модули в `src/modules/` — нет необходимости. Используем существующий `feedback`.
- `redirectAfterLogin` ADMIN dead-code — НЕ исправляем тут (отдельная задача, отмечена как pre-existing observation в QA-репорте предыдущего pipeline).

---

## PO — Ключевые решения

**Дата:** 2026-04-25
**Артефакт:** `docs/requirements/2026-04-25-feedback-office-linkage.md`

### Решение 1: FK, не строка — принципиальная позиция

Связка с офисом реализуется через `Office.id` (FK), а не через свободный текст. Это означает одну Prisma-миграцию: добавление опционального поля `officeId String?` с relation на `Office`. Существующие записи остаются с NULL — никакого data backfill не требуется.

**Обоснование:** свободный текст порождает варианты написания ("А-12", "а12", "корп. 1 оф. 12"), которые невозможно сопоставить с реестром ретроспективно. FK — единственный способ обеспечить качество данных для будущей аналитики и автоподстановки.

### Решение 2: Поле необязательно, без условной логики по роли

Поле офиса необязательно для всех пользователей. Нет проверки "арендатор ли ты" при показе поля. Гость видит то же поле — может заполнить или пропустить.

**Обоснование:** упрощает реализацию; разделение "арендатор vs гость" на уровне формы требует запроса к `RentalContract` при открытии формы — это сложность Phase 5.1 (автоподстановка). Сейчас — не делаем.

### Решение 3: Combobox, не свободный ввод

Для выбора офиса используется combobox с поиском по реестру, а не текстовое поле. Пользователь не может ввести произвольную строку и "сохранить" её как офис.

**Обоснование:** если оставить свободный ввод — FK теряет смысл. Combobox — единственный UI-паттерн, совместимый с FK-архитектурой.

### Решение 4: Статусы MAINTENANCE и RESERVED скрыты из combobox

Combobox показывает только офисы со статусом AVAILABLE и OCCUPIED. MAINTENANCE и RESERVED не отображаются.

**Обоснование:** офисы на обслуживании или зарезервированы для внутренних целей — не релевантны для арендатора при отправке обращения. Показывать статус AVAILABLE/OCCUPIED полезно, чтобы пользователь видел, что реестр актуальный.

### Решение 5: Отображение офиса — плашка, не отдельная секция

Офис отображается как компактная плашка ("Корп. N, эт. K, оф. NNN") в строке с типом и статусом обращения — и в дашборде, и в детальной карточке админки. Отсутствие офиса = отсутствие плашки, никакого placeholder-текста.

**Обоснование:** минимальное вмешательство в существующую вёрстку. Placeholder "Офис не указан" засорил бы UI для обращений от гостей.

### Решение 6: Combobox — debounce 200 мс, лимит 10 результатов, кэш в памяти

API поиска офисов вызывается с задержкой 200 мс после ввода и возвращает не более 10 результатов. Кэш результатов хранится в памяти компонента на время жизни формы.

**Обоснование:** debounce предотвращает избыточные запросы при быстрой печати. Лимит 10 покрывает 90%+ сценариев (в парке не сотни одинаковых номеров). Кэш снижает нагрузку при повторных запросах одних и тех же символов.

### Решение 7: Автоподстановка из RentalContract — явно вне скоупа

Автоподстановка офиса для авторизованного арендатора из его активного договора не входит в данную итерацию. Решение по FK обеспечивает возможность реализовать это в Phase 5.1 без новой миграции.

### Зависимости для Architect

- Миграция: 1 поле в `FeedbackItem` (`officeId String?`, FK на `Office`).
- API поиска офисов: доступен для роли USER, возвращает `id, number, floor, building, status`, исключает MAINTENANCE и RESERVED. Architect выбирает: новый endpoint или параметр к существующему.
- `POST /api/feedback`: принимает опциональный `officeId`, валидирует существование записи Office перед сохранением.
- Тесты: юнит-тесты для новой логики в `src/modules/feedback/service.ts` с моком БД.

---

## Architect — Ключевые решения

**Дата:** 2026-04-25
**Артефакт:** `docs/architecture/2026-04-25-feedback-office-linkage-adr.md`

1. **Schema:** `FeedbackItem.officeId String?` + nullable relation на `Office`, `@@index([officeId])`. Обратная relation `feedbackItems` в `Office` обязательна. Миграция `feedback_office_linkage` (ADD COLUMN + CREATE INDEX, без backfill).
2. **API autocomplete — отдельный endpoint:** `GET /api/rental/offices/search?q=...`. Существующий `/api/rental/offices` закрыт для USER и течёт `pricePerMonth` — не годится. Новый возвращает только `{ id, number, building, floor, status }`, лимит 10, статусы только `AVAILABLE`/`OCCUPIED` (PO Decision 4 — RESERVED тоже скрыт).
3. **RBAC:** новый search доступен любому авторизованному (USER/MANAGER/SUPERADMIN), без `hasModuleAccess`. Гость → 401. Rate limit для MVP не вводим.
4. **POST /api/feedback:** опциональный `officeId` (CUID, пустая строка → undefined через preprocess). Explicit `prisma.office.findUnique` перед сохранением — даёт 422 "Указанный офис не найден" вместо 500/P2003.
5. **UI:** новый общий компонент `src/components/ui/office-combobox.tsx` без shadcn/ui — input + dropdown + debounce 200мс + AbortController. Клавиатурная навигация ↑/↓/Enter/Esc, кнопка ✕ для очистки, empty state "Ничего не найдено".
6. **Render:** в dashboard и admin detail — Prisma `include: { office: { select: ... } }` + условная плашка "Корп. N, эт. K, оф. NNN" (zinc-100/zinc-700).
7. **Out of scope:** autoload из `RentalContract`, колонка "офис" в списке `/admin/feedback`, изменения существующего `/api/rental/offices`, новый модуль в `src/modules/`.

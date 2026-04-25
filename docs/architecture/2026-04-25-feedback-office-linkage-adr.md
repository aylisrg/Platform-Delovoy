# ADR: Привязка офиса к обращению (feedback-office-linkage)

**RUN_ID:** 2026-04-25-feedback-office-linkage
**Дата:** 2026-04-25
**Статус:** Принят
**PRD:** `docs/requirements/2026-04-25-feedback-office-linkage-prd.md`

---

## 1. Схема БД

Миграция Prisma: **`feedback_office_linkage`**.

В `model FeedbackItem` (`prisma/schema.prisma`, ~1185) добавить:

```prisma
officeId  String?
office    Office?  @relation(fields: [officeId], references: [id])

@@index([officeId])
```

В `model Office` (`prisma/schema.prisma`, ~334) добавить обратную relation:

```prisma
feedbackItems FeedbackItem[]
```

**Решения:**
- `officeId` nullable — backward compatibility, существующие записи остаются с NULL.
- `onDelete` не указываем (Prisma default для опциональной FK = `SetNull` на стороне БД при PostgreSQL+Prisma — корректно). Жёстких удалений `Office` в коде нет; если появится — обращение не должно ронять.
- `@@index([officeId])` — **нужен**: будущая аналитика "обращения по офису" (Phase 5.3) и JOIN-ы при выборках админа. Низкая стоимость.
- Обратная relation в `Office` — **обязательна** (Prisma требует двустороннюю relation).

Миграция тривиальная (ADD COLUMN nullable + CREATE INDEX), без data backfill.

---

## 2. API для autocomplete офисов

**Существующий `GET /api/rental/offices` НЕ подходит** — закрыт для USER (`MANAGER`/`SUPERADMIN` only, `src/app/api/rental/offices/route.ts:15`). Расширение его доступа сломает RBAC и утечёт финансовые поля (`pricePerMonth`).

**Решение:** новый endpoint **`GET /api/rental/offices/search`** — отдельный, минимальный, любой авторизованный пользователь, только публичные поля.

**Контракт:**

- **Метод:** `GET /api/rental/offices/search?q=<query>`
- **Auth:** требует `auth()` (`USER`/`MANAGER`/`SUPERADMIN`). Гость → 401.
- **Rate limit:** для MVP не вводим. Combobox debounced (200мс), форма скрыта от гостей. Если в проде заметим abuse — sliding window 60/min/user добавить позже.
- **Query params (Zod, `searchOfficeSchema`):**
  - `q: string` — обязателен, `min(1).max(50)`, trim.
- **Логика:**
  - Поиск по `Office.number` через `contains`, `mode: "insensitive"`.
  - Фильтр: `status IN ('AVAILABLE', 'OCCUPIED')` — **исключаем `MAINTENANCE` и `RESERVED`** (соответствует PO Decision 4).
  - `take: 10`, `orderBy: [{ building: 'asc' }, { floor: 'asc' }, { number: 'asc' }]`.
  - `select: { id, number, building, floor, status }` — никаких цен/площадей/комментариев.
- **Response (success):**
  ```json
  { "success": true, "data": [
    { "id": "...", "number": "301", "building": 1, "floor": 3, "status": "AVAILABLE" }
  ]}
  ```
- **Errors:** 401, 422 (пустой/слишком длинный `q`), 500 — стандартные хелперы `apiUnauthorized`/`apiValidationError`/`apiServerError`.
- **Сервис:** новая функция `searchOffices(q)` в `src/modules/rental/service.ts`. Zod-схема `searchOfficeSchema` в `src/modules/rental/validation.ts`.

---

## 3. Изменение POST `/api/feedback`

В `src/modules/feedback/validation.ts` расширить `createFeedbackSchema`:

```ts
officeId: z
  .preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().cuid({ message: "Некорректный идентификатор офиса" }).optional()
  ),
```

В `src/app/api/feedback/route.ts` (POST):
- Извлечь `officeId` из FormData (`formData.get("officeId") as string | null`) и из JSON-варианта (`body.officeId`).
- Передать в `createFeedbackSchema.safeParse({ ..., officeId })`.
- Перед `createFeedback(...)`: если `officeId` передан, сделать `prisma.office.findUnique({ where: { id: officeId }, select: { id: true } })`. Не найдено → `apiValidationError("Указанный офис не найден")` (422). Это даёт понятную 422 вместо 500/P2003 от Prisma.
- Передать `officeId` в `createFeedback(...)`.

В `createFeedback` (`src/modules/feedback/service.ts`): записать `officeId: input.officeId ?? null` в `prisma.feedbackItem.create`. Расширить `CreateFeedbackInput` в `src/modules/feedback/types.ts`.

`AuditLog` для `feedback.create`: опционально добавить `officeId` в metadata — для трассировки.

---

## 4. UI: combobox

**Новый компонент:** `src/components/ui/office-combobox.tsx` (общий, без shadcn/ui).

**Props:**
```ts
type OfficeOption = { id: string; number: string; building: number; floor: number; status: "AVAILABLE" | "OCCUPIED" };

interface OfficeComboboxProps {
  value: OfficeOption | null;
  onChange: (v: OfficeOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
}
```

**Состояние:**
- `query: string`, `results: OfficeOption[]`, `loading: boolean`, `open: boolean`, `activeIndex: number`.
- Debounce 200мс через `useEffect` + `setTimeout`/`clearTimeout` (без внешних либ).
- Запрос: `fetch('/api/rental/offices/search?q=' + encodeURIComponent(query))`, `AbortController` при новом вводе.
- Минимум `query.length >= 1` для запуска.

**UX:**
- `<input>` обычный focus → при вводе показывает `<ul>` дропдаун.
- Каждый item: `Корп. {building}, эт. {floor}, оф. {number}` + статус-чип (`Свободен` / `Занят`).
- Empty state: `"Ничего не найдено"` в дропдауне, без спиннера после загрузки.
- Loading: `"Поиск..."` пока `loading === true`.
- Клавиатура: ↑/↓ меняют `activeIndex`, Enter — выбор, Esc — `setOpen(false)`. Желательно, не блокер.
- При наличии `value` — input показывает строку выбранного офиса + кнопка ✕ внутри (вызывает `onChange(null)` + сброс query).
- a11y: `role="combobox"`, `aria-expanded`, `aria-autocomplete="list"`, listbox/option на результатах.

**Интеграция в `feedback-button.tsx`:**
- `const [office, setOffice] = useState<OfficeOption | null>(null)`.
- `<OfficeCombobox value={office} onChange={setOffice} disabled={isSubmitting} />` — после type-селектора, перед description (Senior Dev адаптирует).
- В `handleSubmit`: `if (office) formData.append("officeId", office.id);`.
- В сбросе формы: `setOffice(null)`.

---

## 5. Дашборд `/dashboard` — секция "Мои обращения"

Файл: `src/app/(public)/dashboard/page.tsx` (~284-336).

**Запрос:** в текущем `prisma.feedbackItem.findMany({ where: { userId } })` добавить:
```ts
include: { office: { select: { id: true, number: true, floor: true, building: true } } }
```

**Рендер:** в карточке обращения, после badges типа/срочности (или новой строкой над `<p>` описания):
```tsx
{fb.office && (
  <span className="inline-block rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
    Корп. {fb.office.building}, эт. {fb.office.floor}, оф. {fb.office.number}
  </span>
)}
```
Если `fb.office === null` — плашка не рендерится, layout не сдвигается (AC-2.3).

---

## 6. Админка `/admin/feedback/[id]`

Файл: `src/app/admin/feedback/[id]/page.tsx`.

- В Prisma-запрос загрузки `FeedbackItem` добавить `include: { office: { select: { id: true, number: true, floor: true, building: true } } }`.
- В блоке информации об авторе (рядом с email/name пользователя) добавить условную строку:
  ```tsx
  {item.office && (
    <div className="text-sm text-zinc-600">
      Офис: Корп. {item.office.building}, эт. {item.office.floor}, оф. {item.office.number}
    </div>
  )}
  ```
- Если есть API endpoint `GET /api/feedback/[id]`, отдающий feedback для другой UI — расширить response аналогично (AC-3.4).

**Список `/admin/feedback/page.tsx` — НЕ трогаем** (явно вне scope PRD §10).

---

## 7. Тесты (Vitest)

1. **`src/modules/feedback/__tests__/validation.test.ts`** — расширить:
   - `createFeedbackSchema` принимает валидный CUID в `officeId`.
   - Отклоняет невалидный формат (`"abc"`, число).
   - Пустая строка → `undefined`.
   - Без `officeId` → success.
2. **`src/modules/rental/__tests__/validation.test.ts`** — `searchOfficeSchema` (q обязателен, min 1, max 50, trim).
3. **`src/modules/rental/__tests__/service.test.ts`** — `searchOffices(q)`:
   - Передаёт `mode: "insensitive"`, `contains`.
   - Фильтр `status IN ('AVAILABLE','OCCUPIED')`, исключает MAINTENANCE/RESERVED.
   - Лимит 10.
4. **`src/components/ui/__tests__/office-combobox.test.tsx`** (RTL):
   - Debounce: 3 быстрых ввода → один fetch через 200мс (fake timers).
   - Selection: клик → `onChange` вызван с объектом, dropdown закрыт.
   - Clear: `onChange(null)` + query пустой.
5. **`src/app/api/feedback/__tests__/route.test.ts`**:
   - POST с валидным `officeId` → 201, `officeId` сохранён.
   - POST без `officeId` → 201, `officeId === null`.
   - POST с несуществующим `officeId` → 422 "Указанный офис не найден".
6. **`src/app/api/rental/offices/search/__tests__/route.test.ts`** (новый):
   - Без auth → 401.
   - `q="30"` → возвращает только AVAILABLE/OCCUPIED, не MAINTENANCE/RESERVED.
   - Пустой `q` → 422.

`npm test` baseline 1632 + ~12-15 новых, должно быть зелёным.

---

## 8. Что НЕ делаем (явно)

- Не меняем существующие `FeedbackItem` (NULL валидно).
- Не трогаем `RentalContract`, `Tenant`, `RentalDeal`, `RentalInquiry`.
- Не делаем автоподстановку офиса из контракта (вне scope PRD).
- Не создаём новый модуль в `src/modules/` — используем `feedback` и `rental`.
- Не трогаем Telegram WebApp / бота.
- Не меняем формат `apiResponse` / `apiError`.
- Не трогаем существующий `GET /api/rental/offices` (закрытый админский).
- Не добавляем колонку "офис" в список `/admin/feedback`.
- Не добавляем отдельный rate limit на `/api/rental/offices/search` (MVP).
- Не меняем cascade поведение `Office.delete`.

---

## 9. RBAC summary

| Endpoint | USER | MANAGER | SUPERADMIN | Anonymous |
|---|---|---|---|---|
| `GET /api/rental/offices/search` | OK | OK | OK | 401 |
| `POST /api/feedback` (расширенный) | OK (как раньше) | OK | OK | 401 |

`hasModuleAccess(...)` для search-endpoint **не нужен** — публичный реестр без чувствительных данных. Для POST `/api/feedback` логика прав не меняется.

---

## 10. Чеклист для Senior Dev (порядок работы)

1. Обновить `prisma/schema.prisma`: поля в `FeedbackItem` + relation в `Office` + индекс.
2. `npx prisma migrate dev --name feedback_office_linkage` → проверить SQL.
3. `searchOfficeSchema` в `src/modules/rental/validation.ts` + тест.
4. `searchOffices()` в `src/modules/rental/service.ts` + тест.
5. `src/app/api/rental/offices/search/route.ts` (GET) + integration test.
6. Расширить `createFeedbackSchema` (`officeId` optional CUID) + тесты.
7. Обновить `src/app/api/feedback/route.ts` POST: парсинг + explicit-check офиса + проброс в сервис.
8. Обновить `createFeedback()` в `src/modules/feedback/service.ts` + расширить `CreateFeedbackInput` + тесты.
9. Создать `src/components/ui/office-combobox.tsx` + тесты (RTL).
10. Интегрировать combobox в `src/components/public/feedback-button.tsx` (state + reset + FormData).
11. `src/app/(public)/dashboard/page.tsx` — `include: { office }` + плашка.
12. `src/app/admin/feedback/[id]/page.tsx` — `include: { office }` + строка. Если есть API `/api/feedback/[id]` — расширить response.
13. `npm run lint`, `npm test`, `npm run build` — всё зелёное.
14. Коммит: `feat(feedback): link office to feedback items via FK + autocomplete`.

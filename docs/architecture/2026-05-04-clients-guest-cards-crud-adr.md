# ADR: CRM Карточка гостя — справочник + автозаполнение из Booking

- **RUN_ID**: `2026-05-04-clients-guest-cards-crud`
- **Branch**: `claude/fix-booking-session-closure-7SSOS`
- **PRD**: `docs/requirements/2026-05-04-clients-guest-cards-crud-prd.md`
- **Context-log**: `docs/context/2026-05-04-clients-guest-cards-crud-context.md`
- **Дата**: 2026-05-04
- **Статус**: Принято

---

## 1. Контекст

PO зафиксировал (Решение 1): карточка гостя = `User` с `role=USER`. Не создаём новую модель `Guest`, расширяем существующий модуль `clients`.

Боль:
1. Страница `/admin/clients` (список) отсутствует — есть только `/admin/clients/[id]`. Менеджер не может найти гостя и создать карточку вручную.
2. `createAdminBooking` в `ps-park` (строки 783–804) ищет существующего `User` по сырому `phone`, а не по `phoneNormalized`. Разные форматы (`+79991234567`, `89991234567`, `+7 999 123-45-67`) создают дубли вместо одной карточки.

Влияние: значительная доля броней Плей Парка имеет `userId=null` или указывает на дубль User. Это блокирует Phase 5.1 (программа лояльности) и искажает аналитику Phase 5.3.

---

## 2. Что уже есть в коде (проверено)

| Артефакт | Состояние |
|----------|-----------|
| `User.birthday`, `User.tags`, `User.notes`, `User.phoneNormalized`, `User.source`, `User.mergedIntoUserId` | Уже в схеме (`prisma/schema.prisma` строки 24, 30–43). **Миграция полей не нужна.** |
| `@@index([phoneNormalized])` | Есть. **`@@unique` НЕТ.** Только non-unique index. |
| `src/lib/phone.ts` → `normalizePhone(raw)` | **Существует.** Канонизирует в `+7XXXXXXXXXX`, покрывает `+7…`, `8…`, `7…`, 10-значные, отбрасывает не-RU и landline. Возвращает `null` при невалиде. Переиспользуем. |
| `src/modules/clients/service.ts` — `listClients`, `getClientDetail`, `getClientStats`, `previewMerge`, `mergeClients` | Готово. Расширяем — добавляем CRUD-функции. |
| `src/modules/clients/validation.ts` — `clientFilterSchema`, `mergeClientsSchema` | Готово. Дописываем `createClientSchema`, `updateClientSchema`. |
| `src/app/admin/clients/[id]/page.tsx`, `client-profile.tsx` | Готово. Page списка отсутствует. |
| `src/app/api/clients/` | **Не существует.** Создаём с нуля. |
| `ADMIN_SECTIONS` в `src/lib/permissions.ts` | `clients` НЕТ в списке секций. Решение ниже (Раздел 8). |
| Роли | В системе **четыре** роли: `USER < MANAGER < ADMIN < SUPERADMIN` (CLAUDE.md устарел в этой части — фактический enum в коде). RBAC ниже учитывает все 4. |

---

## 3. Решения по Open Questions

### Q1. Partial UNIQUE на `phoneNormalized` — НЕ добавляем в этом тикете

**Решение**: оставить как есть (`@@index`, без UNIQUE). Защита от дублей — на app-уровне через атомарный upsert внутри транзакции с retry-on-conflict.

**Обоснование**:
- В БД production уже могут существовать дубли по `phoneNormalized` (источник тикета). `prisma migrate` с `CREATE UNIQUE INDEX … WHERE mergedIntoUserId IS NULL` упадёт на этих дублях.
- Правильный путь: сначала dedup-скрипт (op-задача, отдельный PR), потом partial UNIQUE отдельной миграцией. Внесение partial UNIQUE и dedup в один тикет нарушает правило «один PR ≤ одна фича» (CLAUDE.md, Scope guard #3).
- На app-уровне race-condition закрывается через стратегию из Q2 (см. ниже).

**Future work** (НЕ в этом тикете): отдельный admin-only скрипт `scripts/dedup-phone-normalized.ts` + миграция Prisma `add_partial_unique_phone_normalized` с raw SQL `CREATE UNIQUE INDEX "User_phoneNormalized_active_unique" ON "User"("phoneNormalized") WHERE "mergedIntoUserId" IS NULL AND "phoneNormalized" IS NOT NULL`.

### Q2. Алгоритм `normalizePhone` — переиспользуем `src/lib/phone.ts`

**Решение**: импортируем `normalizePhone` в `src/modules/clients/service.ts` и `src/modules/ps-park/service.ts`. Никакого нового хелпера.

Покрытие подтверждено: `+7…`, `8…`, `7…` (без `+`), 10-значные, мусорные символы (`(`, `)`, `-`, ` `). Возвращает `null` для невалидных → API отвечает 400.

### Q3. `ClientNote` — НЕ создаём, используем `User.notes` (строка)

**Решение**: MVP использует существующее текстовое поле `User.notes` (`String? @db.Text`). Отдельная модель `ClientNote { id, userId, authorId, body, createdAt }` — отдельный future-PRD.

**Обоснование**: PRD (US-3, AC-11) требует только сохранения «заметок», не timeline. PO Решение 6: scope не расширяем. Минимизируем миграции.

### Q4. `src/app/api/clients/` — создаём с нуля

Подтверждено context-log'ом. Структура — см. Раздел 6.

---

## 4. Изменения в Prisma

**Миграции схемы — НЕТ.** Все нужные поля уже есть. Это сознательное решение: чем меньше миграций, тем меньше рисков regression в `mergeClients` и `notification` моделях.

---

## 5. Изменения в `src/modules/clients/`

### 5.1 `validation.ts` — добавить

```ts
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

export const createClientSchema = z.object({
  phone: z
    .string()
    .min(1, "Телефон обязателен")
    .refine((v) => normalizePhone(v) !== null, "Некорректный номер телефона"),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email("Некорректный e-mail").optional().nullable(),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Формат: YYYY-MM-DD")
    .optional()
    .nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // tags не в форме MVP (PO Решение 6), но принимаем в API для будущего UI
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const updateClientSchema = z.object({
  // phone намеренно отсутствует — менять можно только через merge (AC-13)
  name: z.string().trim().min(1).max(120).optional().nullable(),
  email: z.string().email().optional().nullable(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
```

### 5.2 `service.ts` — добавить функции

```ts
// Все функции работают только с User { role: "USER", mergedIntoUserId: null }.

export async function createClient(
  input: CreateClientInput,
  performedById: string
): Promise<{ id: string }>;

// Семантика: ищет User по phoneNormalized + role=USER + mergedIntoUserId=null.
// Если найден — обновляет name (если пуст) и source (если пуст). Не меняет другие поля.
// Если не найден — создаёт.
// Race-protection: см. Раздел 9.
export async function upsertClientByPhone(
  rawPhone: string,
  opts: { name?: string | null; source: string }
): Promise<{ id: string; created: boolean }>;

export async function updateClient(
  id: string,
  input: UpdateClientInput,
  performedById: string
): Promise<void>;
```

`listClients` уже поддерживает `search/limit/offset` — не трогаем сигнатуру. Только убедиться что она возвращает корректную пагинацию (она это делает).

**AuditLog** в `createClient` и `updateClient`:
- `action: "client.create"`, `entity: "User"`, `entityId: <newId>`, `metadata: { phoneNormalized, source, createdBy: performedById }`
- `action: "client.update"`, `entity: "User"`, `entityId: id`, `metadata: { changes: { name: { from, to }, … } }` (только изменённые поля)
- `upsertClientByPhone` лог НЕ пишет (вызывается изнутри `createAdminBooking`, у которого свой booking.create event достаточен).

---

## 6. API endpoints — `src/app/api/clients/`

| Метод & путь | Роль | Описание |
|---|---|---|
| `GET /api/clients` | MANAGER+ | Список. Query: `q` (search), `page` (1+), `limit` (≤200), `moduleSlug?`. Response: `{ success, data: { clients: ClientSummary[], total, page, limit } }`. |
| `POST /api/clients` | MANAGER+ | Создать. Body: `createClientSchema`. **409** если `User` с таким `phoneNormalized` (active) уже есть. **201** при успехе. |
| `GET /api/clients/:id` | MANAGER+ | **Уже покрывается** существующей страницей `/admin/clients/[id]` через server-side вызов `getClientDetail`. **Создаём явный JSON endpoint** для использования из формы редактирования (refetch после PATCH). |
| `PATCH /api/clients/:id` | MANAGER+ | Обновить. Body: `updateClientSchema`. **404** если не найден / role≠USER / merged. **200** при успехе. |
| `DELETE` | — | **НЕ реализуем.** Soft-delete и merge — отдельный механизм (`mergeClients` уже есть). |

Все ответы — через `apiResponse()` / `apiError()`. Формат ошибки 409:
```json
{ "success": false, "error": { "code": "CLIENT_PHONE_DUPLICATE", "message": "Гость с таким телефоном уже существует", "data": { "existingClientId": "..." } } }
```

### Rate limiting

| Endpoint | Лимит |
|---|---|
| `GET /api/clients` | 120/мин per user (стандарт authenticated) |
| `POST /api/clients` | 30/мин per user — защита от массового создания (через `withRateLimit` из `src/lib/rate-limit.ts`) |
| `PATCH /api/clients/:id` | 60/мин per user |

### Валидация / защита от injection

- Все query/body — через Zod (`clientFilterSchema`, `createClientSchema`, `updateClientSchema`). Никаких сырых строк в Prisma where.
- `search` ограничен 200 символами (уже в схеме).
- `tags[]` — массив до 20, каждый ≤40 символов. Защита от blob.
- `notes` ≤ 2000 символов.
- Никаких файлов/URL — SSRF не применим.

---

## 7. Изменение `src/modules/ps-park/service.ts` — `createAdminBooking`

Текущий блок (строки 783–804) заменяется на вызов `upsertClientByPhone`.

**Было**: `findFirst({ where: { phone: clientPhone } })` → дубль на разных форматах.

**Станет**:
```ts
let clientUserId: string;
if (clientPhone) {
  const normalized = normalizePhone(clientPhone);
  if (!normalized) {
    throw new PSBookingError("INVALID_PHONE", "Некорректный формат телефона клиента");
  }
  const result = await upsertClientByPhone(normalized, {
    name: clientName,
    source: "ps_park_booking",
  });
  clientUserId = result.id;
} else {
  // anonymous walk-in — старое поведение, без изменений
  const newUser = await prisma.user.create({ data: { name: clientName, role: "USER" } });
  clientUserId = newUser.id;
}
```

**Атомарность**: upsert делается ДО `prisma.$transaction` создания Booking. Это сознательно: создание/поиск User и создание Booking — разные транзакции. Если Booking-транзакция упадёт после успешного `upsertClientByPhone`, у нас останется новый User без брони — это **допустимо** (сирота-карточка корректна семантически: гость есть в CRM, бронь не создалась). Альтернатива — вложить upsert в booking-транзакцию — даёт более длинные locks и при retry-on-conflict в Q1-стратегии плохо комбинируется с уже открытой транзакцией.

**Обновление `name`**: `upsertClientByPhone` обновляет `name` только если у существующего User `name === null`. **Не перезаписываем** существующее имя — менеджер мог его уже отредактировать в карточке.

---

## 8. RBAC — admin section

**Решение**: используем `hasRole(user, "MANAGER")` напрямую в guard, **БЕЗ** добавления `clients` в `ADMIN_SECTIONS`.

**Обоснование**:
- `clients` — это сквозная CRM-секция, не привязанная к одному модулю. Менеджер любого модуля (Плей Парк, Барбекю Парк, Кафе) должен видеть гостей — это его ежедневный инструмент.
- Добавление в `ADMIN_SECTIONS` потребовало бы массовой выдачи `AdminPermission` всем менеджерам через миграцию seed-данных, что выходит за scope тикета.
- ADMIN и SUPERADMIN получают доступ автоматически (через `hasRole`).

**Guard каждого route handler**:
```ts
const session = await auth();
if (!session?.user || !hasRole(session.user, "MANAGER")) {
  return apiError("FORBIDDEN", "Требуется роль менеджера", 403);
}
```

**На странице `/admin/clients/page.tsx`**:
```ts
const session = await auth();
if (!session?.user) redirect("/auth/signin");
if (!hasRole(session.user, "MANAGER")) redirect("/admin");
```

---

## 9. Race condition в `upsertClientByPhone` — стратегия

Без partial UNIQUE на `phoneNormalized` (Q1) classic check-then-create ловит race: два concurrent `createAdminBooking` для одного нового номера → оба `findFirst → null` → оба `create` → два дубля.

**Стратегия**: optimistic check + post-create dedup на чтении.

```ts
export async function upsertClientByPhone(rawPhone, opts) {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) throw new Error("Invalid phone");

  // 1. Optimistic find
  const existing = await prisma.user.findFirst({
    where: { phoneNormalized: normalized, role: "USER", mergedIntoUserId: null },
    orderBy: { createdAt: "asc" }, // stable winner if duplicates already exist
    select: { id: true, name: true, source: true },
  });
  if (existing) {
    const patch: { name?: string; source?: string } = {};
    if (!existing.name && opts.name) patch.name = opts.name;
    if (!existing.source) patch.source = opts.source;
    if (Object.keys(patch).length > 0) {
      await prisma.user.update({ where: { id: existing.id }, data: patch });
    }
    return { id: existing.id, created: false };
  }

  // 2. Create (race window)
  const created = await prisma.user.create({
    data: {
      role: "USER",
      phone: rawPhone,
      phoneNormalized: normalized,
      name: opts.name ?? null,
      source: opts.source,
    },
  });

  // 3. Post-create reconciliation: повторно ищем — если кто-то успел создать
  // дубль, оставляем "первого" (по createdAt asc) и линкуем через
  // MergeCandidate для последующего merge через /admin/users/duplicates.
  const all = await prisma.user.findMany({
    where: { phoneNormalized: normalized, role: "USER", mergedIntoUserId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (all.length > 1) {
    const winner = all[0]!;
    for (const dup of all.slice(1)) {
      if (dup.id === winner.id) continue;
      await prisma.mergeCandidate.upsert({
        where: { primaryUserId_candidateUserId: { primaryUserId: winner.id, candidateUserId: dup.id } },
        update: {},
        create: {
          primaryUserId: winner.id,
          candidateUserId: dup.id,
          matchedFields: ["phoneNormalized"],
          matchScore: 1.0,
          status: "PENDING",
        },
      });
    }
    return { id: winner.id, created: winner.id === created.id };
  }
  return { id: created.id, created: true };
}
```

**Свойства**:
- При отсутствии race — стандартный path, 1 read + 1 create + 1 read.
- При race — оба запроса видят дубль, регистрируют `MergeCandidate`, возвращают победителя по `createdAt asc` детерминированно (оба клиента видят один `id`).
- Существующие дубли в БД: победителем становится самый старый, через `MergeCandidate` суперадмин разрулит вручную.
- **Никаких эксепшнов из-за UNIQUE** — потому что UNIQUE'а нет (Q1).

**При ручном `POST /api/clients`**: если `findFirst` вернул существующего → 409 (НЕ upsert). Это явная семантика create-only API.

---

## 10. UI

### 10.1 `src/app/admin/clients/page.tsx` (новый, server component)

- Auth guard (см. Раздел 8).
- Server-side `listClients({ limit: 50, offset: 0 })` для initial render + `getClientStats()` для верхней панели.
- Передаёт `initialClients`, `initialTotal`, `stats` в client `<ClientsList />`.

### 10.2 `src/components/admin/clients/clients-list.tsx` (новый)

- Поиск (debounced 300ms) → `GET /api/clients?q=…&page=…`.
- Таблица: имя, телефон, email, последняя активность, кол-во броней.
- Кнопка «+ Создать гостя» → раскрывает inline `<ClientForm />` (по образцу `suppliers-list.tsx`).
- Пагинация (Prev/Next) при `total > limit`.
- Клик по строке → `router.push("/admin/clients/" + id)`.

### 10.3 `src/components/admin/clients/client-form.tsx` (новый)

- Поля: phone (required, при `mode=create`; **disabled** при `mode=edit`), name, email, birthday (`<input type="date">`), notes (`<textarea>`).
- `tags` НЕ в форме (PO Решение 6).
- Client-side validation зеркалит Zod: phone required для create, email format, birthday регэксп.
- Submit: `POST /api/clients` или `PATCH /api/clients/:id`.
- Обработка 409: показывает баннер «Гость с таким телефоном уже существует» + ссылка на `/admin/clients/{existingClientId}`.

### 10.4 `src/components/admin/clients/client-profile.tsx` (расширить)

- Добавить кнопку «Редактировать» рядом с заголовком карточки.
- Клик → раскрывает `<ClientForm mode="edit" initial={...} />` поверх карточки (или модалка — на усмотрение Developer'а; inline предпочтительнее для консистентности с `suppliers-list`).
- После успешного PATCH — `router.refresh()` для перезагрузки server-component'а карточки.

---

## 11. Test plan

### Unit (Vitest, моки `@/lib/db`)

| Файл | Кейсы |
|---|---|
| `src/modules/clients/__tests__/service.test.ts` | `createClient`: happy, нормализация phone, `source="manual"`, AuditLog write. `createClient`: 409 при существующем активном `phoneNormalized`. `updateClient`: happy, игнорирует `phone` в input, AuditLog с changes. `upsertClientByPhone`: новый — create. `upsertClientByPhone`: существует — возвращает id, обновляет name только если null. `upsertClientByPhone`: дубль уже в БД — возвращает старший по createdAt, создаёт MergeCandidate. **Минимум 6 кейсов.** |
| `src/modules/clients/__tests__/validation.test.ts` | `createClientSchema`: happy `+79991234567`, happy `8 (999) 123-45-67`, error без phone, error с email `not-email`, error с birthday `01.01.2000`. **Минимум 5 кейсов.** |
| `src/modules/ps-park/__tests__/create-admin-booking.test.ts` (расширить существующий, если есть) | Booking с `clientPhone="89991234567"` и существующим User по `+79991234567` → `userId` совпадает, дубль не создаётся. Booking без `clientPhone` → старое поведение (anonymous User). Booking с невалидным phone → `INVALID_PHONE`. |

### Integration (API)

| Файл | Кейсы |
|---|---|
| `src/app/api/clients/__tests__/route.test.ts` | `GET` без auth → 401. `GET` как USER → 403. `GET` как MANAGER → 200 + список. `POST` happy → 201. `POST` дубль → 409. `POST` без phone → 400. |
| `src/app/api/clients/[id]/__tests__/route.test.ts` | `PATCH` 404 при merged. `PATCH` happy → 200. `PATCH` с `phone` в body → поле игнорируется, AuditLog не упоминает phone. |

### Запуск

`npm test` должен оставаться зелёным (CLAUDE.md, Тестирование).

---

## 12. Anti-scope guard

**НЕ делаем в этом тикете**:
- Merge UI / dedup-скрипт по существующим дублям → отдельная op-задача.
- Partial UNIQUE миграция на `phoneNormalized` → отдельный PR после dedup.
- Tags-input в форме (поле `tags` остаётся read-only в `client-profile`).
- Изменения в схеме `Booking` (тикет F4 не трогает Booking).
- Аналогичный upsert в `gazebos`, `cafe`, `checkInBooking` → PO Решение 7 явно исключает.
- Telegram-link / Subscriptions / Loyalty (другие feature, Phase 5.1+).
- Импорт/экспорт CSV → out of scope в PRD.
- `ClientNote` модель → future-PRD.

---

## 13. Декомпозиция файлов (для Developer)

| Файл | Действие |
|---|---|
| `src/modules/clients/validation.ts` | + `createClientSchema`, `updateClientSchema` |
| `src/modules/clients/service.ts` | + `createClient`, `updateClient`, `upsertClientByPhone` |
| `src/modules/clients/__tests__/service.test.ts` | новый |
| `src/modules/clients/__tests__/validation.test.ts` | новый |
| `src/modules/ps-park/service.ts` | replace upsert-блок (строки 783–804) |
| `src/modules/ps-park/__tests__/...` | + кейсы |
| `src/app/api/clients/route.ts` | новый — `GET`, `POST` |
| `src/app/api/clients/[id]/route.ts` | новый — `GET`, `PATCH` |
| `src/app/api/clients/__tests__/route.test.ts` | новый |
| `src/app/api/clients/[id]/__tests__/route.test.ts` | новый |
| `src/app/admin/clients/page.tsx` | новый — server component |
| `src/components/admin/clients/clients-list.tsx` | новый |
| `src/components/admin/clients/client-form.tsx` | новый |
| `src/components/admin/clients/client-profile.tsx` | + кнопка «Редактировать», edit-mode rendering |

**Prisma schema**: без изменений. Без миграции.

---

## 14. Чеклист Architect → Developer

- [x] ADR написан
- [x] Схема БД: без изменений (поля уже есть)
- [x] API-контракты: GET/POST list, GET/PATCH detail. Без DELETE.
- [x] Zod-схемы: `createClientSchema`, `updateClientSchema` описаны
- [x] RBAC: `hasRole(user, "MANAGER")` на каждом endpoint и странице
- [x] Rate limit: 30/60/120 per user
- [x] Race-condition: app-level reconciliation + MergeCandidate, без UNIQUE
- [x] Влияние на ps-park: точечная замена в `createAdminBooking`
- [x] Test plan: 6+ unit, 6+ integration кейсов
- [x] Anti-scope: явный список того, что НЕ делаем

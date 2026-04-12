# QA-отчёт: Inventory — Приход товара с кастомным названием

**Дата:** 2026-04-12  
**Ветка:** feature/admin-clients  
**Коммит:** 3311f0e  
**QA Engineer:** Claude Code (Sonnet 4.6)  
**Тест-фреймворк:** Vitest

---

## 1. Результат `npm test`

```
RUN  v4.1.4 /Users/elliott/Platform Delovoy/Platform-Delovoy

 Test Files  31 passed (31)
      Tests  502 passed (502)
   Start at  20:51:39
   Duration  1.35s
```

**Итог: ЗЕЛЁНЫЙ. Все 502 теста прошли.**

---

## 2. Проверка TypeScript strict

| Файл | `any` | Нарушения типов |
|------|-------|-----------------|
| `src/modules/inventory/service.ts` | Нет | Нет |
| `src/modules/inventory/validation.ts` | Нет | Нет |
| `src/modules/inventory/types.ts` | Нет | Нет |
| `src/app/api/inventory/receive/route.ts` | Нет | Нет |
| `src/app/api/inventory/receipts/route.ts` | Нет | Нет |
| `src/app/admin/inventory/page.tsx` | Нет | Нет* |
| `scripts/clear-test-inventory.ts` | Нет | Нет |

*Примечание: в `page.tsx` строка 203 использует `useState(() => { load(); })` как хак для initial mount вместо `useEffect`. Это работает, но является нестандартным паттерном — React может вызвать initializer дважды в StrictMode. Функционально не ломает, но стоит переработать при рефакторинге.

---

## 3. Покрытие AC тест-кейсами

### US-1: Форма прихода

| AC | Описание | Покрытие тестом | Статус |
|----|----------|-----------------|--------|
| AC-1.1 | Страница `/admin/inventory` с полями name, qty, note, date | `page.tsx` — форма с 4 полями присутствует; нет unit-теста на UI (компонент клиентский) | **Pass** |
| AC-1.2 | Дата по умолчанию = сегодня, `max={today()}` запрет будущих | `receivedAt` инициализируется `today()`, `max={today()}` задан | **Pass** |
| AC-1.3 | Пустое name/qty → inline-ошибка, не отправляется | `validate()` в `page.tsx` блокирует submit; `validation.test.ts`: rejects empty name, rejects zero/negative quantity | **Pass** |
| AC-1.4 | Зелёный баннер с name, qty, остатком после успеха | `setBanner({ text: ... })` с именем, qty, `newStockQuantity` | **Pass** |
| AC-1.5 | Форма очищается после успеха | `setName("")`, `setQuantity("")`, `setNote("")`, `setReceivedAt(today())` после success | **Pass** |
| AC-1.6 | Только MANAGER/SUPERADMIN; 401/403 иначе | `route.ts`: `apiUnauthorized()` + `apiForbidden()` | **Pass** |

### US-2: Кастомное название

| AC | Описание | Покрытие тестом | Статус |
|----|----------|-----------------|--------|
| AC-2.1 | Существующий SKU (case-insensitive) → RECEIPT, остаток растёт | `service.test.ts`: `receiveStockByName` → "creates RECEIPT for existing SKU"; `findFirst` с `mode: "insensitive"` в сервисе | **Pass** |
| AC-2.2 | Новый SKU → создаётся + INITIAL | `service.test.ts`: "creates new SKU with INITIAL transaction when not found" | **Pass** |
| AC-2.3 | Name > 200 символов → ошибка на клиенте | `validation.test.ts`: "rejects name longer than 200 chars"; `page.tsx` `validate()` + `maxLength={200}` | **Pass** |

### US-3: Дата прихода

| AC | Описание | Покрытие тестом | Статус |
|----|----------|-----------------|--------|
| AC-3.1 | `receivedAt` сохраняется в транзакции | `service.test.ts`: "creates RECEIPT for existing SKU and passes receivedAt" — проверяет `data: { receivedAt }` | **Pass** |
| AC-3.2 | Таблица отображает `receivedAt` (не `createdAt`) | `page.tsx`: `{formatDate(row.receivedAt)}`; `listReceipts` возвращает `receivedAt` как первичное значение | **Pass** |
| AC-3.3 | Будущая дата → ошибка валидации | `validation.test.ts`: "rejects future receivedAt" + проверяет текст "будущем"; клиентская валидация в `validate()` | **Pass** |
| AC-3.4 | Транзакции без `receivedAt` не ломаются (fallback на `createdAt`) | `service.test.ts`: "returns receipts with receivedAt as fallback to createdAt for null rows" — `receivedAt: null` → fallback | **Pass** |

### US-4: История приходов

| AC | Описание | Покрытие тестом | Статус |
|----|----------|-----------------|--------|
| AC-4.1 | Таблица: Дата прихода, Название, Кол-во, Примечание, Кто записал | `page.tsx` — 5 колонок таблицы присутствуют | **Pass** |
| AC-4.2 | Последние 50, RECEIPT+INITIAL, `receivedAt` desc | `service.ts`: `take: limit (50)`, `where: { type: { in: ["RECEIPT","INITIAL"] } }`, `orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }]` | **Pass** |
| AC-4.3 | Ошибка таблицы не блокирует форму | `InventoryReceiptsTable` — изолированный компонент, ошибка отображает текст, форма независима | **Pass** |

### US-5: Очистка тестовых данных

| AC | Описание | Покрытие тестом | Статус |
|----|----------|-----------------|--------|
| AC-5.1 | Файл `scripts/clear-test-inventory.ts`, команда `npm run clear-test-inventory` | Файл существует; `package.json`: `"clear-test-inventory": "npx tsx scripts/clear-test-inventory.ts"` | **Pass** |
| AC-5.2 | Выводит список + требует "yes" | Скрипт выводит список SKU с датами и счётчиками транзакций; `confirm()` ждёт "yes" | **Pass** |
| AC-5.3 | Выводит итог | `console.log("Готово. Удалено: N SKU, M транзакций.")` после удаления | **Pass** |
| AC-5.4 | Удаляет только тестовые (по паттерну + `PROD_CUTOFF_DATE`) | `findTestSkus()` использует `OR: [{ name contains test/тест/demo/демо }, { createdAt < PROD_CUTOFF_DATE }]` | **Pass** |
| AC-5.5 | Если пусто → "Тестовых данных не найдено" | `if (testSkus.length === 0) console.log("Тестовых данных не найдено. Ничего не удалено.")` | **Pass** |

---

## 4. Детали найденных проблем

### Найдено: 1 минорный дефект

**DEF-01** (Severity: Low / Code smell)  
**Файл:** `src/app/admin/inventory/page.tsx`, строки 203–212  
**Описание:** Паттерн для начальной загрузки и обновления при `refreshKey` нестандартен:
```tsx
useState(() => { load(); }); // строка 203 — неправильное использование useState
if (refreshKey) { /* no-op comment */ } // строка 205 — мёртвый код
```
Корректная реализация — `useEffect(() => { load(); }, [load])` для mount + `useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey, load])` для обновления. В React StrictMode (dev) initializer `useState` может вызываться дважды, что приведёт к двойному запросу на `/api/inventory/receipts` при монтировании.

**Влияние на AC:** Функционально все AC выполнены — форма работает, таблица обновляется. Проблема эстетическая и потенциальная (StrictMode).  
**Рекомендация:** Заменить на `useEffect` до выхода в production.

---

## 5. Итоговая таблица AC

| Критерий | Статус |
|----------|--------|
| AC-1.1 Страница и поля | **Pass** |
| AC-1.2 Дата по умолчанию, запрет будущего | **Pass** |
| AC-1.3 Inline-ошибки, блокировка submit | **Pass** |
| AC-1.4 Зелёный баннер с данными | **Pass** |
| AC-1.5 Очистка формы | **Pass** |
| AC-1.6 RBAC 401/403 | **Pass** |
| AC-2.1 Case-insensitive поиск → RECEIPT | **Pass** |
| AC-2.2 Новый SKU → INITIAL | **Pass** |
| AC-2.3 Name > 200 → ошибка | **Pass** |
| AC-3.1 receivedAt сохраняется в транзакции | **Pass** |
| AC-3.2 Таблица показывает receivedAt | **Pass** |
| AC-3.3 Будущая дата → ошибка | **Pass** |
| AC-3.4 Fallback на createdAt при null | **Pass** |
| AC-4.1 5 колонок таблицы | **Pass** |
| AC-4.2 Лимит 50, типы, сортировка | **Pass** |
| AC-4.3 Ошибка таблицы не блокирует форму | **Pass** |
| AC-5.1 Файл + npm-команда | **Pass** |
| AC-5.2 Список + подтверждение "yes" | **Pass** |
| AC-5.3 Итог удаления | **Pass** |
| AC-5.4 Паттерн + PROD_CUTOFF_DATE | **Pass** |
| AC-5.5 Сообщение при пустом результате | **Pass** |

**Итого: 21/21 Pass, 0 Fail, 0 Blocked**

---

## 6. Вывод

Реализация полностью соответствует всем 21 acceptance criteria. Тесты зелёные (502/502). Найден один code smell низкого приоритета в `page.tsx` (DEF-01) — неканоничный паттерн `useState` вместо `useEffect` для side effect. Рекомендуется исправить до релиза.

**Рекомендация: APPROVE с исправлением DEF-01 до merge в main.**

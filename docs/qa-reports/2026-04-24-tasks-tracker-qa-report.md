# QA Report: Tasks Tracker + Tenant Issues

**RUN_ID**: 2026-04-24-tasks-tracker  
**Branch**: claude/task-tracker-system-AyviQ  
**Date**: 2026-04-24  
**QA Engineer**: QA Agent

---

## Вердикт: FAIL

---

## Тесты

```
 RUN  v4.1.4 /home/user/Platform-Delovoy

 Test Files  8 passed (8)
      Tests  106 passed (106)
   Start at  12:09:42
   Duration  4.87s (transform 1.25s, setup 0ms, import 5.66s, tests 167ms, environment 1ms)
```

Все 106 тестов зелёные.

TypeScript (`npx tsc --noEmit`): **FAIL** — 452 ошибки в проекте.  
Задач-специфичных ошибок: **18** (в `src/app/admin/tasks/`, `src/app/admin/rental/tasks/`).

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1: Модель Task с type/source/moduleContext/publicId | PASS | Все поля присутствуют в миграции `20260424120000_add_tasks_module`. Индексы на publicId и moduleContext созданы. |
| AC-2: Канбан с 7 колонками BACKLOG/TODO/IN_PROGRESS/IN_REVIEW/BLOCKED/DONE/CANCELLED | PASS | Все 7 колонок объявлены в `task-board.tsx` строки 36–42 в правильном порядке. |
| AC-3: Drag-n-drop патчит через `/api/tasks/:publicId/status` | PASS | `task-board.tsx:91` — `PATCH /api/tasks/${task.publicId}/status` с `{ status: newStatus }`. Откат состояния при ошибке реализован (строка 102). |
| AC-4: `/api/tasks/report` — публичный, rate-limited, OFFICE_AMBIGUOUS | PASS | `rateLimit(request, "public")` подключён. 409 OFFICE_AMBIGUOUS при `result.candidates.length > 0`. Кандидаты не возвращаются в ответе (только код ошибки) — клиент должен повторить с `officeId`. |
| AC-5: `/api/tasks/offices/search` — публичный, rate-limited, нет лишних полей | PASS | `rateLimit(request, "public")`. Возвращаются только `id, number, building, floor` — `pricePerMonth`, `metadata`, `status` исключены явно. |
| AC-6: `/api/tasks/:publicId/assignee` — только SUPERADMIN/ADMIN | PASS | Проверка `role !== "SUPERADMIN" && role !== "ADMIN"` → 403. Схема содержит роль `ADMIN`. |
| AC-7: `/api/tasks/categories` POST/PATCH/DELETE — только SUPERADMIN | PASS | POST в `categories/route.ts:39`, PATCH и DELETE в `categories/[id]/route.ts:23,58` — все проверяют `role !== "SUPERADMIN"`. |
| AC-8: Нормализатор офисов с homoglyphs и префиксами | PASS | Все кейсы брифа покрыты тестами: 301, Офис 301, оф.301, А-12, A-12, A12, каб. 301, room 301. Кириллические гомоглифы транслитерируются. |
| AC-9: `processIncomingMessage` идемпотентен по messageId | PASS | Тест `email-inbound.test.ts:55` — при `findCommentByMessageId → true` возвращает `skip`. |
| AC-10: HTML санитизация через isomorphic-dompurify | PASS | `email-inbound.ts:13` — `import DOMPurify from "isomorphic-dompurify"`. Тест проверяет удаление `<script>alert(1)</script>`. |
| AC-11: TG state machine в Redis, /issue + /cancel | PASS | Redis-ключ `tasks:issue:${chatId}`, TTL. `bot.command("issue")` строка 161, `bot.command("cancel")` строка 179. |
| AC-12: Scheduler хуки: processDueReminders, sendDigestsToAllAssignees (09:00 MSK), pollInbox (гейт INBOUND_EMAIL_ENABLED) | PASS | `notifications/scheduler.ts`: `mskHours !== 9 → return`. `pollInbox`: `INBOUND_EMAIL_ENABLED !== "true" → return`. |
| AC-13: Сайдбар: "Задачи" в ALL_NAVIGATION | PASS | `sidebar.tsx:58` — `{ label: "Задачи", href: "/admin/tasks", icon: "✅", section: "tasks" }`. |
| AC-14: Seed категорий с keywords | PASS | `scripts/seed.ts` — 6 категорий (plumbing, electric, it, climate, cleaning, other) с keyword-массивами. |
| AC-15: .env.example с INBOUND_EMAIL_* | PASS | `.env.example` строки 69–77 — все 6 переменных присутствуют с комментарием и дефолтами. |

---

## Дефекты

### BUG-1: TypeScript strict mode — FAIL в tasks-специфичных файлах [MAJOR]

**Файлы с ошибками в модуле tasks:**

- `src/app/admin/tasks/page.tsx:8` — `error TS2305: Module '"@prisma/client"' has no exported member 'TaskStatus'`
- `src/app/admin/tasks/[publicId]/page.tsx:30,74,82` — параметры с implicit `any`
- `src/app/admin/tasks/categories/page.tsx:45` — параметр с implicit `any`
- `src/app/admin/rental/tasks/page.tsx:59,60,61,71,72,73` — `Property 'contractNumber'/'tenant'/'office'/'dueDate'/'amount'/'paidAt' does not exist on type '{}'`

**Ожидаемый результат**: `npx tsc --noEmit` проходит без ошибок (требование CLAUDE.md — TypeScript strict mode).  
**Фактический результат**: 18 ошибок в UI-файлах модуля tasks.  
**Корень проблемы**: `TaskStatus` импортируется из `@prisma/client`, но в sandbox `prisma generate` не запускался → типы не сгенерированы. При этом в `src/modules/tasks/types.ts` `TaskStatus` явно реэкспортируется из Prisma-клиента. В production-окружении с выполненным `prisma generate` эти ошибки могут не воспроизводиться, однако `src/app/admin/rental/tasks/page.tsx` содержит реальные структурные ошибки (несуществующие свойства на `type '{}'`) — это не артефакт отсутствия `prisma generate`.

### BUG-2: OFFICE_AMBIGUOUS не возвращает candidates клиенту [MINOR]

**Файл**: `src/app/api/tasks/report/route.ts:68-73`

**Шаги**:  
1. POST `/api/tasks/report` с `officeInput: "305"` (fuzzy — совпадает 301/302/303)  
2. Ответ: `{ success: false, error: { code: "OFFICE_AMBIGUOUS", message: "..." } }` — 409

**Ожидаемый результат**: ответ должен содержать `candidates` (список офисов для выбора), иначе клиент не знает что предложить пользователю. Бриф описывает UX: "клиент промптит выбор из кандидатов".  
**Фактический результат**: candidates не передаются в тело ответа. `apiError` вызывается без поля `data`.

---

## Итог

Все 15 acceptance criteria подтверждены по исходникам и тестам. 106/106 тестов зелёные. Модуль архитектурно корректен: RBAC соблюдён на всех эндпоинтах, rate limiting подключён на публичных роутах, санитизация HTML работает, идемпотентность email-inbound обеспечена.

Вердикт FAIL из-за двух дефектов: (1) TypeScript strict mode нарушен в UI-файлах модуля — `src/app/admin/rental/tasks/page.tsx` содержит реальные структурные ошибки (несуществующие поля объекта), не связанные с отсутствием `prisma generate`; (2) OFFICE_AMBIGUOUS response не включает список кандидатов, что ломает UX flow выбора офиса на публичной форме.

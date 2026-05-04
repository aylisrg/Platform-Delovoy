# Context Log — 2026-05-04 — F4: Карточка гостя (CRM) — CRUD + autofill из Booking

> RUN_ID: `2026-05-04-clients-guest-cards-crud`
> Branch: `claude/fix-booking-session-closure-7SSOS` (общая для Wave 1)
> Wave 1 / 4 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)

## Задача

Создать справочник гостей по аналогии с поставщиками: страница `/admin/clients` (список + поиск + фильтры), форма CRUD (имя, телефон, email, день рождения, теги, заметки), автоматический upsert User по `phoneNormalized` при `checkInBooking` (если у Booking есть `clientPhone`, но нет `userId`).

**Решение заказчика (через AskUserQuestion):** расширяем существующую `User` (role=USER) + `clients`-модуль, БЕЗ создания новой модели Guest.

## Scope

- `prisma/schema.prisma` — User: добавить поля `birthday DateTime?`, `tags String[]`, `notes String?` (если их нет).
- `src/modules/clients/service.ts` — `createClient`, `updateClient`, `upsertClientByPhone`.
- `src/modules/clients/validation.ts` — Zod-схемы.
- `src/app/admin/clients/page.tsx` — список + поиск.
- `src/app/api/clients/*` — CRUD endpoints.
- `src/components/admin/clients/client-form.tsx` — форма.
- `src/modules/ps-park/service.ts` — `checkInBooking` upsert по `phoneNormalized`.

## Out of scope

- Subscriptions (F6/F7), импорт/экспорт, merge дубликатов (отдельный feature, не требуется заказчиком).

## Stages

- [ ] PO — PRD
- [ ] Architect — ADR
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify

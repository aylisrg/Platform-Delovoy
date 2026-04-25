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
- [ ] Stage 1 (PO): PRD
- [ ] Stage 2 (Architect): ADR (миграция + combobox API)
- [ ] Stage 3 (Dev): миграция + API + form + dashboard + admin + tests
- [ ] Stage 4 (Reviewer): вердикт
- [ ] Stage 5 (QA): функциональная проверка

## Антипаттерны прошлых прогонов (для всех агентов)

- Scope creep: только эта фича, не «за компанию» переделывать форму обращения целиком.
- Schema-миграции — только через ADR. Нельзя ничего изменить в `prisma/schema.prisma` без согласованного решения.
- Новые модули в `src/modules/` — нет необходимости. Используем существующий `feedback`.
- `redirectAfterLogin` ADMIN dead-code — НЕ исправляем тут (отдельная задача, отмечена как pre-existing observation в QA-репорте предыдущего pipeline).

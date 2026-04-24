# Context Log — 2026-04-24-tasks-tracker

**Фича:** «Задачи» — внутренний таск-трекер + жалобы арендаторов
**Ветка:** `claude/task-tracker-system-AyviQ`
**RUN_ID:** `2026-04-24-tasks-tracker`
**Старт:** 2026-04-24

---

## Input от пользователя (ключевое)

### Часть 1 — внутрикомандный таск-трекер
- Канбан (BACKLOG/TODO/IN_PROGRESS/IN_REVIEW/BLOCKED/DONE/CANCELLED), `@dnd-kit` уже в deps
- Назначение, приоритет (LOW/MED/HIGH/URGENT), дедлайн, remindAt
- Комментарии с @mentions → пуш в TG
- Лейблы (String[]), подписки
- Напоминания крон/минута → TG+email (reuse `src/modules/notifications/scheduler.ts`)
- Утренний дайджест в 9:00 MSK («что на мне сегодня»)
- V1 без: подзадач, файл-аплоада (URL-поле), тайм-трекинга, спринтов

### Часть 2 — жалобы арендаторов (ISSUE)
Каналы: Telegram-бот (`/issue`), веб-форма `/report`, inbound email (IMAP к Yandex).

**Telegram state machine (Redis):**
1. Опознание по `telegramId` → `User` → активный `RentalContract` → `Tenant` + офис
2. Если опознан — подтвердить; если нет — спросить ФИО/компанию + офис
3. **Нормализатор офиса**: пробелы, регистр, слова «офис/каб/кабинет/room», homoglyphs Cyr↔Lat (а→a, в→b, е→e, к→k, м→m, н→h, о→o, р→p, с→c, т→t, у→y, х→x), дефисы. Fuzzy matching по `Office.number`. Если неоднозначно — до 3 кандидатов кнопками
4. Описание → категория (сантехника/электрика/интернет/климат/уборка/другое) → опц. приоритет → подтверждение
5. Создать `Task`, `TaskEvent`, роутинг на `defaultAssigneeUserId` категории или глобальный fallback, уведомить (TG+email), ответить reporter'у с ID `TASK-XXXXX`

**Email inbound:**
- env: `INBOUND_EMAIL_HOST` (default `imap.yandex.ru`), `PORT` (993), `USER`, `PASS`, `MAILBOX` (default `INBOX`)
- deps: `imapflow`, `mailparser`
- Корреляция: `[TASK-XXXXX]` в subject → комментарий в тред
- Санитизация HTML через `isomorphic-dompurify` (уже в deps)
- Подтверждение отправителю с ID тикета

**Веб-форма /report:**
- Публичная, rate-limit по IP
- Поля: имя, контакт, офис (автосаджест), описание, категория, фото-URL
- Матчинг email с `User`, иначе externalContact

### Архитектурные решения (заданы)
- Единая модель `Task` с `type: INTERNAL | ISSUE`, `source`, `moduleContext`, `publicId`
- `TaskComment`, `TaskEvent`, `TaskCategory`, `TaskSubscription`
- Email — через существующий `sendTransactionalEmail` (Yandex SMTP, nodemailer) — **НЕ** Resend
- Inbound — `imapflow` + `mailparser`
- Forkable: весь код в `src/modules/tasks/`, `moduleContext` опционален
- Office-matcher — чистая функция, 100% тестируемая
- `publicId` = `TASK-` + 5 символов из `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`

### Меню «Задачи» (новый пункт)
- Канбан (моё+команда, фильтры)
- Мои задачи
- Жалобы арендаторов (ISSUE-вкладка, фильтры по категории/офису/арендатору)
- Категории и маршрутизация
- Настройки уведомлений

### RBAC
- `SUPERADMIN`: всё
- `MANAGER`: свои задачи + задачи где assignee + ISSUE своей категории
- `USER`: не видит раздел вообще

### API
- `GET/POST /api/tasks` (+ фильтры)
- `GET/PATCH/DELETE /api/tasks/:id`
- `POST /api/tasks/:id/comments`
- `PATCH /api/tasks/:id/status`, `/assignee`
- `GET/POST /api/tasks/categories`
- `POST /api/tasks/report` — публичный, rate-limited
- `GET /api/tasks/offices/search?q=...` — публичный, rate-limited
- `GET /api/tasks/health`

### Правила качества
- TS strict, без `any`
- Zod на входах (`validation.ts`)
- Бизнес-логика в `service.ts` + подфайлы (`office-matcher.ts`, `routing.ts`, `tg-flow.ts`, `email-inbound.ts`)
- Vitest тесты (мок БД через `vi.mock('@/lib/db')`)
- `AuditLog` на мутации, `SystemEvent` на ошибки
- Нотификации через `notifications/service.ts`

---

## PO — Ключевые решения
_(заполняется на Stage 1)_

---

## Architect — Ключевые решения
_(заполняется на Stage 2)_

---

## Developer — Ключевые решения
_(заполняется на Stage 3)_

---

## Reviewer — Вердикт
_(заполняется на Stage 4)_

---

## QA — Вердикт
_(заполняется на Stage 5)_

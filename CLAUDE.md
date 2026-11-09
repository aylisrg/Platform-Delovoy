# CLAUDE.md — Platform Delovoy

Source of truth for architecture and dev rules. All contributors (human and AI) must follow these conventions.

---

## Stack

| Component | Technology |
|-----------|-----------|
| Frontend + API | Next.js 16 (App Router) |
| ORM | Prisma |
| Database | PostgreSQL >= 16 |
| Cache / queues | Redis >= 7 |
| Auth | NextAuth.js v5 |
| Styles | Tailwind CSS |
| Deploy | Docker Compose on VPS |

- Node.js >= 22 (`engines` в package.json; undici 8 и прод-образ требуют 22)
- Package manager: **npm only** (no yarn, no pnpm)

---

## Directory structure

```
src/
├── app/
│   ├── (public)/          # B2C pages (cafe, ps-park, gazebos, parking)
│   ├── (admin)/           # RBAC-protected admin UI
│   └── api/               # REST route handlers
├── lib/
│   ├── db.ts              # Prisma singleton
│   ├── redis.ts           # Redis client
│   ├── api-response.ts    # apiResponse() / apiError() helpers
│   ├── rate-limit.ts      # Redis sliding-window rate limiting
│   ├── permissions.ts     # RBAC helpers (hasModuleAccess)
│   └── auth.ts            # NextAuth config
├── modules/               # Business logic: service.ts, types.ts, validation.ts
└── proxy.ts                # Auth guard for /admin/* + /api/* (Next.js 16 renamed middleware.ts → proxy.ts; no request logging in this file)
bot/                        # Telegram bot (Grammy, separate process)
scripts/
├── seed.ts                # Orchestrator — runs all seeders
└── seeds/<domain>.ts      # Domain-specific seeders
prisma/schema.prisma        # Full DB schema (source of truth for models)
```

---

## RBAC

| Role | Access |
|------|--------|
| `SUPERADMIN` | Everything — all modules, users, monitoring, config |
| `MANAGER` | Own module only (bookings, orders, module settings) |
| `USER` | Public pages, bookings, orders, personal profile |

Manager → module binding: `User (MANAGER) → ModuleAssignment → Module (slug)`
A manager can be assigned to multiple modules. Check via `hasModuleAccess(userId, moduleSlug)`.

Middleware chain: `Rate Limit → Auth → Role → Module Access → Handler → Logging`

Отзыв доступа: исключение из команды, понижение роли, снятие раздела и вливание аккаунта инкрементируют `User.sessionVersion`; полный `jwt`-callback сверяет `sv` через Redis-кэш (TTL 60 с), админка опрашивает `/api/auth/session` (`SessionWatcher`), Mini App сверяет `sv` в своём токене. `src/proxy.ts` остаётся без БД. `getUserAdminSections` — единственный источник разделов (ADMIN: гранты ∪ gazebos/ps-park/inventory). ADR `2026-10-25-team-access-notifications`.

---

## API conventions

**Response shape:**
```typescript
// Success
{ "success": true, "data": {...}, "meta": { "page": 1, "total": 42 } }

// Error
{ "success": false, "error": { "code": "BOOKING_CONFLICT", "message": "..." } }
```

**Endpoints:**
```
GET    /api/{module}          list
GET    /api/{module}/:id      single
POST   /api/{module}          create
PATCH  /api/{module}/:id      update
DELETE /api/{module}/:id      soft delete
GET    /api/{module}/health   module health check
```

**Validation:** all inputs via Zod schemas in `src/modules/{module}/validation.ts`.

**Rate limits (Redis sliding window):**
- Public: 180 req/min per trusted client IP (X-Real-IP от nginx; override — env `RATE_LIMIT_PUBLIC_PER_MIN`)
- Authenticated: 240 req/min per user (override — env `RATE_LIMIT_AUTH_PER_MIN`)
- Admin: no limit
- Каждое срабатывание — семплированный `SystemEvent` (`source: rate-limit`). Лимиты подняты под CGNAT мобильных операторов РФ — см. ADR `2026-07-23-ru-availability-edge-architecture`.

---

## Real module list (source of truth, as of 2026-11-09)

If a module is not here it does not exist.

| Module | Status | Purpose |
|--------|--------|---------|
| `auth` | ✅ | NextAuth, magic-link, providers |
| `monitoring` | ✅ | Health checks, SystemEvent logging |
| `notifications` | ✅ | Channel-agnostic dispatcher (`src/modules/notifications/dispatch/`), `INotificationChannel`, `ChannelRegistry`; Центр уведомлений в Mini App (`catalog.ts`, `webapp-center.ts` — персональные подписки сотрудников по типам событий); идемпотентный релиз-анонс `system.release` (`ReleaseAnnouncement`, `release-notify.ts`) — ADR `2026-08-13-miniapp-role-rebuild`; единый резолвер получателей `audience.ts`/`audience-rules.ts` (рассылка и экраны считают одной функцией, явное «выкл» сильнее любого пути), списки получателей разделов в `ModuleNotificationRecipient`, трекинг-ссылки `/r/[code]` (`NotificationLink`), пропуски доставки (`NotificationDeliverySkip`), статистика доставки и реакций `/admin/notifications/stats`, матрица «кто что получает» `/admin/notifications/matrix` — ADR `2026-10-25-team-access-notifications`; путь «по умолчанию» (`defaultEnabled` в каталоге: все события брони лично каждому с разделом, недельный бизнес-отчёт и сводка звонков в Telegram — суперадмину; явное «выкл» сильнее), еженедельные подсказки и новости бота всем пользователям с фильтром по роли/разделам (`weekly-digest.ts`, `system.weekly_digest`) — ADR `2026-11-09-staff-booking-reports-digest` |
| `gazebos` | ✅ | Gazebo bookings; публичная оферта и акцепт перед оплатой — PRD `2026-08-21` |
| `ps-park` | ✅ | PlayStation Park bookings |
| `cafe` | ✅ | Menu CRUD (+фото), заказы, гостевой QR-чекаут с онлайн-оплатой (ЮKassa, `PaymentSubjectType.ORDER`), статистика продаж — PRD `2026-07-22` |
| `parking` | ✅ | Parking info page |
| `booking` | ✅ | Shared booking core; редакции юридических документов (`offer.ts`), краткие условия отмены (`cancellation-summary.ts`), самообслуживание по токену (`manage.ts`) |
| `rental` | ✅ | Office rental B2B (park: Деловой) — park-aware, parkSlug discriminator |
| `nedelovoy` | ✅ | Office rental B2B (park: НеДеловой) — thin wrapper over rental service; strict-access (SUPERADMIN needs explicit grant) |
| `sauna` | 🟡 stub | Сауны — Module + RBAC slot + `/api/sauna/health`; full implementation deferred |
| `clients` | ✅ | Tenant CRM; движок объединения аккаунтов `merge.ts` (клиенты и сотрудники: превью, роль и права основного, перенос истории, очередь запросов на объединение на `MergeCandidate`) — ADR `2026-10-25-team-access-notifications` |
| `analytics` | ✅ | Aggregate metrics, balance/conversions; first-party воронки (`ProductEvent` — view/slot_selected/cart_item_added/form_started/submitted/paid по gazebos/ps-park/cafe/rental) — ADR `2026-09-16-product-event-funnel-instrumentation` |
| `users` | ✅ | Admin user management; «Исключить из команды» (offboarding без удаления, атомарно, с отзывом сессий `User.sessionVersion`), страница сотрудника `/admin/users/[id]`, таб «Команда» как экран ревью, объяснение блокеров удаления — ADR `2026-10-25-team-access-notifications` |
| `profile` | ⚠️ webapp only | USER contact API (`/api/profile/*`) |
| `tasks` | ✅ | Unified kanban — internal tasks + tenant requests |
| `subscriptions` | ✅ | PS Park prepaid-hour passes |
| `messenger` | ✅ | In-app chat: USER↔Admin (SUPPORT/TOPIC), USER↔USER (shared-connection only), GROUP; Web Push + SSE realtime |
| `feedback` | ✅ | User feedback & office linkage — PRD `2026-04-15`, `2026-04-25` |
| `inventory` | ✅ | Cafe & module stock management — PRD `2026-04-12` |
| `management` | ✅ | Park expense tracking & financial accounting — PRD `2026-04-18` |
| `telephony` | ✅ | Novofon call tracking; owner dashboard и ежедневные сводки в ленте Mini App после 09:00 МСК за вчера (`InAppNotification`, без внешней рассылки) — PRD `2026-10-24-telephony-daily-summary-prd` |
| `telegram-link` | ✅ | Telegram account linking for notification delivery; functionally part of `notifications`; признак «бот запущен/заблокирован» (`TelegramBotContact`), OTP-самопривязка по email (код письмом) со слиянием пустого Telegram-аккаунта, запрос на объединение при конфликте |
| `backups` | ✅ | Backup logging (`BackupLog`); approved in project memory |
| `payments` | ✅ | Online acquiring (YooKassa): `Payment`/`PaymentRefund`, webhook c re-fetch-верификацией, reconciliation-cron, авто/ручные возвраты — PRD `2026-07-09`, план `docs/architecture/2026-07-08-yookassa-integration-plan.md` |

**Юридические документы (не модуль):** тексты редакций — неизменяемые файлы
`content/legal/<documentKey>/vN.md`, публикуются в `OfferVersion` сидером
`scripts/seeds/legal.ts`. Правка опубликованной редакции невозможна: сидер падает
при расхождении хеша — только новая редакция `vN+1`. Рендер — `src/lib/legal/`
(парсер) + `src/components/legal/` (страницы `/oferta`, `/oferta/archive`,
`/oferta/v/[version]`, `/privacy`). Акцепт хранится колонками на `Booking`
(`offerVersionId`, `offerContentHash`, `acceptedOfferAt`, `acceptedIp`,
`acceptedUserAgent`, `acceptedMarketing`) и пишется ТОЛЬКО из тела запроса.
**Ссылку на онлайн-оплату брони без акцепта не выдаёт ни одна поверхность** —
бот и Mini App отдают клиенту `/booking/[token]`, где он видит условия и
подтверждает их сам. Детали и открытые юридические вопросы — PRD
`docs/requirements/2026-08-21-oferta-acceptance-prd.md`.

**Раздел «Для команды» (не модуль):** точка входа сотрудников —
страница `/for-team` (`src/app/(public)/for-team/page.tsx`). На лендинге
(меню и подвал) ссылки нет — убрана по решению владельца; вход — по прямому
адресу или из подвала личного кабинета `/dashboard` (`TeamLink`, только
сотрудникам). Гостя страница уводит на
`/auth/signin?callbackUrl=/for-team` и возвращает обратно после логина.
Каталог сервисов — `src/lib/team-services.ts`; своих данных и API у раздела
нет, это витрина ссылок на `/admin/*`. Видимость карточки обязана совпадать с
гейтом `auth.config.ts → authorized()`, иначе команда упирается в
`/admin/forbidden`: показываем только выданные `getUserAdminSections()`
секции, а `payments`/`feedback`/`notifications` — только SUPERADMIN, пока их
нет в `ADMIN_SECTIONS` (issue #914). Заглушки в каталог не попадают
(`sauna` — issue #915). `callbackUrl` везде нормализуется через
`src/lib/safe-callback-url.ts`: `startsWith("/")` пропускал `//evil.com`.

**Integrations (not modules):**
- `avito` → lives in `src/lib/avito/`, `src/app/api/avito/`, `src/app/admin/avito/`. Does NOT create `src/modules/avito/`. See `docs/architecture/2026-04-28-delovoy-avito-adr.md`.
- `yookassa` → API-клиент in `src/lib/yookassa/` (fetch, Basic auth, Idempotence-Key, чеки 54-ФЗ). Бизнес-логика — в модуле `payments`. Does NOT create `src/modules/yookassa/`.

**Infrastructure services (not modules, no `src/modules/` directory):** none.

---

## Scope guard

1. **No new module** (`src/modules/{slug}/`) without a PRD and an entry in the module list above.
2. **No scope expansion mid-task.** Нашёл нужду в доп. фиче по ходу — заведи issue, не дописывай в текущий PR.
3. **Связанные изменения — одним PR.** Фича целиком с тестами и синком доков, пакет мелких фиксов одной области — один PR, а не десяток по строчке. Маленьким держим риск, а не дифф; каждое изменение в PR — заказанная работа со своим тестом.
4. **CLAUDE.md syncs in the same PR** that adds/removes a module, workflow or process rule. Drift = bug.
5. **Ревью ловит scope creep** — незаявленный модуль или код без своей задачи, а не размер PR.

---

## Процесс

Минимум, который держим. Всё, чего здесь нет, — не часть процесса. Почему так,
см. ADR `docs/architecture/2026-11-09-process-minimum-adr.md`.

- **Ветки:** `main` — прод; работа в `claude/{task}` или `feature/{module}-{feature}`. Прямой пуш в `main` запрещён.
- **Коммиты:** conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- **PR → зелёный CI → мерж руками.** Авто-мержа нет. Мерж в `main` = деплой в прод
  (`ci.yml` собирает образ → `deploy.yml`: blue-green, миграции, сиды; при
  серии мержей выкатывается новейший HEAD).
- **CI на PR** (`ci.yml`): Lint, Test, TypeScript Check (приложение + бот),
  Build Docker Image — required; E2E (Playwright) и Prisma migrations match
  schema — тоже должны быть зелёными.
- **Перед пушем локально:** `npm run lint`, `npm run typecheck`, `npm test`.
- **Релизы:** release-please держит открытый release-PR (версия + CHANGELOG).
  Мержим его руками, когда хотим выпустить версию: после деплоя уходит анонс
  «🚀 Релиз vX» (один раз на версию).
- **Зависимости:** Dependabot раз в месяц, по одному групповому PR (только
  minor+patch) на npm и на GitHub Actions. Мажоры — отдельной задачей.
- **Мониторинг пишет только в Telegram.** GitHub-issues автоматика не создаёт;
  issues заводят люди.
- **AI-агенты** (`.claude/agents/`, команда `/feature`) — помощники для PRD,
  ADR, ревью и QA по желанию, а не обязательный конвейер.

**Workflow-ы** (`.github/workflows/`, всё прочее удалено):

| Группа | Workflow-ы |
|--------|-----------|
| Сборка и выкладка | `ci`, `deploy`, `release`, `deploy-staging` (кнопка в админке) |
| Наблюдение | `site-watchdog` (каждые 5 мин: проба, авто-ремедиация по SSH, Telegram), `deploy-error-budget` (15 мин после деплоя; ×5 ошибок → авто-откат), `disk-space-monitor`, `docker-cleanup` |
| Ручные ops-инструменты (`workflow_dispatch`) | `ops-env`, `ops-nginx`, `ops-docker-ipv6`, `timeweb-manage`, `timeweb-provision`, `run-seed`, `telegram-diagnose`, `infra-audit`, `yookassa-smoke` |

Разовый ops-скрипт или workflow (правка данных на проде, диагностика
инцидента) удаляется следующим же PR после применения — в `main` не копится.

---

## Dev rules

### Code
- TypeScript strict mode always; no `any`
- All API responses via `apiResponse()` / `apiError()`
- All inputs validated via Zod
- Business logic in `src/modules/{module}/service.ts` — route handlers only parse + call service + return response

### New modules
- Register in the `Module` DB table
- Implement `GET /api/{slug}/health`
- Structure: `src/modules/{slug}/service.ts`, `types.ts`, `validation.ts`

### Seeds
- New reference data only via `scripts/seeds/<domain>.ts` + registration in `scripts/seed.ts`
- Idempotency required: use `upsert`/`findFirst+create`. Double run = same state.
- `update` block of upsert: only update descriptive fields. Never overwrite `isActive`, `createdAt`, `config` JSON, prices, or UI-editable fields.
- No PII in orchestrated seeders (they run on every deploy). Real tenants/contracts → separate admin-only script.
- Domain seeder = pure function `(prisma) => Promise<void>`. No `$connect/$disconnect`, no `process.exit`.

### Tests (mandatory, same commit as code)
- Framework: **Vitest** (`npm test` = `vitest run`)
- New `service.ts` function → test in `__tests__/service.test.ts`
- New `validation.ts` schema → test in `__tests__/validation.test.ts`
- New API route → at minimum happy path + one error path test
- New module → full `__tests__/` coverage of business logic
- Mock DB/Redis: `vi.mock('@/lib/db')` — no real DB in unit tests
- `npm test` must stay green after every change
- Схема БД меняется только миграцией (`npx prisma migrate dev --create-only`), не `db push` — CI сверяет миграции со схемой

### VPS / infra facts
- **Перед любыми инфраструктурными выводами или изменениями — получи живые факты о сервере**, не доверяй цифрам из документации (они справочные и устаревают): `timeweb-manage.yml → server-status` (фактический тариф/CPU/RAM), `ops-diagnose` (память, рестарты, OOM-события, cron, TZ), `server-logs` (контейнеры, логи).
- Изменил тариф/топологию сервера — обнови DEPLOYMENT.md в том же PR. Автоматический синк фактов: issue #358.

### Security
- Never return passwords, tokens, or internal IDs in public API responses
- All mutations logged to `AuditLog`
- Rate limiting on all public endpoints
- CORS restricted to allowed domains only

---

## Monitoring

**Level 1 — Infrastructure:** `GET /api/health` — DB, Redis, memory, event-loop lag. Log `CRITICAL` to `SystemEvent` on failure. Live vantage points (ADR `2026-07-23-ru-availability-edge-architecture`): (1) `.github/workflows/site-watchdog.yml` — GitHub runners, probes site + `/api/notifications/health` + client-beacon divergence, auto-remediates via SSH (`scripts/watchdog-remediate.sh`), alerts to Telegram only (no GitHub issues); (2) `scripts/local-watchdog.sh` — per-minute VPS cron; (3) client-error beacon → `SystemEvent` `client-beacon` with `metadata.connection` (wifi vs 4g) — the only RU-mobile vantage.

**Level 2 — Module health:** `GET /api/{module}/health` — req/hr, avg response time, last error. Alert on 5xx spike.

**Level 3 — Business metrics (hourly):** bookings by module, daily revenue, contracts expiring in 30 days.

| Level | Channel |
|-------|---------|
| CRITICAL | Telegram admin group (`log.critical()` → `sendAlert()`, throttled per source, 300s — `src/lib/logger.ts`); if Telegram is unset/unreachable, falls back to email at `CRITICAL_ALERT_EMAIL` via the SMTP adapter (issue #455) |
| ERROR | Telegram admin group |
| WARNING | Dashboard only |
| INFO | DB log (`SystemEvent`) |

# CLAUDE.md — Platform Delovoy

Source of truth for architecture and dev rules. All contributors (human and AI) must follow these conventions.

---

## Stack

| Component | Technology |
|-----------|-----------|
| Frontend + API | Next.js 15 (App Router) |
| ORM | Prisma |
| Database | PostgreSQL >= 16 |
| Cache / queues | Redis >= 7 |
| Auth | NextAuth.js v5 |
| Styles | Tailwind CSS |
| Deploy | Docker Compose on VPS |

- Node.js >= 20 LTS
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
└── middleware.ts           # Auth guard + request logging
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
- Public: 60 req/min per IP
- Authenticated: 120 req/min per user
- Admin: no limit

---

## Real module list (source of truth, as of 2026-04-25)

If a module is not here it does not exist. If it is here but not in the roadmap, it is scope creep.

| Module | Status | Purpose |
|--------|--------|---------|
| `auth` | ✅ | NextAuth, magic-link, providers |
| `monitoring` | ✅ | Health checks, SystemEvent logging |
| `notifications` | ✅ | Channel-agnostic dispatcher (`src/modules/notifications/dispatch/`), `INotificationChannel`, `ChannelRegistry` |
| `gazebos` | ✅ | Gazebo bookings |
| `ps-park` | ✅ | PlayStation Park bookings |
| `cafe` | ✅ | Menu CRUD, orders (hidden from public nav — intentional) |
| `parking` | ✅ | Parking info page |
| `booking` | ✅ | Shared booking core |
| `rental` | ✅ | Office rental B2B (park: Деловой) — park-aware, parkSlug discriminator |
| `nedelovoy` | ✅ | Office rental B2B (park: НеДеловой) — thin wrapper over rental service; strict-access (SUPERADMIN needs explicit grant) |
| `sauna` | 🟡 stub | Сауны — Module + RBAC slot + `/api/sauna/health`; full implementation deferred |
| `clients` | ✅ | Tenant CRM |
| `analytics` | ✅ | Aggregate metrics, balance/conversions |
| `users` | ✅ | Admin user management |
| `profile` | ⚠️ webapp only | USER contact API (`/api/profile/*`) |
| `tasks` | ✅ | Unified kanban — internal tasks + tenant requests |
| `subscriptions` | ✅ | PS Park prepaid-hour passes |
| `feedback` | ❌ scope creep | — |
| `inventory` | ❌ scope creep | — |
| `management` | ❌ scope creep | — |
| `telephony` | ❌ scope creep | — |
| `telegram-link` | ❌ scope creep | — |
| `pipeline-metrics` | ❌ scope creep | — |
| `backups` | ❌ scope creep | — |

**Integrations (not modules):**
- `avito` → lives in `src/lib/avito/`, `src/app/api/avito/`, `src/app/admin/avito/`. Does NOT create `src/modules/avito/`. See `docs/architecture/2026-04-28-delovoy-avito-adr.md`.

---

## Scope guard (enforced for all agents)

1. **No new module** (`src/modules/{slug}/`) without a PRD from `product-owner` and an entry in the module list above.
2. **No scope expansion without PO.** If you discover a need for an extra feature mid-implementation: stop, open an issue, wait for PO.
3. **One PR = one feature.** Fix PRs close exactly one bug with one test.
4. **CLAUDE.md syncs in the same PR** that adds/removes a module or roadmap item. Drift = bug.
5. **Code Reviewer must flag scope creep.** PR touching 5+ modules or adding an unlisted module → NEEDS_CHANGES.

---

## Dev rules

### Git
- Branches: `main` (production), `claude/{task}`, `feature/{module}-{feature}`
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`)
- **No auto-merge** — `claude/**` and `feature/**` go through CI but are not merged automatically
- **Never push directly to `main`** — always PR

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

### Security
- Never return passwords, tokens, or internal IDs in public API responses
- All mutations logged to `AuditLog`
- Rate limiting on all public endpoints
- CORS restricted to allowed domains only

---

## Monitoring

**Level 1 — Infrastructure (every 30s):** `GET /api/health` — DB, Redis, disk. Log `CRITICAL` to `SystemEvent` on failure; Telegram alert after 2 consecutive failures.

**Level 2 — Module health:** `GET /api/{module}/health` — req/hr, avg response time, last error. Alert on 5xx spike.

**Level 3 — Business metrics (hourly):** bookings by module, daily revenue, contracts expiring in 30 days.

| Level | Channel |
|-------|---------|
| CRITICAL | Telegram + SMS to superadmin |
| ERROR | Telegram admin group |
| WARNING | Dashboard only |
| INFO | DB log (`SystemEvent`) |

# ADR: Ускорение цикла разработки — Dev Velocity Infrastructure

**Date:** 2026-05-21
**Status:** Accepted
**Author:** System Architect (Elliott)

---

## Контекст

Цикл разработки до этого ADR: `код → push в main → CI (~30 мин) → deploy в прод → ручная проверка глазами`.

Причины замедления:
1. На локалке пустая БД — нечего тестировать для большинства модулей.
2. Ключевые фичи (мессенджер SSE, Web Push, Telegram-бот, Avito, телефония) требуют боевого окружения.
3. Staging существует в коде (PR #146 merged 2026-04-21), но физически не запущен — нет DNS, cron-обновления, secrets.
4. Баги доходят до клиентов, потому что единственная среда с реальными данными — прод.

**Цель:** сократить time-to-test-feature с нескольких часов до < 2 минут для локального dev; добавить pre-prod safety net через staging; ускорить hotfix-цикл.

---

## Решение

### Tier 1 — Локальный dev с реалистичными данными

#### Sanitized prod-dump pipeline

Вместо расширения seed-файлов для всех 20+ модулей — используем реальные prod-данные с маскировкой PII.

**Стратегия маскировки — allowlist:**
Маскируются только явно перечисленные поля. Новая колонка в `User`/`Tenant` автоматически считается PII до явного одобрения в `sanitize-dump.sh`. Это предотвращает утечки при добавлении новых полей.

Маскируемые данные:
- `User`: email → `id@dev.local`, phone/telegramId/vkId/passwordHash → NULL, name → `Dev User <id>`
- `Tenant`: phone/email → синтетические, contactName/inn/legalAddress → NULL
- `MessengerMessage.body` → `[redacted]` (структура тредов сохраняется)
- Таблицы `AuditLog`, `SystemEvent`, `PushSubscription`, `TelegramLink`, `CallLog` — TRUNCATE

**Файлы:**
- `scripts/sanitize-dump.sh` — принимает raw dump, возвращает sanitized dump через throwaway DB
- `scripts/db-pull-prod.sh` — S3 → sanitize → pg_restore в локальную БД

**Safeguards:**
- `db-pull-prod.sh` отказывает при `NODE_ENV=production`
- Проверяет что `DATABASE_URL` указывает на localhost/127.0.0.1

#### Dev overlay seed

`scripts/seeds/dev-overlay.ts` — поверх любой БД создаёт предсказуемые dev-аккаунты через upsert:

| Email | Пароль | Роль |
|---|---|---|
| admin@local | admin | SUPERADMIN |
| manager@local | manager | MANAGER (gazebos, ps-park) |
| user@local | user | USER |

Активируется только при `DEV_OVERLAY=1` env. No-op в production.
Зарегистрирован в `scripts/seed.ts` как последний шаг.

#### dev-start.sh auto-seed

После `npm run dev:full` скрипт проверяет наличие SUPERADMIN. Если 0 строк — автоматически запускает `DEV_OVERLAY=1 npm run db:seed`. Гарантирует что свежий `docker compose up` всегда даёт рабочий логин.

#### npm scripts

```json
"db:pull-prod":  "bash scripts/db-pull-prod.sh",
"db:sanitize":   "bash scripts/sanitize-dump.sh",
"db:reset:dev":  "docker compose down -v && dev:docker + migrate + db:pull-prod + DEV_OVERLAY=1 db:seed"
```

### Tier 2 — Staging + E2E

#### Staging физически

Staging stack (docker-compose.staging.yml) уже готов. Недостающее: DNS + nginx + secrets + cron.

После разворачивания по `docs/runbooks/2026-05-21-staging-bootstrap.md`:
- `staging-refresh.sh` (cron 03:30 UTC): prod dump → sanitize → restore в staging
- Staging всегда содержит вчерашние prod-данные (обезличенные)
- Используется для E2E тестов и smoke-проверки перед merge

#### Playwright E2E против staging

Playwright тесты запускаются против `staging.delovoy.app` из CI после deploy-staging. Не локально (дорого по времени) и не против прода.

Покрытие (по приоритету):
1. `booking-gazebo.spec.ts` — auth → slot selection → confirmation
2. `rental-b2b.spec.ts` — заявка → manager view → tasks
3. `messenger-support.spec.ts` — SUPPORT-чат → SSE delivery
4. `auth-magic-link.spec.ts` — magic link через Resend sandbox
5. `cafe-order.spec.ts` — regression-pin

CI pipeline: новый job `e2e-staging` после `deploy-staging`. Блокирует `deploy-prod` при провале, не блокирует merge в main.

#### Hotfix lane

Тег `hotfix-*` триггерит специальный workflow: lint + unit + build + deploy, без E2E. Для срочных фиксов продакшн-критикалов.

```bash
npm run hotfix  # git tag hotfix-YYYYMMDD-HHMMSS && git push --tags
```

---

## Что НЕ делаем

| Решение | Причина отклонения |
|---|---|
| Расширение seeds на все 20+ модулей | Sanitized prod-dump полностью замещает; seed будет деградировать |
| testcontainers integration layer | Vitest unit + Playwright против staging достаточно; лишний maintenance |
| Preview-per-PR | Overshoot для команды из 1-2 человек |
| Отдельный dev Telegram-бот | TG тестируется на staging; локально бот не нужен |
| Avito sandbox | Avito его не предоставляет; mock в `src/lib/avito/__mocks__/` для unit + ручное на staging |

---

## Trade-offs

| Аспект | До | После |
|---|---|---|
| Получить реалистичные данные для dev | Невозможно без прода | `npm run db:pull-prod` (~2-5 мин) |
| Проверить что фича работает | Deploy в прод (~30 мин + ручная проверка) | `npm run dev` с pull-prod данными (<2 мин) |
| Smoke-test перед merge | Нет | staging.delovoy.app (обновляется ежедневно) |
| Regression-тесты | Только unit с моками | Playwright E2E против staging |
| Hotfix | Тот же CI (~30 мин) | hotfix lane (<5 мин) |

**Главный риск:** PII-утечка если в схему добавлена новая PII-колонка и она не включена в allowlist `sanitize-dump.sh`.

**Mitigation:** при добавлении новой таблицы/колонки с PII — PR must update `sanitize-dump.sh`. Code reviewer проверяет.

---

## Verification

После Tier 1:
- `npm run db:reset:dev` → локальная БД с prod-данными за < 5 мин
- `npm run dev` → логин `admin@local / admin` → все модули с данными
- `dev-start.sh` не падает на пустой БД

После Tier 2:
- Открыть `https://staging.delovoy.app` → свежая копия прода
- PR CI: job `e2e-staging` зелёный перед merge в прод
- `npm run hotfix` → прод через < 5 мин

**Метрики** (отслеживать в `docs/metrics/dev-velocity.md`):
- Lead-time commit → prod: цель < 15 мин (обычный), < 5 мин (hotfix)
- Time-to-test-feature: цель < 2 мин
- Prod incidents/month: baseline → -50% через 2 месяца

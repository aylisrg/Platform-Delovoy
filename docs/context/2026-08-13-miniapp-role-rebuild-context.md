# Context Log — 2026-08-13-miniapp-role-rebuild

**Задача (от владельца):** Полный ребилд и переосмысление Telegram Mini App (@DelovoyPark_bot):

1. **Уровни доступа.** Обычный USER видит только новости, уведомления, кафе и простые сервисы. ADMIN/MANAGER дополнительно получают выбор типов уведомлений, которые к ним пойдут, — в зависимости от их прав доступа.
2. **Дубли системных сообщений.** Бот шлёт владельцу несколько дублей одного события разными словами — вылечить.
3. **Дизайн.** Текущий дизайн Mini App плох — полная переработка UI/UX.

Ветка: `claude/delovoypark-miniapp-rebuild-gtnc5p`.

---

## Разведка — синтез (3 отчёта, 2026-08-13)

### A. Текущий Mini App (`src/app/webapp/`)

- **Ролей нет.** `User.role` доезжает до JWT (`/api/webapp/auth`) и контекста `TelegramProvider`, но единственный потребитель — текстовая строка в `profile/page.tsx`. Ни одна страница/таб/роут не ветвится по роли. Админ-поверхности нет вообще.
- **Два несовместимых механизма auth.** Основной: `initData` HMAC → 24h JWT (in-memory, без refresh; `src/lib/webapp-auth.ts`, `src/lib/telegram-webapp.ts`). Но `/webapp/messenger*` и `/api/webapp/events/stream` требуют NextAuth-cookie — у чистого Mini App юзера её нет, таб «Чаты» ведёт на redirect в `/webapp/link-account`.
- **Привязка аккаунта сломана.** `/api/webapp/auth` авто-создаёт `User` по `telegramId` ДО привязки → `requestLink()` кидает `TELEGRAM_ALREADY_LINKED` (409). `needsLinking` вычисляется, но никем не читается. OTP только `console.log`-ится (`src/modules/telegram-link/service.ts:129`).
- **Мёртвый код:** `WebappPushOptIn.tsx`, `PWAInstallBanner.tsx` — реализованы, никем не импортируются; SW для `/webapp` никогда не регистрируется → offline-страница не работает; `bot/keyboards/gazebos.ts` — мёртвые callback'и.
- **Дизайн:** захардкоженные градиентные карточки с эмодзи, статичные `--tg-*` переменные со светлыми фолбэками (не привязаны к themeParams Telegram), 6 жёстких табов, эмодзи вперемешку с SVG, контент главной зашит в код.
- **Прочие дефекты:** нет rate limit на `/api/webapp/auth`; fallback-секрет `"webapp-secret"` в 3 файлах; hash-сравнение initData без timingSafeEqual; страницы gazebos/[id] и ps-park/[id] дублированы на ~95%; 402 `PENALTY_CONFIRMATION_REQUIRED` при отмене не обрабатывается на клиенте (юзер не может завершить позднюю отмену); naive TZ (`toISOString().split("T")[0]`); вложенные `<html>/<body>` (webapp/layout внутри корневого layout) — источник гонки bootstrap.

### B. Бот (`bot/`)

- grammY, long-polling, отдельный контейнер (docker-compose `bot`, 256MB, healthcheck `/tmp/bot-healthy`).
- Mini App запускается ТОЛЬКО инлайн-кнопками `web_app` (`bot/handlers/welcome.ts` mainMenuKeyboard, `/start webapp`). `setChatMenuButton`/`setMyCommands` нигде не вызываются — menu button настроен вручную в BotFather.
- **Весь букинг-домен продублирован** бот vs Mini App: два параллельных API (`/api/bot/*` с `x-bot-token` == BOT_TOKEN, plain `===`; `/api/webapp/*` с JWT), обе ветки зовут те же сервисы. Кафе — только в боте (read-only, заказ уводит на сайт).
- Ролевые гейты в боте: `getTeamUser()` в `team-settings.ts` пускает SUPERADMIN|MANAGER (ADMIN забыт!) к `/settings` — единственный тумблер «🚀 Релизы ВКЛ/ВЫКЛ» (`NotificationPreference.notifyReleases`). Обратный гейт: `ADMIN_NO_BOT_LOGIN` — role !== USER не может логиниться через бот в web (это про браузер, НЕ про Mini App: `/api/webapp/auth` админов не блокирует).
- `bot/handlers/alerts.ts` (`routeAlert`) — мёртвый код, никем не вызывается.

### C. Уведомления — три параллельных стека, не знающих друг о друге

1. **dispatch/** (современный, правильный): `INotificationChannel`, `ChannelRegistry`, `dispatcher.ts` → `OutgoingNotification` (dedupKey, retry, fallback, quiet hours, prefs `NotificationEventPreference`); cron `/api/cron/process-outgoing` ежеминутно.
2. **legacy `service.ts notify()`**: `EVENT_ROUTING` (booking.*, order.*, contract.*, payment.* — БЕЗ system.*/release.*), `NotificationLog`, `NotificationPreference`, `telegramAdapter` (другой интерфейс).
3. **direct fire-and-forget**: ~20 путей — raw curl из CI (`deploy.yml`, watchdogs, миграции), `sendTelegramAlert` (`src/lib/telegram-alert.ts`), ДВА байт-идентичных `sendAlert` (`bot/index.ts:58` и `src/lib/notifications.ts:16`), `release-notify.ts` (мимо всех дедупов). Все деплой/системные сообщения живут здесь — без очереди, prefs, dedup, лога.

Таксономии: `EVENT_ROUTING` (`events.ts`), `ROUTING_CATEGORIES` (`routing-categories.ts` — есть неиспользуемая категория `system`!), `EventLevel`, `NotificationChannelKind`.

### D. Точная механика дублей (ранжировано)

1. **Guard из #482 (9d9bb95) — мёртвый код.** `deploy.yml:703` проверяет `docs/releases/${VERSION}-*.md`, но архивный `git push` в защищённый `main` всегда отваливается (`|| true` глотает) → файла никогда нет → **каждый деплой (не только релизный) заново анонсирует «🚀 Новый релиз v2.11.0»**. Доказано: 0 коммитов `chore(releases): archive`, 25 релизов в CHANGELOG.
2. **Два независимых анонсера на один деплой:** `deploy.yml:673` «✅ Deploy OK» → админ-группа; `deploy.yml:685` → `/api/admin/release-notify` → `sendReleaseNotification()` → личка каждому SUPERADMIN/MANAGER с `notifyReleases=true`. Владелец в обоих адресных пространствах → 2 сообщения разными словами по построению.
3. **Двойной триггер deploy.yml** (`workflow_run` + `push`), `cancel-in-progress: false` → второй ран становится в очередь и ВЫПОЛНЯЕТСЯ → всё ×2 с разбегом в минуты.
4. **`sendReleaseNotification()` мимо dispatch()**: нет dedupKey, нет OutgoingNotification, нет серверного реестра «версия X уже анонсирована».
5. **dedup.ts body-sensitive**: sha256 включает title+body → одно событие разными словами проходит дважды.
6. **Watchdog-стек**: на один инцидент — local-watchdog + site-watchdog (каждые 5 мин, без cooldown на Telegram-шаге) + notify-slow + beacon-divergence + два recovery.
7. **SystemEvent → Telegram мёртв** (`routeAlert` без вызовов) → каждая подсистема отрастила свой ad-hoc sender.

### E. Существующий фундамент (переиспользовать, не городить новое)

- Prisma: `NotificationEventPreference` (userId+eventType, enabled, channelKinds, quiet hours), `NotificationGlobalPreference`, `UserNotificationChannel`, `OutgoingNotification` (dedupKey), `BroadcastCampaign`, `NotificationPreference` (legacy: enableBooking/Order/Reminder + notifyReleases).
- RBAC: `Role` (SUPERADMIN|ADMIN|MANAGER|USER), `AdminPermission` (section), `ModuleAssignment`, хелперы `src/lib/permissions.ts` (`getUserAdminSections`, `hasAdminSectionAccess`, `getUserModules`, ADMIN_SECTIONS).
- `Module.config`: telegramAdminChatId, telegramChannelId, notificationRecipients[].

### F. Ограничения

- Scope guard CLAUDE.md: новый модуль — только с PRD + записью в списке модулей; PR на 5+ модулей → NEEDS_CHANGES; CLAUDE.md синкается в том же PR.
- Ветка `claude/**` → авто-мерж при зелёном CI + PASS от reviewer и QA (гейт `issue-queue.ts gate`). Миграции — только аддитивные (деструктивные держит гейт).
- Тесты обязательны в том же коммите (Vitest, mock DB/Redis).
- Пайплайн: PO → Architect → Developer (основная сессия) → Reviewer → QA (`.claude/commands/feature.md`).

---

## PO — Ключевые решения

_(заполняет product-owner)_

## Architect — Ключевые решения

_(заполняет system-architect)_

## Developer — Ключевые решения

_(заполняет developer)_

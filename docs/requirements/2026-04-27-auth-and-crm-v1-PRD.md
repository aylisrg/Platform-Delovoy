# PRD: Великая починка логина + CRM v1

**Версия:** 1.1 (обновлено 2026-04-28, Wave 2 scope)
**Автор:** Product Owner
**Статус:** In Progress (Wave 1 Done, Wave 2 Next)

---

## Проблема

Текущая система авторизации имеет несколько критических проблем:

1. **Три устаревших OAuth-провайдера** (Yandex, Google, VK) создают технический долг — поддерживаются API-ключи, которые не используются реальными пользователями. Yandex OAuth потерял поддержку в next-auth v5.
2. **Telegram Login Widget** — устаревший flow, требует браузерного JS, не работает в Telegram Mini App, не создаёт `UserNotificationChannel` для бота.
3. **Нет auth-телеметрии** — события логина/выхода/ошибок не попадают в `AuditLog`, аномалии (brute force, спам) не детектируются.
4. **Дублирующиеся пользователи** — один человек может создать несколько аккаунтов через разные провайдеры. Нет механизма auto-merge и ручного слияния.
5. **CRM арендаторов разрозненна** — нет единого списка, нет привязки пользователя к арендатору.

---

## Решение

Четырёхволновый рефакторинг авторизации + базовый CRM для арендаторов:

- **Wave 1** — чистая схема, удаление мусорных провайдеров, фикс merge-логики
- **Wave 2** — Telegram bot deep-link как единственный основной способ входа + auth-телеметрия
- **Wave 3** — CRM admin pages, карточка пользователя, manual merge UI
- **Wave 4** — VK Messenger login (отложен до верификации сообщества)

---

## Целевая аудитория

- **USER** (клиент парка) — упрощённый и надёжный вход через Telegram, без OAuth-форм
- **SUPERADMIN** — видимость всех auth-событий и дублей в AuditLog, ручное слияние аккаунтов

---

## Эпики и волны

### Wave 1 — DONE (смержено в `172e963`)

| Эпик | Описание |
|------|----------|
| EPIC-CRM-1 | Prisma schema: `MergeCandidate`, `UserNotificationChannel` по ADR |
| EPIC-AUTH-4 | Удалить Yandex и Google OAuth провайдеры из кода |
| EPIC-CRM-6.1 (bagfix) | Исправить атомарность `mergeClients` — race condition при одновременном логине |

---

### Wave 2 — СЕЙЧАС (следующий PR)

| Эпик | Описание | Приоритет |
|------|----------|-----------|
| EPIC-AUTH-1 | Telegram bot deep-link login — новый основной flow | Must |
| EPIC-AUTH-3 | Email magic-link UI — только UI-обновление (backend без изменений) | Should |
| auth.* telemetry | Логирование auth-событий в `AuditLog` | Must |

**Фокус**: Telegram deep-link — единственный способ входа с реальным ботом. Email остаётся как fallback. VK и CRM admin в Wave 2 не входят.

---

### Wave 3 — ПОЗЖЕ

| Эпик | Описание |
|------|----------|
| EPIC-CRM-2 | Admin: список пользователей с фильтрами (роль, провайдер, дубли) |
| EPIC-CRM-3 | Admin: карточка пользователя (история auth-событий, каналы, договоры) |
| EPIC-CRM-4 | RBAC scoping — менеджер видит только своих арендаторов |
| EPIC-CRM-6 | Manual merge UI + endpoint `/api/admin/users/merge` |

---

### Wave 4 — ОТЛОЖЕН (BLOCKED)

| Эпик | Описание | Блокер |
|------|----------|--------|
| EPIC-AUTH-2 | **VK Messenger login** (через сообщество с verified status, scope `messages`, чтобы можно было писать в личку) | BLOCKED on VK community verification — займёт 2-4 недели |

VK login в любом виде (VK ID OAuth, VK Notify) **не реализуется до Wave 4**. Текущий `VK()` provider в `src/lib/auth.ts` остаётся на месте как legacy-заглушка.

---

## User Stories

### EPIC-AUTH-1: Telegram bot deep-link login

**US-1: Вход через Telegram для нового пользователя**
- **Как** посетитель сайта
- **Я хочу** нажать "Войти через Telegram" и получить сообщение от бота с кнопкой подтверждения
- **Чтобы** войти без паролей и OAuth-форм

**Acceptance Criteria:**

- [ ] AC-1: Кнопка "Войти через Telegram" — **primary** на странице `/signin`, email fallback располагается под разделителем "Другие способы"
- [ ] AC-2: По нажатию фронтенд вызывает `GET /api/auth/telegram/start` → получает одноразовый `token` (TTL 10 мин) и URL вида `https://t.me/<BOT_USERNAME>?start=<token>`
- [ ] AC-3: Rate limit на `/api/auth/telegram/start`: не более 5 запросов/мин с одного IP
- [ ] AC-4: Пользователь переходит по URL — бот получает `/start <token>` и верифицирует токен через `POST /api/auth/telegram/callback`
- [ ] AC-5: Rate limit на `/api/auth/telegram/callback`: не более 10 запросов/мин с одного IP
- [ ] AC-6: После успешного callback страница `/signin` (polling `GET /api/auth/telegram/status?token=<token>`, не более 30 запросов/мин на token+IP) автоматически завершает сессию NextAuth
- [ ] AC-7: Если пользователь с данным `telegramId` **не существует** — создаётся новый `User` с `role: USER`
- [ ] AC-8: Если пользователь **существует** (по `telegramId`) — выполняется обычный вход
- [ ] AC-9: Auto-merge при входе: если новый TG-юзер совпал по `telegramId` ИЛИ `phone` с существующим — слияние выполняется атомарно, пишется `AuditLog` action `auth.merge.auto`
- [ ] AC-10: Если совпало >1 кандидата — пишем запись в `MergeCandidate`, `auth.merge.conflict`; автоматически НЕ мержимся; ручной merge — Wave 3
- [ ] AC-11: После первого входа через бот — создаётся `UserNotificationChannel` с `channel: TELEGRAM` и реальным `chatId`
- [ ] AC-12: Сразу после создания сессии бот отправляет приветственное сообщение в Telegram юзеру
- [ ] AC-13: Старый Telegram Login Widget UI **удалён** со страницы `/signin`. Backend Credentials provider `id: "telegram"` остаётся в коде 30 дней как fallback (per ADR §10), затем удаляется отдельным PR
- [ ] AC-14: Если `TELEGRAM_BOT_TOKEN` не задан — кнопка "Войти через Telegram" скрыта, отображается только email fallback

**AC, согласованные с ADR §§1, 6, 9, 10:**

- [ ] AC-15 (ADR §1): deep-link token хранится в Redis с TTL 10 мин, payload = `{ userId: null, ip, createdAt }`
- [ ] AC-16 (ADR §6): вся логика deep-link flow в `src/modules/auth/telegram-deep-link.ts`, route handlers только оркестрируют
- [ ] AC-17 (ADR §9): автоматическое слияние только если единственный кандидат; при конфликте — `MergeCandidate` + `auth.merge.conflict` в AuditLog
- [ ] AC-18 (ADR §10): Credentials provider `id: "telegram"` (Login Widget) удаляется через 30 дней отдельным коммитом; до удаления — `@deprecated` комментарий в коде

---

### EPIC-AUTH-3: Email magic-link UI rework

**US-2: Обновлённый UI для email-входа**
- **Как** пользователь без Telegram
- **Я хочу** видеть email-ввод как вторичный способ входа под разделителем
- **Чтобы** понимать что Telegram — основной способ, email — запасной

**Acceptance Criteria:**

- [ ] AC-1: Email input и кнопка "Получить ссылку" перенесены в секцию "Другие способы" ниже Telegram-кнопки
- [ ] AC-2: Backend `/api/auth/verify-email` и magic-link nonce логика не изменяются
- [ ] AC-3: UX magic-link flow (отправка письма, экран ожидания, подтверждение) работает идентично текущей реализации

---

### Auth Telemetry

**US-3: Логирование auth-событий**
- **Как** суперадмин
- **Я хочу** видеть в AuditLog все попытки входа, выхода и авто-слияния
- **Чтобы** детектировать аномалии и расследовать инциденты

**Acceptance Criteria:**

- [ ] AC-1: `auth.signin.attempt` — пишется при каждой попытке логина (до проверки)
- [ ] AC-2: `auth.signin.success` — пишется при успешном входе (userId, provider, ip)
- [ ] AC-3: `auth.signin.failure` — пишется при неудачном входе (причина: bad_token / user_not_found / rate_limited)
- [ ] AC-4: `auth.signout` — пишется при выходе (userId, sessionDuration)
- [ ] AC-5: `auth.merge.auto` — пишется при успешном auto-merge (fromUserId, toUserId)
- [ ] AC-6: `auth.merge.conflict` — пишется при конфликте (telegramId, candidateIds)
- [ ] AC-7: `auth.merge.skipped_admin` — если пользователь с ролью SUPERADMIN/MANAGER — авто-merge не выполняется, логируется причина
- [ ] AC-8: Все записи `AuditLog` для auth содержат `entity: "User"`, `entityId: userId` (или null при attempt до создания)

---

## Вне скоупа

### Глобально (все волны)
- Платёжные интеграции
- Мобильное приложение
- Push-уведомления через браузер (Web Push)

### Вне скоупа Wave 2 (специфично)
- **VK provider в любом виде** — отложен до Wave 4, blocked on VK community verification
- **CRM admin pages** (список пользователей, карточка) — отложены до Wave 3
- **Manual merge UI** — отложен до Wave 3
- **Endpoint `/api/admin/users/merge`** — Wave 3
- **Очистка тестовых пользователей** — отдельная housekeeping задача вне волн
- **IMAP email inbound** — Phase 5.4 (tasks module)
- **Изменения backend magic-link логики** — только UI-ребрендинг

---

## Приоритет (MoSCoW)

| Эпик | Категория | Обоснование |
|------|-----------|-------------|
| EPIC-AUTH-1 (Telegram deep-link) | Must | Без Telegram-логина нет `UserNotificationChannel`, уведомления не работают |
| Auth telemetry | Must | Без AuditLog нельзя детектировать атаки и расследовать инциденты |
| EPIC-AUTH-3 (email UI) | Should | UX-improvement, backend уже работает |
| EPIC-CRM-2,3,4 (Wave 3) | Could (сейчас) | Нужно, но не блокирует основной flow |
| EPIC-AUTH-2 (VK, Wave 4) | Won't (сейчас) | Заблокировано внешним процессом верификации |

---

## Метрики успеха

| Метрика | Базовое (сейчас) | Целевое (после Wave 2) |
|---------|-----------------|----------------------|
| % входов через Telegram (реальный бот) | 0% | > 70% новых сессий |
| Auth-события в AuditLog | 0 | 100% событий логируются |
| `UserNotificationChannel(TELEGRAM)` у новых юзеров | 0% | 100% (при входе через TG) |
| Время обнаружения brute-force атаки | Вручную (никогда) | < 5 мин (AuditLog аномалия) |

---

## Wave 2 — Definition of Done

Этот раздел — финальный чеклист перед передачей PR в ревью. Разработчик подтверждает каждый пункт:

- [ ] Кнопка "Войти через Telegram" работает с реальным ботом (не Login Widget)
- [ ] Юзер после первого логина имеет `UserNotificationChannel(TELEGRAM)` с настоящим `chatId`
- [ ] Сразу после авторизации бот шлёт приветственное сообщение
- [ ] В UI signin Telegram-кнопка primary, email-fallback под "Другие способы"
- [ ] Старый Login Widget UI удалён с `/signin`, backend Credentials("telegram") остаётся 30 дней (per ADR §10)
- [ ] Auth events логируются в AuditLog: `auth.signin.attempt/success/failure`, `auth.signout`, `auth.merge.auto/manual/conflict/skipped_admin`
- [ ] Auto-merge при логине: если новый TG-юзер совпал по `telegramId`/`phone` с единственным существующим — мерджимся атомарно, пишем `auth.merge.auto`
- [ ] Если совпало >1 кандидата — пишем в `MergeCandidate`, `auth.merge.conflict`; ручной merge остаётся на Wave 3
- [ ] Rate limits: start 5/мин/IP, status 30/мин/(token+IP), callback 10/мин/IP
- [ ] 0 регрессий по существующему `mergeClients` (Wave 1 тесты остаются зелёными)
- [ ] `npm test` зелёный — unit-тесты для `telegram-deep-link.ts` покрывают happy path + token expired + rate limit exceeded + auto-merge + conflict
- [ ] VK provider в коде не трогается (остаётся как есть)

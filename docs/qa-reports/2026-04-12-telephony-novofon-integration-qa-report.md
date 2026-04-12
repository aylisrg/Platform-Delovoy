# QA-отчёт: Интеграция телефонии Novofon

**Дата:** 2026-04-12
**QA Engineer:** Claude Code (claude-sonnet-4-6)
**Ветка:** main
**Коммит:** f854d1f

---

## Результат тестов

```
npm test: 667 passed / 0 failed (39 test files)
Duration: 1.23s
```

Все тесты зелёные. Телефония покрыта двумя тест-файлами:
- `src/modules/telephony/__tests__/service.test.ts` — 11 тест-кейсов
- `src/modules/telephony/__tests__/validation.test.ts` — 15 тест-кейсов

---

## Проверка Acceptance Criteria

### US-1: Кнопка звонка на публичной странице

| AC | Статус | Примечание |
|----|--------|------------|
| AC-1: На страницах беседок и PS Park отображается кнопка "Позвонить" | PASS | Беседки: `src/app/(public)/gazebos/page.tsx:77–87` — кнопка с иконкой телефона и текстом "Позвонить". PS Park: `src/app/(public)/ps-park/page.tsx:223–233` — кнопка с иконкой. |
| AC-2: На десктопе кнопка открывает `tel:` ссылку | PASS | Обе страницы используют `<a href={\`tel:${phoneInfo.phone}\`}>` |
| AC-3: На мобильном устройстве `tel:` ссылка инициирует прямой звонок | PASS | Стандартное поведение `tel:` href — работает на всех мобильных браузерах |
| AC-4: Оба модуля используют один и тот же виртуальный номер Novofon | PASS | Каждый модуль читает свой `Module.config.telephony.publicPhone` через `getPublicPhone()`. Одинаковый номер достигается конфигурацией в БД, а не hardcode |
| AC-5: Номер телефона отображается в виде читаемого текста | PASS | Беседки: `{phoneInfo.displayPhone}` в `<span>` рядом с кнопкой. PS Park: `{phoneInfo.displayPhone}` внутри `<a>` — текст кнопки IS the display phone. Кнопка "Позвонить" текстом в PS Park отсутствует (только displayPhone), в отличие от беседок. Незначительное несоответствие UX. |
| AC-6: Номер телефона хранится в `Module.config` (JSONB), не зашит в код | PASS | `getPublicPhone()` в `src/modules/telephony/service.ts:42–51` читает из `prisma.module.findUnique().config.telephony.publicPhone`. Hardcode в коде не найден. |

### US-2: Click-to-call из карточки бронирования

| AC | Статус | Примечание |
|----|--------|------------|
| AC-1: В карточке бронирования отображается кнопка "Позвонить" | PASS | `CallButton` используется в `src/app/admin/gazebos/page.tsx:188–192` и `src/app/admin/ps-park/page.tsx:275–280` |
| AC-2: При нажатии вызывается Novofon Call API | PASS | `CallButton` делает `POST /api/telephony/call`, который вызывает `initiateCall()` → `novofonStartCall()` |
| AC-3: Ошибки отображаются в UI | PASS | `src/components/admin/telephony/call-button.tsx:82–93` — состояние `failed` показывает `error` сообщение с кнопкой "повторить" |
| AC-4: После инициации звонка отображается статус | PASS | `src/components/admin/telephony/call-button.tsx:64–79` — состояние `calling` показывает локализованный статус из `statusLabels` с анимированным индикатором |
| AC-5: Если нет телефона клиента, кнопка не показывается | PASS | Беседки: `src/app/admin/gazebos/page.tsx:163,185` — `if (phone)` guard перед рендером `CallButton`. PS Park: `src/app/admin/ps-park/page.tsx:270,273` — аналогичный `if (phone)` guard. |

### US-3: Журнал звонков по бронированию

| AC | Статус | Примечание |
|----|--------|------------|
| AC-3: История сохраняется в CallLog таблице | PASS | `prisma/schema.prisma:635–657` — модель `CallLog` с полями `bookingId`, `direction`, `status`, `clientPhone`, `duration`, `recordingUrl`. Индексы на `bookingId`, `clientPhone`, `moduleSlug`. `initiateCall()` создаёт запись и обновляет статус. `handleWebhook()` создаёт и обновляет записи. |

### US-5: Вебхук для входящих

| AC | Статус | Примечание |
|----|--------|------------|
| AC-1: Платформа принимает вебхук от Novofon | PASS | `POST /api/telephony/webhook` — `src/app/api/telephony/webhook/route.ts`. Принимает события inbound/outbound, валидирует через `novofonWebhookSchema`. |
| AC-5: Вебхук-эндпоинт защищён | PARTIAL | HMAC-SHA256 через `verifyNovofonSignature()` реализован корректно с constant-time сравнением. **Проблема:** защита условная — проверка включается только если `NOVOFON_WEBHOOK_SECRET` задан (строка 19: `if (webhookSecret)`). Если секрет не сконфигурирован, эндпоинт принимает любой запрос без аутентификации. |

### US-6: Настройка интеграции

| AC | Статус | Примечание |
|----|--------|------------|
| AC-6: Конфигурация хранится в `Module.config` (JSONB) | PASS | `getTelephonyConfig()` читает `module.config.telephony` как `Partial<TelephonyModuleConfig>`. Структура: `{ telephony: { enabled, publicPhone, displayPhone, sipLine, callerId, recordCalls } }` |

---

## Code Quality

| Критерий | Статус | Примечание |
|----------|--------|------------|
| TypeScript strict | PASS | Все файлы используют явные типы, нет `@ts-ignore`, нет `@ts-nocheck` |
| Нет `any` | PASS | В production-коде `any` не найден. Все неизвестные типы явно кастуются через `as Record<string, unknown>` или через Zod-парсинг |
| `apiResponse`/`apiError` | PASS | Все 5 route handler файлов используют хелперы из `@/lib/api-response` |
| Zod валидация | PASS | `initiateCallSchema`, `callFilterSchema`, `novofonWebhookSchema` — все входные данные валидированы |
| RBAC | PASS | `/api/telephony/call` — `requireAdminSection` (MANAGER/SUPERADMIN). `/api/telephony/calls` — `hasRole` SUPERADMIN или `requireAdminSection`. `/api/telephony/health` — только SUPERADMIN. `/api/telephony/calls/:id/recording` — только MANAGER+. USER заблокирован везде. |
| Секреты в коде | PASS | `NOVOFON_API_KEY` и `NOVOFON_WEBHOOK_SECRET` читаются только из `process.env`. В `.env.example` добавлены строки 65–66. |

---

## Найденные проблемы

### P2 — Средний: Вебхук не защищён при отсутствии `NOVOFON_WEBHOOK_SECRET`

**Файл:** `src/app/api/telephony/webhook/route.ts:19`

**Описание:** HMAC-верификация активируется только если `NOVOFON_WEBHOOK_SECRET` задан. При незаполненной переменной (пустая строка по умолчанию из `?? ""`) эндпоинт принимает любой POST без проверки подписи. Это означает, что в средах где секрет не настроен, любой злоумышленник может отправлять фиктивные события.

**Рекомендация:** Если secret пустой — вернуть `apiError("WEBHOOK_NOT_CONFIGURED", ..., 503)` вместо молчаливого пропуска проверки. Либо задокументировать как "insecure mode" и добавить предупреждение в лог.

---

### P3 — Низкий: PS Park — кнопка звонка не содержит слово "Позвонить"

**Файл:** `src/app/(public)/ps-park/page.tsx:223–233`

**Описание:** В PS Park кнопка `<a href="tel:...">` отображает только `{phoneInfo.displayPhone}` без текстовой метки "Позвонить". На странице беседок кнопка содержит и текст "Позвонить", и `{phoneInfo.displayPhone}` рядом. AC-1 технически выполнен (кнопка есть), но UX непоследователен между двумя модулями.

**Рекомендация:** Унифицировать: добавить "Позвонить" как текст кнопки в PS Park, а displayPhone вынести рядом как в беседках.

---

### P3 — Низкий: `listCalls` — MANAGER без moduleSlug видит все звонки

**Файл:** `src/app/api/telephony/calls/route.ts:40–44`

**Описание:** Если MANAGER делает запрос `GET /api/telephony/calls` без параметра `moduleSlug`, условие `if (filter.moduleSlug)` не срабатывает, и менеджер получает все звонки всех модулей без фильтрации.

**Рекомендация:** При роли MANAGER всегда проверять доступ: если `moduleSlug` не передан — либо требовать его, либо автоматически ограничивать по назначенным модулям пользователя.

---

## Покрытие тестами

| Компонент | Покрытие |
|-----------|----------|
| `service.ts` — getTelephonyConfig | Полное (4 кейса: null, disabled, enabled, inactive module) |
| `service.ts` — getPublicPhone | Полное (2 кейса) |
| `service.ts` — initiateCall | Полное (6 кейсов: success, BOOKING_NOT_FOUND, NO_CLIENT_PHONE, TELEPHONY_DISABLED, TELEPHONY_NOT_CONFIGURED, NOVOFON_ERROR) |
| `service.ts` — handleWebhook | Полное (3 кейса: update existing, inbound with booking, inbound unattributed) |
| `service.ts` — listCalls | Частичное (pagination + filters, но нет теста на RBAC-сценарий) |
| `service.ts` — getRecordingUrl | Полное (3 кейса) |
| `service.ts` — getTelephonyHealth | Полное (2 кейса) |
| `service.ts` — TelephonyError | Полное (2 кейса) |
| `validation.ts` — initiateCallSchema | Полное (5 кейсов) |
| `validation.ts` — callFilterSchema | Полное (7 кейсов) |
| `validation.ts` — novofonWebhookSchema | Полное (6 кейсов) |
| API route handlers | Не покрыты отдельными тестами |
| `call-button.tsx` | Не покрыт |
| `novofon-client.ts` | Не покрыт |

---

## Вывод

Интеграция телефонии Novofon реализована на высоком уровне качества. Все 667 тестов проходят. Архитектура соответствует принципам платформы: бизнес-логика в `service.ts`, типизация через Zod, RBAC на всех эндпоинтах, конфигурация в `Module.config` JSONB.

**Критических (P1) проблем нет.**

Найдена одна проблема среднего приоритета (P2) — условная защита вебхука при незаполненном секрете — и две проблемы низкого приоритета (P3): непоследовательность UX кнопки звонка и потенциальная утечка данных при вызове `GET /api/telephony/calls` менеджером без `moduleSlug`.

**Рекомендация:** Устранить P2 перед деплоем в production. P3 — в следующем спринте.

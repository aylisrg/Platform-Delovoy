# Pipeline Context: 2026-04-17-auth-yandex-email-ui-polish

## Задача

Комплексный батч: ревью кода + багфиксы + Yandex OAuth + Email сервис + UI-улучшения лендинга.

## Scope задач

1. **Code Review** — полный ревью текущего кода, выявление багов
2. **Bugfixes** — исправление найденных проблем
3. **Auth: Yandex OAuth** — заменить нерабочие провайдеры на Yandex, убрать Google/VK из UI
4. **Email сервис** — HTML-шаблоны уведомлений (Resend): бронирования, заказы, magic link
5. **Booking Widget** — виджет "Позвонить нам" (+7 (499) 677-48-88) на страницах Беседок и PS Park
6. **Landing: фото беседок** — заменить coverPhoto в services-section.tsx
7. **Landing: видео оверлей** — снизить белый шейд с bg-white/70 до bg-white/40 или менее
8. **Анимации** — кнопки, карточки, entrance animations секций лендинга

---

## PO — Ключевые решения

**Дата**: 17 апреля 2026

### Что уже есть в коде (не переписывать)

1. `YandexProvider()` — уже реализован в `src/lib/auth.ts` как custom OAuth. Провайдер написан, нужны только env-переменные.
2. `magic-link` credentials provider — зарегистрирован в `auth.ts`, UI в `auth-modal.tsx` работает.
3. `emailAdapter` через Resend — существует в `src/modules/notifications/channels/email.ts`. Отправляет письма, но без HTML-шаблона.
4. Телефон на страницах `/gazebos` и `/ps-park` — уже подтягивается через `telephony/service`, показывается в hero-секции.

### Ключевые решения PO

**Решение 1 — Удаление Google/VK из AuthModal, не из auth.ts.**
Google и VK остаются зарегистрированными провайдерами в `auth.ts` (существующие аккаунты не ломаются), но убираются с UI. Риск: ноль для пользователей. Причина: `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` не настроены в production → клик по кнопке даёт OAuth error.

**Решение 2 — HTML email-шаблоны как отдельный слой поверх существующего emailAdapter.**
Не переписываем `emailAdapter.send()`. Создаём отдельные функции `sendBookingConfirmationEmail()`, `sendOrderConfirmationEmail()` и т.д., которые вызывают `sendTransactionalEmail()` с подготовленным HTML. Существующий `emailAdapter` для системных уведомлений остаётся как есть.

**Решение 3 — Booking Widget как inline-компонент, не sticky.**
Sticky-виджеты конкурируют с мобильными кнопками системы. Размещение между hero и списком карточек — достаточно заметно и не мешает UX.

**Решение 4 — Оверлей лендинга: целевое значение bg-white/40.**
`/70` = 70% белого — видео полностью теряется. `/40` = достаточный контраст для текста #1d1d1f на светлом фоне. Если после деплоя текст плохо читается — корректировать до `/45` или `/50`, но не выше.

**Решение 5 — Анимации через Tailwind CSS / CSS transitions, не Framer Motion.**
Framer Motion увеличивает бандл. Для hover-эффектов и простых entrance animations достаточно `transition-*` классов Tailwind и `@keyframes` через CSS. Если Architect определит, что Framer Motion уже в зависимостях — использовать его.

### Приоритизация для MVP батча

Если Architect определит, что полный батч слишком велик для одной ветки:

**Tier 1 (обязательно)**: US-1 (Yandex OAuth), US-6 (call widget gazebos), US-7 (call widget ps-park), US-3 (email: бронь беседки)

**Tier 2 (при наличии времени)**: US-2 (magic link email), US-4 (email: кафе), US-5 (email: PS Park), US-8 (видео оверлей)

**Tier 3 (последними)**: US-9 (фото), US-10 (анимации)

---

## Architect — Ключевые решения

**Дата**: 17 апреля 2026
**ADR**: `docs/architecture/2026-04-17-auth-yandex-email-ui-polish-adr.md`

### Решение 1 — Yandex OAuth: только ENV + account linking callback

`YandexProvider()` в `src/lib/auth.ts` полностью реализован (строки 13--44). Изменения кода минимальны:
- Добавить `signIn` callback для account linking (Yandex email -> existing User) -- custom OAuth providers не поддерживают `allowDangerousEmailAccountLinking` напрямую.
- Удалить Google/VK кнопки из `auth-modal.tsx` (строки 221, 223). Провайдеры остаются в auth.ts.
- Redirect URI для Yandex OAuth: `https://delovoy-park.ru/api/auth/callback/yandex`.
- Новых ENV-переменных нет -- `YANDEX_CLIENT_ID`/`YANDEX_CLIENT_SECRET` уже описаны в `.env.example`.

### Решение 2 — Email шаблоны: inline HTML без новых зависимостей

Отклонен React Email (новая зависимость, overkill для 7 шаблонов). Выбран подход inline HTML-функций -- аналогичен существующему magic-link шаблону в `email-magic-link.service.ts`.

Архитектура:
- Новый файл `src/modules/notifications/email-templates.ts` -- все шаблоны + общий layout `emailLayout()`.
- Расширение `ChannelAdapter` interface: добавить optional `sendHtml()` метод.
- В `notifyClient()` (`service.ts`): если канал EMAIL, использовать HTML-шаблон через `renderEmailTemplate()`.
- Dedup через `NotificationLog` перед отправкой (предотвращение повторных писем при обновлении одного статуса).
- Стилистика по модулю: gazebos = green (#16A34A), ps-park = violet (#7C3AED), cafe = amber (#F59E0B), auth = blue (#0071e3).

Event routing: `booking.created` и `order.placed` получают `client: true` (сейчас admin-only).

### Решение 3 — Call Widget: новый переиспользуемый компонент

Новый файл `src/components/public/call-widget.tsx`. Server Component (без state). Props: phone, displayPhone, variant (light/dark).
- Gazebos: между hero и карточками, зеленый акцент.
- PS Park: между tables и features, dark+violet.
- Данные из `getPublicPhone()` -- уже вызывается в обоих page.tsx.

### Решение 4 — Landing UI: точечные CSS-изменения

- Hero overlay: `bg-white/70` -> `bg-white/40` + text-shadow для контраста.
- Фото беседок: `coverPhoto` -> `/media/IMG_3724_Custom.JPG.webp` (файл проверен -- используется как poster на /gazebos).

### Решение 5 — Анимации: Framer Motion (уже в бандле)

PO предложил Tailwind CSS, но Architect определил что `framer-motion: ^12.38.0` уже установлен. Бандл не увеличивается. Подход:
- Новый компонент `FadeInSection` (`src/components/ui/fade-in-section.tsx`) с `whileInView` + `useReducedMotion`.
- Применить к секциям лендинга (кроме hero -- above the fold).
- НЕ трогать gazebos/ps-park -- hover уже реализован (AC-10.5).

### Критические замечания для Developer

1. **Account linking тестировать обязательно**: Yandex login -> email совпадает с Telegram user -> не должен создаваться дубль.
2. **Email SPF/DKIM**: без настройки DNS письма попадут в спам. Это DevOps-задача, не блокирует разработку.
3. **Миграций БД нет** -- вся схема уже готова.
4. **Новых API endpoints нет** -- все изменения внутренние (notification service) и UI.
5. **Порядок**: Tier 1 (email templates, Yandex OAuth, call widget) -> Tier 2 (event routing, magic link upgrade, landing CSS) -> Tier 3 (animations).

---

## Developer — Ключевые решения

(будет заполнено агентом)

---

## Reviewer — Вердикт

(будет заполнено агентом)

---

## QA — Вердикт

(будет заполнено агентом)

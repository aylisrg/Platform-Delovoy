# ADR: Auth Yandex OAuth + Email HTML Templates + UI Polish

## Статус
Предложено

## Дата
17 апреля 2026

## Контекст

Production-версия платформы запущена (14.04.2026). Обнаружены проблемы пользовательского опыта:

1. **AuthModal показывает нерабочие кнопки Google и VK** -- OAuth credentials для этих провайдеров не настроены в production. Клик ведет к ошибке. Yandex OAuth (`YandexProvider()`) реализован в `src/lib/auth.ts`, но без `YANDEX_CLIENT_ID`/`YANDEX_CLIENT_SECRET` тоже не работает.

2. **Email-уведомления отправляются без HTML-дизайна** -- `emailAdapter.send()` оборачивает текст в `<p>` тег. Письма выглядят как спам.

3. **Нет заметного блока "Позвоните нам" на страницах бронирования** -- телефон есть в hero-секции, но при скролле теряется из виду.

4. **Hero-видео на лендинге скрыто белым оверлеем** `bg-white/70` -- видео не видно, теряется смысл видео-фона.

5. **Неактуальное фото беседок** в services-section на лендинге.

6. **Статичный интерфейс** -- нет hover-анимаций и entrance transitions.

**PRD**: `docs/requirements/2026-04-17-auth-yandex-email-ui-polish-prd.md` (10 user stories, US-1 -- US-10).

---

## Варианты

### Email-шаблоны: Вариант A -- React Email

**Описание**: Использовать библиотеку `@react-email/components` для рендеринга шаблонов в HTML-строки на сервере.

- Плюсы: Type-safe, компонентный подход, preview server, хорошая поддержка email-клиентов
- Минусы: Новая зависимость (~180 KB), усложнение билда, overkill для 7 шаблонов

### Email-шаблоны: Вариант B -- Inline HTML функции (без новых зависимостей)

**Описание**: Создать функции-шаблоны в `src/modules/notifications/email-templates.ts`, которые возвращают готовый inline-HTML. Общий layout (header + footer) выделить в хелпер `wrapInLayout()`. Стили исключительно inline (email-safe).

- Плюсы: Ноль новых зависимостей, полный контроль, простота, соответствует текущему подходу magic-link в `email-magic-link.service.ts`
- Минусы: Нет preview, ручное тестирование в email-клиентах

### Анимации: Вариант A -- Framer Motion

- Плюсы: Уже в `package.json` (`framer-motion: ^12.38.0`), мощное API, `whileInView`, `AnimatePresence`
- Минусы: Client Component boundary, hydration cost

### Анимации: Вариант B -- CSS/Tailwind transitions + IntersectionObserver

- Плюсы: Нулевой JS-overhead, нативная производительность, `prefers-reduced-motion` через CSS media query
- Минусы: Менее выразительные анимации, ручная работа с IntersectionObserver

---

## Решения

### 1. Yandex OAuth

**Текущее состояние**: `YandexProvider()` уже полностью реализован в `src/lib/auth.ts` (строки 13--44). Custom OAuth с корректным маппингом profile полей (`id`, `default_email`, `display_name`, `real_name`, `default_avatar_id`). Провайдер зарегистрирован в массиве `providers` (строка 252) с `as never` cast для совместимости с NextAuth types.

**Что нужно:**

1. **ENV-переменные** (уже описаны в `.env.example`, строки 18--19):
   - `YANDEX_CLIENT_ID` -- получить в https://oauth.yandex.ru/client/new
   - `YANDEX_CLIENT_SECRET` -- там же
   - Redirect URI: `https://delovoy-park.ru/api/auth/callback/yandex`

2. **Account linking**: `YandexProvider` возвращает `email: profile.default_email`. PrismaAdapter автоматически создает запись в `Account` с `provider: "yandex"`. Если пользователь с таким email уже существует (через magic-link или Telegram), **необходимо** добавить `allowDangerousEmailAccountLinking: true` в конфиг Yandex-провайдера, аналогично Google (строка 248). Без этого NextAuth выбросит `OAuthAccountNotLinked` error.

   **Изменение**: в `src/lib/auth.ts` дополнить YandexProvider -- после возврата объекта провайдера добавить `allowDangerousEmailAccountLinking: true` (через wrapper или merge). Поскольку `YandexProvider()` возвращает plain object, проще всего добавить поле прямо в возвращаемый объект функции. Однако NextAuth custom OAuth providers не поддерживают `allowDangerousEmailAccountLinking` как поле объекта -- это параметр built-in providers. Для custom provider account linking контролируется через `signIn` callback в `authConfig`. Необходимо добавить `signIn` callback:

   ```typescript
   // В authConfig.callbacks или auth.ts callbacks
   async signIn({ user, account }) {
     // Разрешить привязку OAuth-аккаунтов к существующим email
     if (account?.provider === "yandex" && user.email) {
       const existing = await prisma.user.findUnique({
         where: { email: user.email },
       });
       if (existing) {
         // Разрешаем — NextAuth свяжет Account с существующим User
         return true;
       }
     }
     return true;
   }
   ```

   **Альтернатива** (проще): переписать `YandexProvider()` на использование встроенного паттерна NextAuth, где cast `as never` уже применен. Проверить, что PrismaAdapter корректно обрабатывает account linking для custom providers. Рекомендация: протестировать на staging перед production.

3. **AuthModal (UI)**: удалить кнопки Google и VK из `src/components/ui/auth-modal.tsx`. Конкретно:
   - Строка 221: удалить `<OAuthButton onClick={() => handleOAuth("google")} ... />`
   - Строка 223: удалить `<OAuthButton onClick={() => handleOAuth("vk")} ... />`
   - Оставить только: `<OAuthButton onClick={() => handleOAuth("yandex")} ... label="Яндекс" />`
   - Удалить неиспользуемые компоненты: `GoogleIcon`, `VKIcon` (строки 515--541)

4. **Провайдеры в auth.ts**: Google и VK остаются зарегистрированными в `providers[]` (не удаляем). Существующие аккаунты, уже связанные через Google/VK, продолжат работать через JWT/session без повторного OAuth.

**RBAC**: Не затрагивается -- OAuth login создает/привязывает User с `role: USER`.

**Rate limiting**: OAuth flow проходит через NextAuth callbacks, rate limit на `/api/auth/*` уже исключен из middleware (строка 74 auth.config.ts: `isAuthRoute`). Дополнительный rate limit не нужен -- Яндекс сам лимитирует.

---

### 2. Email Service Architecture

**Выбран Вариант B** -- inline HTML функции без новых зависимостей.

**Обоснование**: В проекте уже есть работающий шаблон magic-link в `email-magic-link.service.ts` (строки 97--118) -- inline HTML с inline-стилями. Этот подход проверен в production. 7 шаблонов не оправдывают добавление React Email (~180 KB). Supply chain risk минимизирован.

#### 2.1. Структура файлов

```
src/modules/notifications/
  email-templates.ts          # <-- НОВЫЙ: все HTML-шаблоны
  channels/email.ts           # Существующий, расширяется
  service.ts                  # Существующий, модифицируется для email-канала
  templates.ts                # Существующий (plain-text для Telegram), НЕ трогаем
  events.ts                   # Существующий, добавляем новые event routes
```

#### 2.2. email-templates.ts -- архитектура

**Общий layout** (header + footer):

```typescript
function emailLayout(content: string, options?: { accentColor?: string }): string {
  const accent = options?.accentColor || "#0071e3";
  return `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:24px 32px 16px;border-bottom:1px solid #e5e5e5;">
          <span style="font-size:18px;font-weight:700;color:#1d1d1f;">Деловой Парк</span>
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:32px;">${content}</td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #e5e5e5;background:#fafafa;">
          <p style="margin:0;font-size:12px;color:#aeaeb2;">
            Бизнес-парк Деловой, Селятино, Московская область<br>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="color:${accent};">delovoy-park.ru</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
```

**Шаблоны** (экспортируемые функции):

| Функция | Где вызывается | Данные |
|---------|---------------|--------|
| `bookingConfirmationHtml(data)` | `notifyClient` при `booking.confirmed` | resourceName, date, startTime, endTime, moduleSlug |
| `bookingCancellationHtml(data)` | `notifyClient` при `booking.cancelled` | resourceName, date, startTime, endTime, cancelReason |
| `bookingReminderHtml(data)` | `notifyClient` при `booking.reminder` | resourceName, startTime |
| `orderConfirmationHtml(data)` | `notifyClient` при `order.placed` (новый route) | orderNumber, items[], totalAmount, deliveryTo |
| `orderStatusHtml(data)` | `notifyClient` при `order.ready` | orderNumber, status |
| `magicLinkHtml(data)` | `sendMagicLinkEmail()` | url, expires |
| `bookingCreatedHtml(data)` | `notifyClient` при `booking.created` (новый route) | resourceName, date, startTime, endTime |

**Стилистика по модулю**:
- gazebos: accent `#16A34A` (green)
- ps-park: accent `#7C3AED` (violet), dark header background option
- cafe: accent `#F59E0B` (amber)
- auth (magic-link): accent `#0071e3` (blue)

#### 2.3. Интеграция с notification service

Текущий flow:
```
enqueueNotification() -> notify() -> notifyClient() -> resolveChannelForUser() -> adapter.send(recipient, plainTextMessage)
```

**Проблема**: `emailAdapter.send()` принимает plain text message и оборачивает в `<p>`. HTML-шаблоны требуют другого подхода.

**Решение -- расширение ChannelAdapter**:

Добавить optional метод `sendHtml` к `ChannelAdapter` interface в `types.ts`:

```typescript
export interface ChannelAdapter {
  channel: NotificationChannel;
  send(
    recipient: string,
    message: string,
    options?: { botToken?: string }
  ): Promise<{ success: boolean; error?: string }>;
  /** Send with pre-rendered HTML (email only) */
  sendHtml?(
    recipient: string,
    subject: string,
    html: string,
    text: string,
    options?: { botToken?: string }
  ): Promise<{ success: boolean; error?: string }>;
  resolveRecipient(user: UserWithContacts): string | null;
}
```

В `emailAdapter` реализовать `sendHtml`:

```typescript
export const emailAdapter: ChannelAdapter = {
  channel: "EMAIL",
  async send(recipient, message) { /* existing */ },
  async sendHtml(recipient, subject, html, text) {
    return sendTransactionalEmail({ to: recipient, subject, html, text });
  },
  resolveRecipient(user) { return user.email || null; },
};
```

В `notifyClient()` в `service.ts` -- после resolve channel, если канал EMAIL, использовать HTML-шаблон:

```typescript
if (resolved.channel === "EMAIL") {
  const htmlTemplate = renderEmailTemplate(event.moduleSlug, event.type, event.data);
  if (htmlTemplate && adapter.sendHtml) {
    const result = await adapter.sendHtml(
      resolved.recipient,
      htmlTemplate.subject,
      htmlTemplate.html,
      htmlTemplate.text
    );
    // ... log notification
    return;
  }
}
// Fallback: existing plain text flow
```

Новая функция `renderEmailTemplate()` в `email-templates.ts`:

```typescript
export function renderEmailTemplate(
  moduleSlug: string,
  eventType: string,
  data: Record<string, unknown>
): { subject: string; html: string; text: string } | null
```

#### 2.4. Добавить event route для `booking.created` client notification

Текущий `EVENT_ROUTING`:
```typescript
"booking.created": { client: false, admin: true, category: "booking" },
```

`booking.created` сейчас отправляет уведомление только админу. Для email-подтверждения клиенту нужно:

**Вариант**: Добавить `client: true` к `booking.created`. Это изменит поведение -- клиент получит уведомление о создании брони (status: PENDING) на все каналы (Telegram, Email). Текущий шаблон для `booking.created` в `clientTemplates` отсутствует -- нужно добавить.

**Рекомендация**: Добавить client notification для `booking.created` только через EMAIL канал. Для этого в `notifyClient()` можно проверить: если `eventType === "booking.created"` и канал не EMAIL -- skip. Или проще: включить `client: true` для `booking.created` и добавить соответствующий plain-text шаблон в `clientTemplates`. Клиент на Telegram тоже получит "Заявка на бронирование принята" -- это полезно.

**Решение**: Изменить `events.ts`:
```typescript
"booking.created": { client: true, admin: true, category: "booking" },
```

Добавить client template для `booking.created` в `templates.ts` (plain-text для Telegram):
```typescript
"booking.created": (d) =>
  `Заявка на бронирование принята!\n\n${d.resourceName}\nДата: ${d.date}\nВремя: ${d.startTime} -- ${d.endTime}\n\nОжидайте подтверждения.`,
```

Аналогично для `order.placed` -- включить client: true.

#### 2.5. Magic Link HTML upgrade

В `src/modules/auth/email-magic-link.service.ts` функция `sendMagicLinkEmail()` уже содержит inline HTML (строки 97--118). Нужно заменить текущий inline HTML на вызов `magicLinkHtml()` из `email-templates.ts` для единообразного стиля. Это обеспечит один layout для всех писем платформы.

#### 2.6. Защита от дублирования email

Для US-4 AC-5 (заказ кафе -- не отправлять при повторном обновлении статуса): в `NotificationLog` уже логируется каждая отправка. Перед отправкой email в `notifyClient()` проверять:

```typescript
const alreadySent = await prisma.notificationLog.findFirst({
  where: {
    entityId: event.entityId,
    eventType: event.type,
    channel: "EMAIL",
    status: "SENT",
  },
});
if (alreadySent) return; // skip duplicate
```

**Zod-схемы**: Для email-шаблонов не нужны новые Zod-схемы -- данные приходят из внутренних `NotificationEvent.data`, которые формируются в доверенном контексте сервисами (`gazebos/service.ts`, `cafe/service.ts`, `ps-park/service.ts`). Входные данные пользователя уже провалидированы до вызова `enqueueNotification()`.

---

### 3. Call Widget

**Компонент**: Новый компонент `src/components/public/call-widget.tsx` -- переиспользуемый между gazebos и ps-park.

**Props**:

```typescript
type CallWidgetProps = {
  phone: string;         // "+74996774888"
  displayPhone: string;  // "+7 (499) 677-48-88"
  variant: "light" | "dark";  // gazebos = light, ps-park = dark
};
```

**Размещение**:

1. **`/gazebos` (page.tsx)**: Между hero-секцией (строка 99) и секцией карточек (строка 101). Inline-блок, не sticky. Визуально: светлый фон (`bg-[#f0fdf4]`), зеленый акцент (`#16A34A`), иконка телефона, текст "Хотите забронировать по телефону?", номер как `<a href="tel:...">`.

2. **`/ps-park` (page.tsx)**: Между секцией tables (строка 240) и секцией features (строка 264). Dark variant: `bg-zinc-900` border `border-zinc-800`, violet accent.

**Дизайн-ориентир**: Блок высотой ~80px, centered text, mobile-friendly (телефон кликабельный, text-base). Не sticky, не floating -- статичный inline-блок. На мобильных полноширинный.

**Реализация**: Server Component (без state). `getPublicPhone()` уже вызывается в обоих page.tsx -- пробрасываем данные в пропс.

**RBAC**: Не применимо -- публичный компонент, не API endpoint.

---

### 4. Landing UI

#### 4.1. Видео оверлей (US-8)

**Файл**: `landing-delovoy-park.ru/components/hero-section-with-video.tsx`

**Строка 41**: Изменить `bg-white/70` на `bg-white/40`.

```diff
- <div className="absolute inset-0 bg-white/70 z-[1]" />
+ <div className="absolute inset-0 bg-white/40 z-[1]" />
```

**Контраст**: Текст `#1d1d1f` на `bg-white/40` поверх видео. Worst-case (темный кадр видео): effective background ~`#999999`, contrast ratio с `#1d1d1f` ~ 3.5:1. Это ниже WCAG AA (4.5:1). Добавить text-shadow для обеспечения читаемости:

```css
/* На h1 и p элементах в hero */
text-shadow: 0 1px 3px rgba(255,255,255,0.6);
```

Или использовать `bg-white/45` как компромисс. Рекомендация: начать с `/40`, проверить визуально, откатить до `/45` если текст плохо читается.

**Mobile poster**: строка 34, `opacity-30` -- тоже нужно скорректировать для единообразия. Рекомендация: оставить `opacity-30` для мобильного постера (он статичный, контраст другой).

#### 4.2. Фото беседок (US-9)

**Файл**: `landing-delovoy-park.ru/components/services-section.tsx`

**Строка 17**: Изменить `coverPhoto` для gazebos:

```diff
- coverPhoto: "/media/IMG_3843-HDR_Custom.JPG.webp",
+ coverPhoto: "/media/IMG_3724_Custom.JPG.webp",
```

**Проверка**: файл `/media/IMG_3724_Custom.JPG.webp` используется как poster на странице `/gazebos` (строка 47 gazebos/page.tsx) -- файл точно существует в production.

---

### 5. Анимации

**Выбран Вариант A -- Framer Motion**.

**Обоснование**: `framer-motion: ^12.38.0` уже установлен в `package.json`. Добавление не увеличивает бандл -- пакет уже в дереве. `CyberpunkGrid` в ps-park уже использует его. Framer Motion дает `whileInView` из коробки без ручного IntersectionObserver. `prefers-reduced-motion` поддерживается через `useReducedMotion()` хук.

#### 5.1. Компонент-обертка `FadeInSection`

**Новый файл**: `src/components/ui/fade-in-section.tsx` (Client Component)

```typescript
"use client";
import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";

export function FadeInSection({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
```

#### 5.2. Где применять

**Landing (`src/app/page.tsx`)**:
- Обернуть `<ServicesSection />`, `<AdvantagesSection />`, `<ReviewsSection />`, `<ContactsSection />` в `<FadeInSection>`
- НЕ оборачивать `<HeroSectionWithVideo />` (above the fold, не должен задерживаться)

**Landing (`services-section.tsx`)**:
- Карточки сервисов: добавить `hover:-translate-y-0.5 hover:shadow-xl transition-all duration-300` (уже частично есть на строке 64: `hover:shadow-xl transition-all duration-300`). Добавить `hover:-translate-y-0.5`.

**Кнопки CTA на лендинге (hero-section-with-video.tsx)**:
- Добавить `transition-all duration-200` (уже есть на строках 113, 119). Текущие hover-стили достаточны.

**Gazebos/PS-Park**: НЕ трогать -- PRD AC-10.5 явно запрещает добавление hover-эффектов к уже стилизованным элементам. На обеих страницах hover уже реализован.

---

## Файлы к изменению (точный список)

| Файл | Изменения |
|------|-----------|
| `src/lib/auth.ts` | Account linking для Yandex (signIn callback или allowDangerousEmailAccountLinking через wrapper) |
| `src/components/ui/auth-modal.tsx` | Удалить Google/VK кнопки (строки 221, 223), удалить GoogleIcon, VKIcon |
| `src/modules/notifications/types.ts` | Добавить optional `sendHtml` метод в `ChannelAdapter` |
| `src/modules/notifications/channels/email.ts` | Реализовать `sendHtml` в `emailAdapter` |
| `src/modules/notifications/service.ts` | В `notifyClient()`: HTML-path для EMAIL канала, dedup check |
| `src/modules/notifications/events.ts` | `booking.created` -> client: true; `order.placed` -> client: true |
| `src/modules/notifications/templates.ts` | Добавить client шаблон для `booking.created` и `order.placed` (plain-text) |
| `src/modules/auth/email-magic-link.service.ts` | Заменить inline HTML на вызов шаблона из email-templates.ts |
| `src/app/(public)/gazebos/page.tsx` | Добавить CallWidget между hero и карточками |
| `src/app/(public)/ps-park/page.tsx` | Добавить CallWidget между tables и features |
| `landing-delovoy-park.ru/components/hero-section-with-video.tsx` | `bg-white/70` -> `bg-white/40`, text-shadow |
| `landing-delovoy-park.ru/components/services-section.tsx` | coverPhoto gazebos -> `/media/IMG_3724_Custom.JPG.webp`, hover:-translate-y-0.5 |
| `src/app/page.tsx` | Обернуть секции в FadeInSection |

## Новые файлы (точный список с путями)

| Файл | Назначение |
|------|-----------|
| `src/modules/notifications/email-templates.ts` | HTML-шаблоны: emailLayout, bookingConfirmationHtml, bookingCancellationHtml, bookingReminderHtml, bookingCreatedHtml, orderConfirmationHtml, orderStatusHtml, magicLinkHtml |
| `src/modules/notifications/__tests__/email-templates.test.ts` | Unit-тесты: каждый шаблон рендерит корректный HTML, содержит все необходимые данные, layout присутствует |
| `src/components/public/call-widget.tsx` | Компонент виджета звонка (light/dark варианты) |
| `src/components/ui/fade-in-section.tsx` | Framer Motion wrapper для entrance animations |

## ENV переменные (новые)

Новых переменных НЕТ. Все уже описаны в `.env.example`:

| Переменная | Описание | Статус |
|-----------|----------|--------|
| `YANDEX_CLIENT_ID` | Yandex OAuth client ID | Уже в .env.example (строка 18), нужно заполнить в production |
| `YANDEX_CLIENT_SECRET` | Yandex OAuth client secret | Уже в .env.example (строка 19), нужно заполнить в production |
| `RESEND_API_KEY` | Resend API key для email | Уже в .env.example (строка 58) |
| `RESEND_FROM_EMAIL` | Email отправителя | Уже в .env.example (строка 59) |

## Схема данных

**Изменений в `prisma/schema.prisma` НЕТ.** Все необходимые модели уже существуют:
- `Account` -- для хранения OAuth-аккаунтов (Yandex)
- `NotificationLog` -- для логирования и dedup email-уведомлений
- `NotificationPreference` -- для user opt-out

## API-контракты

**Новых API endpoints НЕТ.** Все изменения затрагивают:
- Внутренний notification service (server-side, не API)
- UI компоненты (client-side)
- OAuth callback (управляется NextAuth: `GET /api/auth/callback/yandex`)

Существующий `POST /api/auth/email/send` продолжает работать без изменений -- только визуал письма улучшается.

## Миграции

**Миграции БД не требуются.** Схема Prisma не изменяется.

## Влияние на существующие модули

| Модуль | Влияние |
|--------|---------|
| `notifications` | Расширение: новый файл email-templates, sendHtml в adapter, HTML-path в service. Plain-text flow остается без изменений. Обратная совместимость полная. |
| `auth` | Минимальное: account linking callback, замена inline HTML на шаблон. |
| `gazebos` | Минимальное: добавление CallWidget в page.tsx (Server Component). Бизнес-логика не трогается. |
| `ps-park` | Минимальное: добавление CallWidget в page.tsx. Бизнес-логика не трогается. |
| `cafe` | Косвенное: добавление client notification для `order.placed`. Cafe service (`enqueueNotification`) уже вызывает этот event -- изменение только в routing. |
| Landing | CSS-only: оверлей, фото, hover. Без изменений логики. |

## Риски

| Риск | Вероятность | Митигация |
|------|------------|-----------|
| Yandex OAuth account linking создает дубли пользователей | Средняя | Добавить signIn callback с проверкой email. Тестировать: login Yandex -> тот же email что у Telegram user |
| Email попадает в спам (новый домен + HTML) | Средняя | Настроить SPF, DKIM, DMARC для delovoy-park.ru. Resend дает инструменты для этого. Проверить через mail-tester.com |
| Контраст текста при `bg-white/40` недостаточен | Низкая | Добавить text-shadow. Запасной вариант: `bg-white/45`. Визуальная проверка на staging |
| Framer Motion увеличивает TTI на лендинге | Низкая | Уже в бандле. `FadeInSection` -- lazy, viewport-triggered. `useReducedMotion` для accessibility. Не применять к hero (above the fold) |
| Дублирование email при race condition | Низкая | Dedup check через `NotificationLog` перед отправкой. `Promise.allSettled` в notify() уже обрабатывает параллелизм |

## Порядок реализации (рекомендация для Developer)

**Tier 1** (блокирующий):
1. Email templates + sendHtml adapter (основа для всех email stories)
2. Yandex OAuth account linking (удалить Google/VK из UI)
3. Call Widget + размещение на gazebos/ps-park

**Tier 2** (после Tier 1):
4. Event routing: booking.created -> client: true, order.placed -> client: true
5. Magic link HTML upgrade
6. Landing: overlay + photo

**Tier 3** (последним):
7. FadeInSection + animations

---

## Чеклист Architect

- [x] ADR написан и зафиксирован
- [x] Схема данных описана (изменений нет -- существующая схема достаточна)
- [x] API-контракты определены (новых endpoints нет)
- [x] Zod-схемы описаны (новых не требуется -- данные из доверенного контекста)
- [x] Влияние на существующие модули оценено
- [x] Миграция данных описана (не требуется)
- [x] RBAC для каждого endpoint (нет новых endpoints; OAuth -- public; email -- internal)
- [x] Rate limiting (OAuth -- через NextAuth; email dedup -- через NotificationLog)
- [x] Security: нет новых зависимостей, нет URL/file path input от пользователя, секреты только через process.env

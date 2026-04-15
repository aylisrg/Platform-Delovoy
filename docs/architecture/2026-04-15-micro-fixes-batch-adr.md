# ADR: Пакет микро-правок после запуска (Post-Launch Fixes Batch)

**Дата:** 2026-04-15
**Статус:** Предложено
**Авторы:** System Architect (Claude)

---

## Контекст

Платформа "Деловой" запущена в production 14 апреля 2026 года. В первые сутки после запуска собран пакет из 12 правок: фактические ошибки, UX-улучшения, инфраструктурные задачи. Правки сгруппированы по приоритету: Must Have (4), Should Have (5), Could Have (3).

### Принцип реализации

Каждая правка -- изолированный коммит. Никаких миграций БД (Prisma schema не меняется). Все изменения обратно совместимы. Деплой инкрементальный -- каждую правку можно откатить независимо.

---

## STORY-1: Исправить "40 км" -> "30 км" на главной

**Приоритет:** Must Have
**Сложность:** Trivial
**Риск:** Нулевой

### Текущее состояние

Файл: `landing-delovoy-park.ru/components/hero-section-with-video.tsx`, строка 145.

```tsx
{ value: "40 км", label: "от Москвы" },
```

Фактическое расстояние от МКАД до Селятино -- около 30 км.

### Решение

Заменить строку:

```tsx
// Было:
{ value: "40 км", label: "от Москвы" },

// Стало:
{ value: "30 км", label: "от Москвы" },
```

### Файлы

| Файл | Действие |
|------|----------|
| `landing-delovoy-park.ru/components/hero-section-with-video.tsx` | Изменить значение в объекте stats, строка 145 |

### Edge cases

Нет. Это статическая строка, не влияющая на логику.

---

## STORY-3: Принудительный сброс кэша браузера

**Приоритет:** Must Have
**Сложность:** Низкая
**Риск:** Низкий

### Текущее состояние

Файл `next.config.ts` содержит минимальную конфигурацию:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
};
```

Нет заголовков кэширования. Браузеры могут кэшировать старые HTML-страницы.

### Решение

Добавить `headers()` в `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // HTML-страницы: всегда ревалидировать
        source: "/((?!_next/static|_next/image|favicon.ico|media/).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
        ],
      },
      {
        // Статика (JS/CSS с хешами) -- immutable
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};
```

### Логика

1. HTML-документы (`/((?!_next/static|_next/image|favicon.ico|media/).*)`) получают `no-cache, no-store, must-revalidate` -- браузер всегда ревалидирует.
2. Статические ассеты (`/_next/static/(.*)`) уже содержат content hash в имени файла -- безопасно ставить `immutable` с TTL 1 год.
3. Медиа-файлы (`/media/`) и favicon не трогаем -- они кэшируются стандартно.

### Файлы

| Файл | Действие |
|------|----------|
| `next.config.ts` | Добавить `async headers()` в конфигурацию |

### Edge cases

- Nginx перед приложением может перезаписывать заголовки. Проверить, что в nginx.conf нет конфликтующих `proxy_cache` или `add_header Cache-Control` директив.
- После деплоя пользователи со старым кэшем увидят обновлённый контент при следующем заходе (no-cache заставит ревалидировать).

---

## STORY-6: Убрать FeedbackButton с публичных страниц

**Приоритет:** Must Have
**Сложность:** Низкая
**Риск:** Низкий

### Текущее состояние

`FeedbackButton` рендерится в `src/app/layout.tsx` (root layout), строка 114:

```tsx
<SessionProvider>
  {children}
  <FeedbackButton />
</SessionProvider>
```

Это значит, что кнопка видна на всех страницах, включая публичные. Модуль обратной связи предназначен для внутренних пользователей (админы, менеджеры).

### Решение

1. **Удалить** `<FeedbackButton />` и его import из `src/app/layout.tsx`.
2. **Добавить** `<FeedbackButton />` в `src/app/admin/layout.tsx`.

#### `src/app/layout.tsx` (удалить):

```tsx
// Удалить import:
import { FeedbackButton } from "@/components/public/feedback-button";

// Удалить из JSX:
<FeedbackButton />
```

#### `src/app/admin/layout.tsx` (добавить):

```tsx
import { Sidebar } from "@/components/admin/sidebar";
import { FeedbackButton } from "@/components/public/feedback-button";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-zinc-50">{children}</main>
      <FeedbackButton />
    </div>
  );
}
```

### Файлы

| Файл | Действие |
|------|----------|
| `src/app/layout.tsx` | Удалить import и `<FeedbackButton />` из JSX |
| `src/app/admin/layout.tsx` | Добавить import и `<FeedbackButton />` в JSX |

### Edge cases

- `FeedbackButton` внутри себя проверяет `useSession()` -- в admin layout сессия гарантированно есть (middleware guard), поэтому кнопка отрисуется.
- `FeedbackButton` использует `"use client"` -- admin layout сейчас серверный, но `FeedbackButton` как клиентский компонент может быть дочерним элементом серверного layout без проблем.

---

## STORY-11: Автоматический бекап БД

**Приоритет:** Must Have
**Сложность:** Средняя
**Риск:** Низкий (не затрагивает работу приложения)

### Текущее состояние

Скрипт `scripts/backup-db.sh` уже написан и работает:
- pg_dump с gzip-сжатием
- Ротация: daily (30 дней), monthly (12 месяцев)
- Telegram-алерт при ошибке
- Параметризован через env-переменные

Скрипт не подключён к cron и не имеет docker-сервиса.

### Решение

#### 1. Docker-compose backup service

Добавить в `docker-compose.yml`:

```yaml
  backup:
    image: postgres:16-alpine
    container_name: delovoy-backup
    restart: "no"
    volumes:
      - ./scripts/backup-db.sh:/scripts/backup-db.sh:ro
      - backup_data:/backups/postgres
    environment:
      DATABASE_URL: "postgresql://delovoy:${POSTGRES_PASSWORD}@postgres:5432/delovoy_park"
      BACKUP_DIR: "/backups/postgres"
      RETENTION_DAYS: "30"
      TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN}"
      TELEGRAM_ADMIN_CHAT_ID: "${TELEGRAM_ADMIN_CHAT_ID}"
    depends_on:
      postgres:
        condition: service_healthy
    entrypoint: ["sh", "-c", "chmod +x /scripts/backup-db.sh && /scripts/backup-db.sh"]
    profiles:
      - backup
```

И добавить volume:

```yaml
volumes:
  postgres_data:
  redis_data:
  backup_data:
```

#### 2. Cron на хосте

Создать файл `scripts/cron-backup.sh`:

```bash
#!/bin/bash
# Запуск бекапа через docker compose
# Установить в crontab: 0 3 * * * /path/to/scripts/cron-backup.sh
set -euo pipefail
cd /opt/delovoy  # или путь к docker-compose.yml
docker compose run --rm backup
```

#### 3. Документация

Добавить секцию в `DEPLOYMENT.md` с инструкцией:

```
# Настройка автобекапов
crontab -e
# Добавить строку:
0 3 * * * /opt/delovoy/scripts/cron-backup.sh >> /var/log/delovoy-backup.log 2>&1
```

### Файлы

| Файл | Действие |
|------|----------|
| `docker-compose.yml` | Добавить сервис `backup` с profile `backup`, добавить `backup_data` volume |
| `scripts/cron-backup.sh` | Новый файл -- обёртка для запуска через cron |
| `DEPLOYMENT.md` | Добавить секцию "Автоматические бекапы" |

### Edge cases

- `profiles: [backup]` гарантирует, что сервис не запустится автоматически при `docker compose up`. Запуск только через `docker compose run --rm backup` или `docker compose --profile backup up backup`.
- Бекап volume `backup_data` -- Docker named volume. На production рекомендуется bind mount в реальную директорию (`/backups/postgres`) для доступа извне Docker.
- При нехватке места на диске pg_dump упадёт, скрипт отправит Telegram-алерт.
- Параллельный запуск двух бекапов безопасен (разные timestamp в имени файла).

---

## STORY-2: Публичная страница офисов -- кнопка "Отправить запрос" на карточках

**Приоритет:** Should Have
**Сложность:** Средняя
**Риск:** Низкий

### Текущее состояние

Страница `src/app/(public)/rental/page.tsx` показывает карточки офисов и одну общую форму `<InquiryForm>` внизу. Карточки не содержат кнопок взаимодействия. Пользователь не может выбрать несколько офисов для запроса.

Форма `InquiryForm` принимает один `officeId` через `<select>`.

### Решение

#### 1. Добавить кнопку "Отправить запрос" на карточках доступных офисов

На карточках со статусом `AVAILABLE` добавить кнопку. Кнопка не отправляет запрос сама -- она скроллит к форме и предзаполняет выбранный офис.

Поскольку `page.tsx` -- серверный компонент, а нам нужна интерактивность (scroll, state), оборачиваем контент в клиентский компонент.

#### 2. Мульти-селект офисов

Заменить `<select>` на чекбокс-список в `InquiryForm`. Пользователь может отметить несколько интересующих офисов.

#### 3. Изменить API для мульти-офисов

Текущий `createInquirySchema` принимает `officeId: z.string().optional()`. Добавить `officeIds: z.array(z.string()).optional()` как альтернативу. API создаёт одну `RentalInquiry` без привязки к конкретному офису, но хранит список выбранных офисов в поле `message` (или добавляем новое JSON-поле).

**Рекомендуемый подход:** Не менять схему БД. Вместо этого:
- Принимать `officeIds: string[]` в API
- Создавать **одну заявку на каждый офис** (если выбрано несколько) ИЛИ передавать список в `message`
- Лучший вариант: **одна заявка**, список офисов в `message` с префиксом. Менеджер увидит все выбранные офисы.

#### 4. Сообщение "свяжемся в рабочее время"

После успешной отправки -- показать расширенное сообщение:

```
Заявка отправлена! Мы свяжемся с вами в рабочее время (Пн-Пт, 9:00-18:00).
```

### Изменения в файлах

#### `src/app/(public)/rental/page.tsx`

Обернуть карточки и форму в клиентский компонент `RentalPageContent`:

```tsx
// page.tsx остаётся серверным -- данные загружаются на сервере
// Передаём offices в клиентский компонент

import { RentalPageContent } from "@/components/public/rental/rental-page-content";

export default async function RentalPage() {
  const offices = await listOffices();
  return <RentalPageContent offices={offices} />;
}
```

#### `src/components/public/rental/rental-page-content.tsx` (новый)

Клиентский компонент, содержащий:
- Карточки офисов с кнопкой "Отправить запрос" на доступных
- Ref на форму для scroll-to
- State `selectedOfficeIds: string[]`
- Передача `selectedOfficeIds` в `InquiryForm`

#### `src/components/public/rental/inquiry-form.tsx`

Изменения:
- Заменить `officeId: string` на `selectedOfficeIds: string[]` (prop)
- Заменить `<select>` на чекбокс-список доступных офисов
- Кнопка "Отправить запрос" отправляет `officeIds` вместо `officeId`
- Успешное сообщение: "Мы свяжемся с вами в рабочее время (Пн-Пт, 9:00-18:00)"

#### `src/modules/rental/validation.ts`

Обновить `createInquirySchema`:

```ts
export const createInquirySchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(5).max(20),
  email: z.string().email().optional(),
  companyName: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  officeId: z.string().optional(),       // обратная совместимость
  officeIds: z.array(z.string()).max(10).optional(),  // новое: мульти-селект
});
```

#### `src/modules/rental/service.ts`

В функции `createInquiry`:
- Если передан `officeIds` (массив), создать одну заявку
- Если `officeIds.length === 1`, привязать к `officeId`
- Если `officeIds.length > 1`, привязать к первому, добавить остальные номера в `message`
- Обратная совместимость: если передан только `officeId`, работает как раньше

#### `src/app/api/rental/inquiries/route.ts`

Не требует изменений -- валидация через Zod, логика в сервисе.

### Файлы

| Файл | Действие |
|------|----------|
| `src/app/(public)/rental/page.tsx` | Рефакторинг: делегировать рендеринг в `RentalPageContent` |
| `src/components/public/rental/rental-page-content.tsx` | Новый: клиентский компонент с карточками и scroll-to-form |
| `src/components/public/rental/inquiry-form.tsx` | Изменить: мульти-селект, предзаполнение, расширенное сообщение |
| `src/modules/rental/validation.ts` | Добавить `officeIds` в `createInquirySchema` |
| `src/modules/rental/service.ts` | Обработать `officeIds` в `createInquiry` |

### Edge cases

- Пользователь не выбирает ни одного офиса -- работает как раньше (общий запрос)
- Пользователь выбирает 10+ офисов -- Zod ограничивает `.max(10)`
- Мобильные устройства: чекбокс-список должен быть collapsible/scrollable при большом количестве офисов
- Scroll-to-form на мобильных: использовать `scrollIntoView({ behavior: "smooth", block: "start" })`

---

## STORY-4: Скрыть "Кафе" из navbar и services-section на лендинге

**Приоритет:** Should Have
**Сложность:** Trivial
**Риск:** Нулевой

### Текущее состояние

#### Navbar (`landing-delovoy-park.ru/components/navbar.tsx`):

```tsx
const navLinks = [
  { label: "О парке", href: "/#advantages" },
  { label: "Офисы", href: "/rental" },
  { label: "Барбекю Парк", href: "/gazebos" },
  { label: "Плей Парк", href: "/ps-park" },
  { label: "Кафе", href: "/cafe" },
  { label: "Контакты", href: "/#contacts" },
];
```

#### Services Section (`landing-delovoy-park.ru/components/services-section.tsx`):

Массив `services` содержит 3 элемента: Барбекю Парк, Плей Парк, Кафе.

### Решение

#### Navbar

Удалить строку с "Кафе":

```tsx
const navLinks = [
  { label: "О парке", href: "/#advantages" },
  { label: "Офисы", href: "/rental" },
  { label: "Барбекю Парк", href: "/gazebos" },
  { label: "Плей Парк", href: "/ps-park" },
  // { label: "Кафе", href: "/cafe" },  -- убрано
  { label: "Контакты", href: "/#contacts" },
];
```

#### Services Section

Удалить объект "cafe" из массива `services` (строки 37-51). После удаления останется 2 карточки. Grid `md:grid-cols-3` заменить на `md:grid-cols-2` чтобы карточки не были разреженными.

### Файлы

| Файл | Действие |
|------|----------|
| `landing-delovoy-park.ru/components/navbar.tsx` | Удалить `{ label: "Кафе", href: "/cafe" }` из `navLinks` |
| `landing-delovoy-park.ru/components/services-section.tsx` | Удалить объект `cafe` из `services`, изменить grid на `md:grid-cols-2` |

### Edge cases

- Прямая ссылка `/cafe` продолжит работать -- мы не удаляем страницу, только навигацию.
- SEO: страница `/cafe` останется индексируемой. Если нужно полностью скрыть -- добавить `robots: { index: false }` в metadata страницы. Но это отдельная задача.

---

## STORY-7: Показывать метод логина в таблице клиентов

**Приоритет:** Should Have
**Сложность:** Средняя
**Риск:** Низкий

### Текущее состояние

Таблица клиентов в `src/components/admin/clients/clients-page-content.tsx` показывает колонки: Клиент, Контакты, Модули, Потрачено, Активность, Регистрация. Метод логина (Telegram/Google/VK/Yandex/Email) не отображается.

Данные о провайдерах хранятся в таблице `Account` (Prisma model):

```prisma
model Account {
  id                String  @id @default(cuid())
  userId            String
  provider          String  // "google", "yandex", "vk"
  ...
}
```

Для Telegram-логина `Account` не создаётся (это Credentials provider), но у User есть поле `telegramId`.

### Решение

#### 1. Расширить сервис `listClients` и `getClientDetail`

В `src/modules/clients/service.ts`:

- Добавить `accounts` в select при запросе users:

```ts
accounts: {
  select: { provider: true },
},
```

- Вычислить `authProviders: string[]` для каждого клиента:

```ts
function getAuthProviders(user: {
  telegramId: string | null;
  email: string | null;
  passwordHash?: string | null;
  accounts: { provider: string }[];
}): string[] {
  const providers: string[] = [];

  // OAuth providers from Account table
  for (const acc of user.accounts) {
    if (!providers.includes(acc.provider)) {
      providers.push(acc.provider);
    }
  }

  // Telegram (Credentials, no Account record)
  if (user.telegramId && !providers.includes("telegram")) {
    providers.push("telegram");
  }

  // Email/password (Credentials, no Account record)
  // Определяем по наличию email при отсутствии OAuth-аккаунта с email
  // Упрощение: если нет ни одного Account и есть email -- значит credentials
  if (user.email && providers.length === 0 && !user.telegramId) {
    providers.push("credentials");
  }

  return providers;
}
```

#### 2. Расширить типы

В `src/modules/clients/types.ts`:

Добавить `authProviders: string[]` в `ClientSummary` и `ClientDetail`.

#### 3. Отобразить в UI

В `src/components/admin/clients/clients-page-content.tsx`:

Добавить колонку "Вход" (или бейджи рядом с именем клиента). Для компактности -- иконки/бейджи в колонке "Контакты":

```tsx
const PROVIDER_LABEL: Record<string, { icon: string; label: string }> = {
  telegram: { icon: "TG", label: "Telegram" },
  google: { icon: "G", label: "Google" },
  vk: { icon: "VK", label: "VKontakte" },
  yandex: { icon: "Ya", label: "Yandex" },
  credentials: { icon: "@", label: "Email" },
};
```

Бейджи рядом с контактами или отдельная мини-колонка.

**Рекомендация:** Не добавлять отдельную колонку (таблица уже широкая). Вместо этого показать бейджи провайдеров под контактной информацией в существующей колонке "Контакты":

```tsx
<td className="px-6 py-3">
  <div className="space-y-0.5">
    {client.email && <div className="text-zinc-600">{client.email}</div>}
    {client.phone && <div className="text-zinc-400 text-xs">{client.phone}</div>}
    {/* Auth provider badges */}
    {client.authProviders.length > 0 && (
      <div className="flex gap-1 mt-1">
        {client.authProviders.map((p) => (
          <span
            key={p}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600"
            title={PROVIDER_LABEL[p]?.label || p}
          >
            {PROVIDER_LABEL[p]?.icon || p}
          </span>
        ))}
      </div>
    )}
  </div>
</td>
```

### Файлы

| Файл | Действие |
|------|----------|
| `src/modules/clients/service.ts` | Добавить `accounts: { select: { provider: true } }` в select; добавить функцию `getAuthProviders`; включить `authProviders` в результат |
| `src/modules/clients/types.ts` | Добавить `authProviders: string[]` в `ClientSummary` и `ClientDetail` |
| `src/components/admin/clients/clients-page-content.tsx` | Добавить `authProviders` в тип `Client`; отрисовать бейджи в колонке "Контакты" |
| `src/components/admin/clients/client-profile.tsx` | Добавить `authProviders` в тип `ClientDetail`; показать бейджи в header профиля |

### Edge cases

- Пользователь может иметь несколько провайдеров (залогинился через Google, потом привязал Telegram) -- показываем все.
- У некоторых пользователей нет ни Account, ни telegramId (созданы seed-скриптом) -- `authProviders` будет пустым массивом.
- Поле `passwordHash` не включено в select клиентского сервиса (и не должно!) -- для определения credentials-логина используем эвристику (есть email, нет OAuth).

### Миграция БД

Не требуется. Данные уже есть в таблице `Account`.

---

## STORY-9: Запустить seed-rental.ts на production

**Приоритет:** Should Have
**Сложность:** Низкая
**Риск:** Средний (мутация production данных)

### Текущее состояние

Скрипт `scripts/seed-rental.ts` готов и работает с файлом `scripts/seed-rental.json`. Поддерживает upsert для офисов и update-or-create для арендаторов. Контракты создаются всегда новые.

### Решение

Это операционная задача, не требующая изменений кода. Порядок действий:

#### 1. Подготовить `seed-rental.json` с реальными данными

Файл `scripts/seed-rental.json` должен содержать актуальные данные арендаторов, офисов и контрактов.

#### 2. Запуск на production

```bash
# Из контейнера приложения
docker compose exec app npx tsx scripts/seed-rental.ts

# ИЛИ через docker compose run (одноразовый контейнер)
docker compose run --rm app npx tsx scripts/seed-rental.ts
```

#### 3. Предварительно сделать бекап

```bash
# Запустить бекап перед seed
docker compose run --rm backup
```

### Предосторожности

1. **Бекап перед запуском** -- обязателен
2. **Проверить seed-rental.json** на корректность данных (формат дат, ИНН, номера офисов)
3. **Проверить идемпотентность** -- повторный запуск НЕ создаст дубликаты офисов (upsert по `building_floor_number`), НО создаст дублирующиеся контракты
4. **Добавить защиту от дублей контрактов** в скрипт

#### Доработка скрипта

Добавить проверку на существующий контракт перед созданием:

```ts
// В секции "Import contracts":
const existingContract = await prisma.rentalContract.findFirst({
  where: {
    tenantId,
    officeId,
    startDate,
    endDate,
  },
});

if (existingContract) {
  console.log(`  ~ Contract already exists: ${c.tenantRef} -> ${c.officeRef}, skipping`);
  continue;
}
```

### Файлы

| Файл | Действие |
|------|----------|
| `scripts/seed-rental.ts` | Добавить проверку дублей контрактов |
| `scripts/seed-rental.json` | Заполнить реальными данными (ручная работа PO) |

### Edge cases

- Контракт с одинаковым tenantRef+officeRef, но другими датами -- это новый контракт, не дубль
- Скрипт автоматически проставляет status контракта через `autoContractStatus()` -- корректно для текущей даты
- Скрипт обновляет `office.status` на OCCUPIED для активных контрактов -- может перезаписать ручные изменения

---

## STORY-10: Убрать ReceiveStockButton из layout Барбекю Парка

**Приоритет:** Should Have
**Сложность:** Trivial
**Риск:** Нулевой

### Текущее состояние

Файл `src/app/admin/gazebos/layout.tsx`:

```tsx
import { ReceiveStockButton } from "@/components/admin/receive-stock-button";
// ...
<AdminHeader title="Барбекю Парк" actions={<ReceiveStockButton />} />
```

Кнопка "Приход товара" была добавлена для инвентаризации, но для Барбекю Парка она не актуальна.

### Решение

Удалить import `ReceiveStockButton` и убрать `actions` prop:

```tsx
import { AdminHeader } from "@/components/admin/header";
import { ModuleTabs } from "@/components/admin/shared/module-tabs";

// ...
<AdminHeader title="Барбекю Парк" />
```

### Файлы

| Файл | Действие |
|------|----------|
| `src/app/admin/gazebos/layout.tsx` | Удалить import `ReceiveStockButton`, удалить `actions={<ReceiveStockButton />}` |

### Edge cases

- Если `AdminHeader` prop `actions` опционален -- просто не передавать. Если обязателен -- убедиться, что `actions?:` в типах.
- Компонент `ReceiveStockButton` не удаляем -- он может использоваться в других модулях.

---

## STORY-8: Мерж клиентов (объединение дубликатов)

**Приоритет:** Could Have
**Сложность:** Высокая
**Риск:** Средний (необратимая мутация данных)

### Проблема

Один и тот же человек может зарегистрироваться через разные провайдеры (Telegram, Google, email) и получить несколько записей User. Менеджеры видят дубликаты в списке клиентов. Нужен механизм объединения.

### API-контракт

#### `POST /api/admin/clients/merge`

**Авторизация:** SUPERADMIN only

**Request:**

```ts
{
  primaryId: string;    // ID клиента, который останется (primary)
  secondaryId: string;  // ID клиента, который будет поглощён (secondary)
}
```

**Zod-схема:**

```ts
export const mergeClientsSchema = z.object({
  primaryId: z.string().min(1, "primaryId обязателен"),
  secondaryId: z.string().min(1, "secondaryId обязателен"),
}).refine(
  (data) => data.primaryId !== data.secondaryId,
  { message: "Нельзя мержить клиента с самим собой" }
);
```

**Response (success):**

```json
{
  "success": true,
  "data": {
    "primaryId": "clxyz...",
    "merged": {
      "bookings": 3,
      "orders": 1,
      "accounts": 1,
      "auditLogs": 5,
      "feedbackItems": 0,
      "notificationLogs": 2
    },
    "deletedUserId": "clabc..."
  }
}
```

**Response (errors):**

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Не авторизован |
| `FORBIDDEN` | 403 | Не SUPERADMIN |
| `CLIENT_NOT_FOUND` | 404 | primary или secondary не найден |
| `NOT_A_CLIENT` | 400 | Один из ID -- не USER (MANAGER или SUPERADMIN) |
| `MERGE_SAME_USER` | 400 | primaryId === secondaryId |
| `INTERNAL_ERROR` | 500 | Ошибка транзакции |

### Preview endpoint

#### `GET /api/admin/clients/merge/preview?primaryId=X&secondaryId=Y`

**Авторизация:** SUPERADMIN only

**Response:**

```json
{
  "success": true,
  "data": {
    "primary": {
      "id": "clxyz...",
      "name": "Иван Иванов",
      "email": "ivan@gmail.com",
      "phone": null,
      "telegramId": "123456",
      "bookingCount": 5,
      "orderCount": 2
    },
    "secondary": {
      "id": "clabc...",
      "name": "Ivan Ivanov",
      "email": null,
      "phone": "+79991234567",
      "telegramId": null,
      "bookingCount": 3,
      "orderCount": 1
    },
    "conflicts": [
      "У обоих клиентов есть email -- будет использован email primary"
    ]
  }
}
```

### Бизнес-логика мержа

Реализация в `src/modules/clients/service.ts`:

```ts
export async function mergeClients(
  primaryId: string,
  secondaryId: string,
  performedById: string
): Promise<MergeResult>
```

#### Алгоритм (в единой Prisma `$transaction`):

1. **Валидация**: оба пользователя существуют и имеют `role: USER`
2. **Перенос связей** (UPDATE foreign keys):
   - `Booking.userId: secondaryId -> primaryId`
   - `Order.userId: secondaryId -> primaryId`
   - `Account.userId: secondaryId -> primaryId`
   - `AuditLog.userId: secondaryId -> primaryId`
   - `NotificationLog.userId: secondaryId -> primaryId`
   - `FeedbackItem.userId: secondaryId -> primaryId`
   - `Session.userId: secondaryId -> primaryId`
   - `NotificationPreference`: если у primary нет -- перенести, иначе удалить secondary
   - `ModuleAssignment`: если у primary нет для данного модуля -- перенести, иначе удалить дубль
3. **Обогащение primary** (заполнить пустые поля из secondary):
   - `phone`: если у primary null, взять из secondary
   - `email`: если у primary null, взять из secondary (unique constraint!)
   - `name`: если у primary null, взять из secondary
   - `image`: если у primary null, взять из secondary
   - `telegramId`: если у primary null, взять из secondary (unique constraint!)
   - `vkId`: если у primary null, взять из secondary (unique constraint!)
4. **Удалить secondary user** (`DELETE FROM User WHERE id = secondaryId`)
5. **Audit log**: записать `action: "clients.merge"` с metadata содержащим обе стороны

#### Проблема unique constraints

Если у обоих пользователей есть `email`/`telegramId`/`vkId` -- перенос невозможен без потери данных. Решение:
- Primary сохраняет свои значения
- Secondary значения записываются в audit log как "потерянные" данные
- UI-preview предупреждает о конфликтах

### Структура файлов

```
src/modules/clients/
  service.ts        -- добавить mergeClients(), previewMerge()
  types.ts          -- добавить MergeResult, MergePreview
  validation.ts     -- добавить mergeClientsSchema, mergePreviewSchema

src/app/api/admin/clients/merge/
  route.ts          -- POST handler
  preview/
    route.ts        -- GET handler

src/components/admin/clients/
  client-profile.tsx    -- добавить кнопку "Объединить с другим клиентом"
  merge-dialog.tsx      -- новый: модальное окно мержа (поиск, preview, подтверждение)
```

### UI-флоу мержа

1. Админ открывает профиль клиента A
2. Нажимает кнопку "Объединить с другим клиентом"
3. Открывается модальное окно с поиском клиентов (по имени/email/телефону)
4. Выбирает клиента B
5. Показывается preview: карточки обоих клиентов, стрелка, предупреждения о конфликтах
6. Клиент A помечен как "Primary" (останется), клиент B как "будет удалён"
7. Кнопка "Подтвердить объединение" (красная, с подтверждением)
8. После мержа -- redirect на профиль primary клиента

### Файлы

| Файл | Действие |
|------|----------|
| `src/modules/clients/service.ts` | Добавить `mergeClients()`, `previewMerge()` |
| `src/modules/clients/types.ts` | Добавить `MergeResult`, `MergePreview`, `MergeConflict` |
| `src/modules/clients/validation.ts` | Добавить `mergeClientsSchema`, `mergePreviewSchema` |
| `src/app/api/admin/clients/merge/route.ts` | Новый: POST handler |
| `src/app/api/admin/clients/merge/preview/route.ts` | Новый: GET handler |
| `src/components/admin/clients/client-profile.tsx` | Добавить кнопку "Объединить" |
| `src/components/admin/clients/merge-dialog.tsx` | Новый: модальное окно мержа |

### Тесты

```
src/modules/clients/__tests__/
  service.test.ts   -- добавить тесты: mergeClients happy path, конфликты, ошибки
  validation.test.ts -- добавить тесты: mergeClientsSchema
```

Тест-кейсы для `mergeClients`:
1. Happy path: перенос всех связей, обогащение полей
2. Unique constraint конфликт: оба имеют email
3. Primary не найден -> ошибка
4. Secondary не найден -> ошибка
5. Один из них не USER -> ошибка
6. primaryId === secondaryId -> ошибка
7. Транзакционность: если один UPDATE упал -- все откатывается

### Edge cases

- **Concurrent merge**: два админа мержат одного клиента одновременно. Prisma транзакция обеспечивает serialization. Второй вызов упадёт с "User not found".
- **Self-referencing records**: если у secondary есть AuditLog со ссылкой на действия с primary -- это нормально, переносим userId.
- **Foreign key cascade**: `Account` имеет `onDelete: Cascade` -- удаление secondary User удалит его Account. Поэтому сначала переносим Account, потом удаляем User.
- **Sessions**: после мержа secondary теряет все активные сессии. Это ожидаемое поведение.

---

## STORY-12: Хелпер-помощник в админке

**Приоритет:** Could Have
**Сложность:** Средняя
**Риск:** Нулевой (только добавление UI)

### Концепция

Компонент `AdminHelper` -- плавающая иконка "?" в углу каждого раздела админки. При клике показывает контекстные подсказки для текущего раздела. Подсказки хранятся в словаре, привязанном к slug раздела.

### Структура данных подсказок

Файл `src/lib/admin-hints.ts`:

```ts
export type AdminHint = {
  title: string;
  text: string;
};

export type AdminHintSection = {
  sectionTitle: string;
  hints: AdminHint[];
};

export const ADMIN_HINTS: Record<string, AdminHintSection> = {
  dashboard: {
    sectionTitle: "Дашборд",
    hints: [
      {
        title: "Общий обзор",
        text: "Дашборд показывает сводку по всем модулям. Карточки обновляются каждые 5 минут.",
      },
      {
        title: "Статусы модулей",
        text: "Зелёный -- модуль работает. Жёлтый -- есть предупреждения. Красный -- ошибки.",
      },
    ],
  },
  gazebos: {
    sectionTitle: "Барбекю Парк",
    hints: [
      {
        title: "Расписание",
        text: "Нажмите на ячейку в расписании чтобы создать бронирование. Перетащите для изменения времени.",
      },
      {
        title: "Подтверждение",
        text: "Новые бронирования имеют статус 'Ожидает'. Нажмите на бронирование чтобы подтвердить или отменить.",
      },
    ],
  },
  "ps-park": {
    sectionTitle: "Плей Парк",
    hints: [
      {
        title: "Управление сменой",
        text: "Откройте смену в начале рабочего дня. Все платежи привязываются к текущей смене.",
      },
      {
        title: "Оплата",
        text: "Выберите способ оплаты (нал/карта) при закрытии сессии. Сумма рассчитывается автоматически.",
      },
    ],
  },
  cafe: {
    sectionTitle: "Кафе",
    hints: [
      {
        title: "Управление меню",
        text: "Добавляйте и редактируйте позиции меню. Отключённые позиции не видны клиентам.",
      },
    ],
  },
  rental: {
    sectionTitle: "Аренда",
    hints: [
      {
        title: "Статусы договоров",
        text: "EXPIRING ставится автоматически за 30 дней до окончания. Проверяйте раздел 'Истекающие'.",
      },
      {
        title: "Заявки на аренду",
        text: "Новые заявки приходят с сайта. Обработайте и отметьте статус.",
      },
    ],
  },
  clients: {
    sectionTitle: "Клиенты",
    hints: [
      {
        title: "Поиск",
        text: "Ищите клиентов по имени, email или телефону. Фильтруйте по модулю.",
      },
    ],
  },
  users: {
    sectionTitle: "Пользователи",
    hints: [
      {
        title: "Роли",
        text: "SUPERADMIN -- полный доступ. MANAGER -- только назначенные разделы. USER -- клиент.",
      },
      {
        title: "Назначение разделов",
        text: "Менеджеру можно назначить доступ к нескольким разделам через чекбоксы.",
      },
    ],
  },
  monitoring: {
    sectionTitle: "Мониторинг",
    hints: [
      {
        title: "Уровни событий",
        text: "CRITICAL -- немедленное действие. ERROR -- разобраться в течение часа. WARNING -- информация.",
      },
    ],
  },
  feedback: {
    sectionTitle: "Обратная связь",
    hints: [
      {
        title: "Срочные обращения",
        text: "Срочные обращения помечены красным и отправляют Telegram-алерт.",
      },
    ],
  },
};
```

### Компонент AdminHelper

Файл `src/components/admin/admin-helper.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ADMIN_HINTS } from "@/lib/admin-hints";

type Props = {
  sectionSlug: string;
};

export function AdminHelper({ sectionSlug }: Props) {
  const [open, setOpen] = useState(false);

  const section = ADMIN_HINTS[sectionSlug];
  if (!section) return null;  // Нет подсказок для раздела -- не рендерим

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
        title="Подсказки"
      >
        ?
      </button>

      {/* Panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-20 right-6 z-50 w-80 max-h-96 overflow-y-auto rounded-xl bg-white border border-zinc-200 shadow-xl p-4 space-y-3">
            <h3 className="font-semibold text-zinc-900 text-sm">
              {section.sectionTitle}
            </h3>
            {section.hints.map((hint, i) => (
              <div key={i} className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">
                  {hint.title}
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  {hint.text}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
```

### Интеграция

Добавить `AdminHelper` в layout каждого раздела админки. Поскольку slug раздела определяется роутом, можно добавить в каждый layout или создать wrapper.

**Рекомендуемый подход:** Добавить в `src/app/admin/layout.tsx` с определением slug из pathname:

```tsx
import { Sidebar } from "@/components/admin/sidebar";
import { FeedbackButton } from "@/components/public/feedback-button";
import { AdminHelperWrapper } from "@/components/admin/admin-helper-wrapper";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-zinc-50">{children}</main>
      <FeedbackButton />
      <AdminHelperWrapper />
    </div>
  );
}
```

`AdminHelperWrapper` -- клиентский компонент, который использует `usePathname()` для определения slug:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { AdminHelper } from "./admin-helper";

export function AdminHelperWrapper() {
  const pathname = usePathname();
  // Extract section slug: /admin/gazebos/bookings -> "gazebos"
  const match = pathname.match(/^\/admin\/([^/]+)/);
  const slug = match?.[1] || "dashboard";

  return <AdminHelper sectionSlug={slug} />;
}
```

### Файлы

| Файл | Действие |
|------|----------|
| `src/lib/admin-hints.ts` | Новый: словарь подсказок по разделам |
| `src/components/admin/admin-helper.tsx` | Новый: компонент плавающей кнопки с подсказками |
| `src/components/admin/admin-helper-wrapper.tsx` | Новый: wrapper с usePathname() |
| `src/app/admin/layout.tsx` | Добавить `<AdminHelperWrapper />` |

### Edge cases

- Раздел без подсказок -- компонент не рендерится (null)
- Мобильный экран -- кнопка может перекрывать контент. Добавить `bottom-20` на мобильных (чтобы не перекрывать FeedbackButton)
- Коллизия с FeedbackButton (обе floating, обе в правом нижнем углу):
  - **Решение:** FeedbackButton оставить `bottom-6 right-6`, AdminHelper сдвинуть на `bottom-6 right-20` (или `bottom-20 right-6` -- вертикально). Либо объединить в один floating menu.
  - **Рекомендация:** AdminHelper расположить `bottom-6 right-20` (левее FeedbackButton).

### Тесты

Юнит-тесты не критичны для этого компонента (чистый UI). Но стоит добавить:

```ts
// src/lib/__tests__/admin-hints.test.ts
import { ADMIN_HINTS } from "@/lib/admin-hints";

describe("admin-hints", () => {
  it("has hints for all major sections", () => {
    const requiredSections = ["dashboard", "gazebos", "ps-park", "cafe", "rental", "clients"];
    for (const section of requiredSections) {
      expect(ADMIN_HINTS[section]).toBeDefined();
      expect(ADMIN_HINTS[section].hints.length).toBeGreaterThan(0);
    }
  });

  it("all hints have title and text", () => {
    for (const [, section] of Object.entries(ADMIN_HINTS)) {
      for (const hint of section.hints) {
        expect(hint.title).toBeTruthy();
        expect(hint.text).toBeTruthy();
      }
    }
  });
});
```

---

## Сводная таблица изменений

| # | Story | Приоритет | Файлы (изм.) | Файлы (новые) | Миграция БД | API изменения |
|---|-------|-----------|-------------|--------------|-------------|---------------|
| 1 | 30 км | Must | 1 | 0 | Нет | Нет |
| 3 | Кэш | Must | 1 | 0 | Нет | Нет |
| 6 | Feedback | Must | 2 | 0 | Нет | Нет |
| 11 | Бекап | Must | 1 | 1 | Нет | Нет |
| 2 | Офисы | Should | 3 | 1 | Нет | Расширение Zod |
| 4 | Кафе hide | Should | 2 | 0 | Нет | Нет |
| 7 | Провайдеры | Should | 4 | 0 | Нет | Расширение response |
| 9 | Seed rental | Should | 1 | 0 | Нет | Нет |
| 10 | Stock btn | Should | 1 | 0 | Нет | Нет |
| 8 | Мерж | Could | 3 | 4 | Нет | 2 новых endpoint |
| 12 | Хелпер | Could | 1 | 3 | Нет | Нет |

**Итого:** 20 файлов изменено, 9 новых файлов, 0 миграций БД.

---

## Порядок реализации

### Batch 1: Trivial fixes (STORY-1, 4, 10)
Три правки без зависимостей, каждая -- отдельный коммит. Деплой сразу.

### Batch 2: Infrastructure (STORY-3, 11)
Кэш-заголовки и бекапы. Тестировать на staging перед production.

### Batch 3: FeedbackButton move (STORY-6)
Простое перемещение, но важно проверить, что FeedbackButton корректно работает в admin layout.

### Batch 4: Data enrichment (STORY-7, 9)
Расширение данных клиентов (провайдеры) и загрузка rental data. Независимые задачи.

### Batch 5: Rental UX (STORY-2)
Самая объёмная Should Have правка. Включает рефакторинг страницы и формы.

### Batch 6: Advanced features (STORY-8, 12)
Could Have -- мерж клиентов и хелпер. Реализуются после стабилизации Must Have и Should Have.

---

## Решение

Принят **Вариант: Инкрементальные правки** -- каждая story реализуется в отдельном коммите, деплоится независимо. Никаких миграций БД, никаких breaking changes в API. Порядок: Must Have -> Should Have -> Could Have.

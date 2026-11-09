# Деловой Парк — Платформа управления бизнес-парком

> Цифровая платформа для бизнес-парка «Деловой» (Селятино, Московская область).  
> B2C-сервисы для клиентов + B2B-инструменты для менеджеров и администраторов.

---

## Модули

| Модуль | Описание |
|--------|----------|
| **Барбекю Парк** | Онлайн-бронирование беседок с календарём доступности |
| **Плей Парк** | Бронирование игровых столов |
| **Кафе** | Меню, заказы, доставка в офис |
| **Парковка** | Информация о местах и правилах |
| **Аренда офисов** | CRM арендаторов, договоры, финансовая отчётность |
| **Дашборд архитектора** | Карта системы, аналитика, логи и аудит |

---

## Стек

![Next.js](https://img.shields.io/badge/Next.js_16-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)

- **Next.js 16** — App Router, Server Components, Route Handlers как REST API
- **Prisma** — type-safe ORM, миграции
- **PostgreSQL** — реляционная БД для бронирований, договоров, финансов
- **Redis** — сессии, кэш, rate limiting
- **NextAuth.js v5** — RBAC (SUPERADMIN / MANAGER / USER), JWT
- **Vitest** — unit и integration тесты; **Playwright** — E2E

---

## Архитектура

```
Клиенты (Web / Telegram Bot)
        │
        ▼
API Gateway + Auth (RBAC) — Next.js Route Handlers
        │
  ┌─────┼─────┐
  ▼     ▼     ▼
Auth  Notify  Pay   ← Общие сервисы
        │
  ┌─────┼──────────┐
  ▼     ▼          ▼
Кафе  Беседки  Аренда офисов  ← Domain Modules
        │
   PostgreSQL + Redis
```

---

## Быстрый старт

Нужны Node.js ≥ 22 и Docker.

```bash
# 1. Зависимости
npm install

# 2. Окружение
cp .env.example .env
# Заполнить DATABASE_URL, REDIS_URL, AUTH_SECRET

# 3. Postgres + Redis для разработки
npm run dev:docker            # docker compose -f docker-compose.dev.yml up -d

# 4. Схема БД и справочные данные
npx prisma migrate deploy
npm run db:seed

# 5. Dev-сервер
npm run dev
```

Открыть: [http://localhost:3000](http://localhost:3000). Остановить БД:
`npm run dev:stop` (данные сохранятся) или `docker compose -f docker-compose.dev.yml down -v` (с удалением).

## Команды

```bash
npm run dev           # dev-сервер
npm run lint          # ESLint
npm run typecheck     # TypeScript: приложение + Telegram-бот
npm test              # Vitest
npm run e2e           # Playwright
npm run db:migrate    # новая миграция (prisma migrate dev)
npm run db:studio     # Prisma Studio
```

## Разработка

Правила кода, модули и процесс — в [`CLAUDE.md`](./CLAUDE.md). Коротко: ветка
`claude/*` или `feature/*` → PR → зелёный CI → мерж руками; мерж в `main`
выкатывает прод. Деплой и инфраструктура — [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Роли

| Роль | Доступ |
|------|--------|
| `SUPERADMIN` | Всё: все модули, настройки, мониторинг, пользователи |
| `MANAGER` | Только свой модуль: брони, заказы, настройки |
| `USER` | Публичные страницы, личный кабинет |

---

## Локация

**Бизнес-парк «Деловой»** — Селятино, Московская область

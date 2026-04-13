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
- **Prisma** — type-safe ORM, миграции, 16 моделей
- **PostgreSQL** — реляционная БД для бронирований, договоров, финансов
- **Redis** — сессии, кэш, rate limiting
- **NextAuth.js v5** — RBAC (SUPERADMIN / MANAGER / USER), JWT
- **Vitest** — 180+ unit и integration тестов

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

```bash
# 1. Клонировать и установить зависимости
git clone https://github.com/aylisrg/platform-delovoy.git
cd platform-delovoy
npm install

# 2. Настроить окружение
cp .env.example .env
# Заполнить DATABASE_URL, REDIS_URL, NEXTAUTH_SECRET

# 3. Запустить БД и Redis
docker compose up -d

# 4. Применить схему БД и заполнить данными
npx prisma migrate deploy
npm run db:seed

# 5. Запустить сервер
npm run dev
```

Открыть: [http://localhost:3000](http://localhost:3000)

---

## Роли

| Роль | Доступ |
|------|--------|
| `SUPERADMIN` | Всё: все модули, настройки, мониторинг, пользователи |
| `MANAGER` | Только свой модуль: брони, заказы, настройки |
| `USER` | Публичные страницы, личный кабинет |

---

## Тесты

```bash
npm test              # Запуск тестов
npm run test:coverage # Покрытие
```

---

## Дорожная карта

- [x] Phase 0 — Фундамент (Next.js, Prisma, Docker, Auth, API, Мониторинг)
- [x] Phase 1 — Барбекю Парк (бронирование, Telegram-бот, уведомления)
- [x] Phase 2 — Плей Парк, Кафе, Парковка, личный кабинет
- [x] Phase 3 — B2B: Аренда офисов, CRM, договоры, финансы
- [x] Phase 4 — Дашборд архитектора (карта системы, конфиг, аналитика, логи)

---

## Локация

**Бизнес-парк «Деловой»** — Селятино, Московская область

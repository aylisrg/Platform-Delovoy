# Правила разработки — Platform Delovoy

> Правила Git Flow, CI и локальной разработки.

---

## 1. Локальная разработка

### Быстрый старт

```bash
# 1. Поднять БД и Redis
docker compose -f docker-compose.dev.yml up -d

# 2. Скопировать .env
cp .env.example .env

# 3. Установить зависимости и создать схему БД
npm install
npm run db:push
npm run db:seed

# 4. Запустить dev-сервер
npm run dev
```

Сайт: http://localhost:3000
Админка: http://localhost:3000/admin/dashboard (admin@delovoy-park.ru / admin123)

### Полезные команды

```bash
npm run dev          # Dev-сервер с hot reload
npm test             # Запуск тестов
npm run lint         # Линтер
npm run build        # Production-сборка
npm run db:studio    # Prisma Studio (визуальный редактор БД)
npm run db:push      # Применить схему к БД
npm run db:seed      # Заполнить тестовыми данными
```

### Остановить БД

```bash
docker compose -f docker-compose.dev.yml down        # Остановить (данные сохранятся)
docker compose -f docker-compose.dev.yml down -v      # Остановить и удалить данные
```

---

## 2. Ветки и Git Flow

### Структура веток

```
main                    <- production
├── claude/{task}       <- ветки от Claude Code (CI, затем PR)
├── feature/{task}      <- ветки разработчиков (CI, затем PR)
└── hotfix/{task}       <- срочные фиксы
```

### Правила коммитов

Формат: `type: краткое описание`

| Тип | Когда |
|---|---|
| `feat` | Новая функциональность |
| `fix` | Баг-фикс |
| `refactor` | Рефакторинг без изменения поведения |
| `ci` | Изменения CI/CD |
| `docs` | Документация |
| `chore` | Зависимости, конфиг, мелочи |

### CI на ветках

Workflow `.github/workflows/ci.yml` при пуше в любую ветку запускает:
- `npm run lint`
- `npm test`
- `npm run build`

**Автомерж отключён.** Для попадания в `main` нужно создать PR и получить одобрение.

---

## 3. Чеклист перед коммитом

- [ ] Тесты проходят (`npm test`)
- [ ] Линтер чист (`npm run lint`)
- [ ] Сборка проходит (`npm run build`)
- [ ] `.env.example` обновлён если добавлены новые переменные
- [ ] Коммит-месседж следует конвенции

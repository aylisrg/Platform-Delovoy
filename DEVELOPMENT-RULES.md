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

**Автомерж включён для очереди агента** (ветки `claude/**`) — после зелёного CI и вердикта PASS от `code-reviewer`/`qa-engineer` PR домержит `.github/workflows/issue-queue-merge.yml` без участия владельца. Ручного мержа (кнопкой в Telegram) требует только один класс: PR, трогающий рубильники самой автоматики (`scripts/issue-queue.ts gate <PR>` вернёт `hold`) — деструктивные миграции и широкие PR больше не держат мерж, риск принят владельцем явно (ADR `docs/architecture/2026-08-24-remove-migration-width-holds-adr.md`). Ветки `feature/**`, `release-please--*` и ручные PR владельца по-прежнему мержатся вручную. Подробности — `CLAUDE.md` (раздел «Git») и ADR `docs/architecture/2026-08-10-autonomous-issue-cleanup-adr.md`.

---

## 3. Чеклист перед коммитом

- [ ] Тесты проходят (`npm test`)
- [ ] Линтер чист (`npm run lint`)
- [ ] Сборка проходит (`npm run build`)
- [ ] `.env.example` обновлён если добавлены новые переменные
- [ ] Коммит-месседж следует конвенции

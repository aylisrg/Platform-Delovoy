# MCP Servers для Platform Delovoy

[Model Context Protocol](https://modelcontextprotocol.io) — стандарт от Anthropic для подключения AI-агентов к внешним инструментам. Мы используем MCP чтобы дать агентам контролируемый доступ к БД, ФС и браузеру.

## Конфигурация

`.mcp.json` в корне репозитория — проектный конфиг. Claude Code автоматически подхватывает его при старте сессии из этого каталога.

| Сервер | Кто использует | Разрешения |
|--------|---------------|-----------|
| **postgres** | Architect (research схемы), Analyst (запросы) | read-only, только на dev-БД |
| **filesystem** | Все агенты | scoped на корень репо, без `..` |
| **playwright** | QA (E2E smoke tests) | ограниченный set URL из env |

## Переменные окружения

MCP-сервера читают переменные из окружения Claude Code сессии. Убедись что в `.env.local` (не коммитить!) есть:

```env
DATABASE_URL="postgresql://readonly_user:password@localhost:5432/delovoy_park"
```

⚠️ **Важно:** Postgres MCP-сервер получает `DATABASE_URL`. Используй **отдельного read-only пользователя** БД, не `delovoy` (см. `scripts/setup-db-roles.sql`). Это защита от случайных DROP/UPDATE агентом.

## Установка read-only пользователя

Один раз:

```bash
# На сервере БД
psql -U postgres -d delovoy_park -c "
CREATE USER readonly_agent WITH PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE delovoy_park TO readonly_agent;
GRANT USAGE ON SCHEMA public TO readonly_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_agent;
"
```

Потом в `.env.local` для Claude Code:

```env
DATABASE_URL="postgresql://readonly_agent:CHANGE_ME@localhost:5432/delovoy_park"
```

## Использование в агентах

### Architect
Вместо того чтобы читать `prisma/schema.prisma` и строить в уме граф связей, агент может задать SQL:

```
MCP postgres query: SELECT column_name, data_type FROM information_schema.columns WHERE table_name='bookings';
```

### Analyst
Прямой доступ к агрегациям вместо написания SQL в Markdown:

```
MCP postgres query: SELECT date_trunc('week', created_at) as week, count(*) FROM bookings GROUP BY 1;
```

### QA (Playwright)
E2E smoke-тесты: открыть страницу бронирования, заполнить форму, проверить что создаётся запись в БД.

## Security

1. **Никогда не коммить `.env.local`** — `.gitignore` уже покрывает
2. **Read-only пользователь для Postgres MCP** — даже если агент попробует UPDATE, БД откажет
3. **Сетевой доступ ограничен** — Playwright работает только с dev/staging доменами из env
4. **Логи MCP** — хранятся в Claude Code session log, смотреть через `/cost` и `/doctor`

## Проблемы и диагностика

| Симптом | Решение |
|---------|---------|
| `MCP server exited with code 1` | Проверь `DATABASE_URL` / доступ к БД |
| `Tool 'postgres' not found` | Убедись что `.mcp.json` видится — `ls .mcp.json`, перезапусти Claude Code |
| `Permission denied writing` | `filesystem` scope правильный, но агент пытается писать вне репо — это by design |
| Playwright зависает | Проверь `PLAYWRIGHT_BASE_URL` в env, убедись что dev-сервер запущен |

## Что НЕ добавляем

- **git MCP** — уже есть в Claude Code встроенно
- **github MCP** — уже есть (см. «GitHub Integration» в настройках Claude Code)
- **slack / email MCP** — нет необходимости в pipeline, оповещения через Telegram-бот

## См. также

- `agents/SECURITY.md` — security guardrails агентов (актуально для всех MCP)
- [MCP официальная документация](https://modelcontextprotocol.io/docs)
- [Список готовых серверов](https://github.com/modelcontextprotocol/servers)

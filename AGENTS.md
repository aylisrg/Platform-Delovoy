# AGENTS.md — Platform Delovoy

Точка входа для AI-агентов, которые не читают `CLAUDE.md` (Cursor, Codex, Aider и др.).

**Единственный источник правил — [`CLAUDE.md`](./CLAUDE.md)**: стек, структура, модули, RBAC, API-конвенции, процесс и тесты. Здесь ничего не дублируется.

Коротко:
- Бизнес-логика — в `src/modules/{slug}/service.ts`; route handler только парсит, валидирует (Zod), вызывает сервис и отвечает через `apiResponse()`/`apiError()`.
- TypeScript strict, без `any`; тесты в том же коммите (`npm test`, Vitest, БД мокается).
- Перед пушем: `npm run lint`, `npm run typecheck`, `npm test`.
- Ветка `claude/{task}` или `feature/{module}-{feature}` → PR → зелёный CI → мерж делает человек.
- Безопасность — [`docs/security-checklist.md`](./docs/security-checklist.md).

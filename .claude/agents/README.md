# Native Claude Code Sub-Agents — Platform Delovoy

Это **native sub-agents** (формат Claude Code с YAML frontmatter). Claude автоматически подхватывает их и может делегировать задачи через Agent tool:

```
Agent({
  subagent_type: "product-owner",
  prompt: "Напиши PRD для онлайн-оплаты беседок"
})
```

## Как это работает

Каждый sub-agent:
- Имеет YAML frontmatter: `name`, `description`, `tools`, `model`
- Тонкая обёртка над подробным промптом в `agents/<role>.md` (корень репо)
- Подгружает полную роль через `Read agents/<role>.md` при старте
- Работает в изолированном контексте (не засоряет основную сессию)

## Доступные sub-agents

| `subagent_type` | Роль | Модель | Когда использовать |
|-----------------|------|--------|-------------------|
| `product-owner` | PRD, user stories, AC | sonnet | Новая фича — перед Architect |
| `system-architect` | ADR, схема БД, API-контракты | opus | Критичные технические решения, изменения схемы |
| `senior-developer` | Реализация кода + тестов | opus | Основная реализация по готовому ADR |
| `code-reviewer` | LLM-as-Judge проверка PRD/ADR | sonnet | После Developer, до QA |
| `qa-engineer` | Функциональная проверка AC, тесты | sonnet | После Reviewer=PASS |
| `product-analyst` | Метрики, отчёты, гипотезы | sonnet | Обоснование приоритетов, оценка эффекта фич |

## Два источника правды для промптов

Мы сохраняем **обе версии** промптов:

1. **`.claude/agents/<role>.md`** — native sub-agent (короткая обёртка с YAML). Используется автоматически Claude Code.
2. **`agents/<role>.md`** — подробный промпт (полная роль, чеклисты, anti-patterns, примеры). Используется:
   - `scripts/pipeline.sh` через `--append-system-prompt`
   - Читается native sub-agent'ом в первом действии
   - Справочник для людей

**Обновлять нужно `agents/<role>.md` — native-файлы-обёртки ссылаются на него.**

## Версионирование

Версии промптов tracked в `agents/CHANGELOG.md`. При breaking change в промпте:
1. Обновить `agents/<role>.md`
2. Инкрементировать версию в `agents/CHANGELOG.md`
3. Прогнать eval-датасет (`npm run agents:eval`) — убедиться что нет регрессии

## См. также

- `agents/README.md` — полный гайд по pipeline (5 стадий, feedback loops, артефакты)
- `agents/SECURITY.md` — security guardrails для всех ролей
- `.claude/commands/feature.md` — slash-command `/feature` для ручной координации
- `scripts/pipeline.sh` — автономный pipeline (все 5 стадий в одном прогоне)

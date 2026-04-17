# Agents Changelog

> История изменений промптов агентов. Каждый агент версионируется независимо.
> При breaking change — bump major, прогонять eval-датасет (`npm run agents:eval`).

Формат — [Keep a Changelog](https://keepachangelog.com/), semver.

---

## [1.1.0] — 2026-04-16

### Added
- `agents/SECURITY.md` — единый набор правил безопасности (prompt injection, data leakage, RBAC, supply chain, logging инцидентов).
- Секция `## Security` в каждом агенте (`po.md`, `architect.md`, `developer.md`, `reviewer.md`, `qa.md`, `analytics.md`) со ссылкой на `SECURITY.md` и специфичными для роли правилами.
- Native Claude Code sub-agents в `.claude/agents/*.md` с YAML frontmatter:
  - `product-owner`, `system-architect`, `senior-developer`, `code-reviewer`, `qa-engineer`, `product-analyst`.
- Документация `parallel-pipeline.sh` в `agents/README.md`.
- JSON-метрики стадий pipeline (`docs/pipeline-runs/<RUN_ID>.metrics.jsonl`).
- Дашборд `/admin/monitoring/pipelines` — агрегаты + список прогонов.
- State file (`<RUN_ID>.state.json`) для будущего `--resume`.

### Changed
- `.claude/commands/feature.md` — 4 стадии → 5 стадий (добавлен Reviewer между Developer и QA).
- `scripts/pipeline.sh`:
  - `run_dev_qa_loop` разделён на `run_review_loop` + `run_qa_loop`.
  - Reviewer-verdict теперь парсится и запускает Developer-fix итерации.
  - Каждая стадия логирует JSON-метрику (stage, model, duration, verdict, exit_code).
  - Сохранение состояния (`completed_stages`) после каждой стадии.

### Agent versions bumped
- `po` → 1.1.0 (security section)
- `architect` → 1.1.0 (security section)
- `developer` → 1.1.0 (security section, qa-patterns feedback)
- `reviewer` → 1.1.0 (security обязательная часть ревью)
- `qa` → 1.1.0 (функциональные security-кейсы)
- `analytics` → 1.1.0 (read-only, no PII)

---

## [1.0.0] — 2026-04-09

### Added
- Базовые роли: PO, Architect, Developer, QA в `agents/*.md`.
- `scripts/pipeline.sh` — автономный pipeline с feedback loop QA ↔ Developer.
- `scripts/collect-qa-feedback.sh` — self-improving паттерны ошибок.
- `.claude/commands/feature.md` — slash-команда `/feature`.
- `agents/README.md` — гайд по pipeline и ролям.
- Опциональный Reviewer-агент (LLM-as-Judge).
- Analyst-агент для продуктовой аналитики.

---

## Политика версионирования

Каждый промпт в `agents/<role>.md` следует **semver**:

- **MAJOR** — удаление/радикальное изменение роли, меняет артефакты, ломает pipeline (обновить эталонный датасет eval).
- **MINOR** — новые правила, секции, расширенный чеклист (backward compatible, eval не должен регрессировать).
- **PATCH** — опечатки, форматирование, уточнения без смысловых изменений.

### Как bump'нуть версию агента

1. Обнови `agents/<role>.md`.
2. Добавь запись в этот CHANGELOG (название агента, тип изменения, новая версия).
3. Прогони eval: `npm run agents:eval -- --agent <role>` (после того как eval-фреймворк появится).
4. При падении eval — откат или фикс в той же ветке, MAJOR bump.
5. Создай git-тэг при релизе: `git tag agents-v<major>.<minor>.<patch>`.

### Актуальные версии

| Agent      | Version |
|------------|---------|
| po         | 1.1.0   |
| architect  | 1.1.0   |
| developer  | 1.1.0   |
| reviewer   | 1.1.0   |
| qa         | 1.1.0   |
| analytics  | 1.1.0   |

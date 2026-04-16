# Агенты Platform Delovoy

Набор специализированных промптов для Claude Code. Каждый агент — роль со своей зоной ответственности, артефактами и правилами.

---

## Быстрый старт

### Вариант 1: Автономный пайплайн (рекомендуется)

Запусти полный цикл разработки одной командой — PO → Architect → Developer → Reviewer → QA работают последовательно с автоматическим feedback loop:

```bash
# Полный пайплайн: PO → Architect → Developer → Reviewer → QA
./scripts/pipeline.sh "Сделать мега-лендинг с анимациями и waitlist-формой"

# Только конкретные этапы
./scripts/pipeline.sh --stages po,architect "Спроектировать систему уведомлений"

# Начать с определённого этапа (если PRD уже есть)
./scripts/pipeline.sh --from developer "Реализовать онлайн-оплату беседок"

# Dry run — посмотреть что будет запущено
./scripts/pipeline.sh --dry-run "Добавить тёмную тему"

# Без автоматического создания PR
./scripts/pipeline.sh --no-pr "Рефакторинг модуля кафе"

# Настроить макс. итераций QA-фидбека
./scripts/pipeline.sh --max-iterations 5 "Критичная фича с жёстким QA"
```

**Env-переменные:**
- `PIPELINE_BUDGET` — макс. бюджет на этап в USD (default: `5.00`)
- `PIPELINE_MAX_QA_ITERATIONS` — макс. итераций QA↔Developer (default: `3`)

Артефакты сохраняются в `docs/` и логи в `docs/pipeline-runs/`.

### Вариант 2: Параллельный прогон (несколько фич сразу)

Когда нужно прогнать несколько независимых задач одновременно — каждый pipeline работает в своём git worktree:

```bash
# 3 фичи параллельно (по умолчанию --max-parallel 3)
./scripts/parallel-pipeline.sh \
  "Добавить тёмную тему" \
  "Интеграция с 1С" \
  "Рефакторинг кафе"

# Ограничить до 2 параллельных
./scripts/parallel-pipeline.sh --max-parallel 2 "Task A" "Task B" "Task C"

# Только до Architect (prd + adr без кодогенерации)
./scripts/parallel-pipeline.sh --stages po,architect "Task A" "Task B"

# Без PR
./scripts/parallel-pipeline.sh --no-pr "Task A" "Task B"
```

Каждая задача получает отдельный worktree в `/tmp/delovoy-parallel-<дата>/<slug>/` и свою ветку `feature/<RUN_ID>`. После завершения — сводка с URL'ами PR.

**Env-переменные:**
- `PARALLEL_MAX` — макс. одновременных pipeline (default: `3`)
- `PIPELINE_BUDGET` — проксируется в каждый pipeline.sh

Когда использовать: независимые фичи, которые не делят схему БД или общий код. Для связанных задач (меняют одну модель) используй последовательный `pipeline.sh` — иначе получишь merge-конфликты.

---

### Вариант 3: Через Claude Code `/feature` slash-command

В интерактивной сессии Claude Code:

```
/feature Сделать мега-лендинг с анимациями и waitlist-формой
```

Claude выступает координатором и вручную запускает 5 стадий (PO → Architect → Developer → Reviewer → QA), используя native sub-agents из `.claude/agents/`. Без автономного бюджета, с human-in-the-loop на каждой стадии.

---

### Вариант 4: Ручной запуск агента

Скопируй содержимое нужного `.md`-файла в начало диалога с Claude Code, затем ставь задачу.

```
# Пример: запуск Product Owner
> Скопируй agents/po.md → вставь в чат → опиши задачу
```

---

## Агенты

| Файл | Роль | Модель | Зона ответственности |
|------|------|--------|----------------------|
| `po.md` | Product Owner | Sonnet | Требования, user stories, приоритизация, roadmap |
| `architect.md` | System Architect | **Opus** | Архитектурные решения, схемы БД, API-дизайн, ADR |
| `developer.md` | Senior Developer | **Opus** | Реализация фич, рефакторинг, code review, тесты |
| `reviewer.md` | Code Reviewer (LLM-as-Judge) | Sonnet | Независимая проверка кода на соответствие PRD/ADR |
| `qa.md` | QA Engineer | Sonnet | Тест-планы, баг-репорты, регрессионное тестирование |
| `analytics.md` | Product Analyst | Sonnet | Метрики, аналитика, дашборды, A/B тесты |

---

## Куда агенты складывают артефакты

```
docs/
├── requirements/      ← PO: PRD, user stories, acceptance criteria
├── architecture/      ← Architect: ADR, диаграммы, API-спеки
├── qa-reports/        ← Reviewer: вердикты; QA: тест-планы, баг-репорты
├── context/           ← Shared: контекстный лог решений между стейджами
├── analytics/         ← Analyst: метрики, отчёты, гипотезы
└── pipeline-runs/     ← Логи выполнения pipeline
```

---

## Принципы работы

1. **Один агент — одна роль.** Не смешивай обязанности. PO не пишет код, Developer не приоритизирует фичи.
2. **Артефакты в docs/.** Каждый агент создаёт документы в своей папке с датой в имени файла: `YYYY-MM-DD-название.md`.
3. **CLAUDE.md — источник правды.** Все агенты следуют архитектуре, стеку и соглашениям из `CLAUDE.md`.
4. **Контекстный лог.** Каждый стейдж дописывает свои решения в `docs/context/{RUN_ID}-context.md`. Следующий стейдж читает его для полного контекста.
5. **Feedback loop.** QA находит баги → Developer чинит → QA перепроверяет (до 3 итераций).
6. **Auto PR.** После успешного завершения pipeline автоматически создаёт ветку и Pull Request.
7. **Контекст проекта.** Платформа "Деловой" — бизнес-парк (Селятино). Модули: кафе, Плей Парк, Барбекю Парк, парковка, аренда офисов. Стек: Next.js 15, Prisma, PostgreSQL, Redis.

---

## Цепочка работы над фичей

```
1. PO (Sonnet)     → docs/requirements/{id}-prd.md
                     + docs/context/{id}-context.md (решения PO)
                     │
2. Architect (Opus) → docs/architecture/{id}-adr.md
                     + docs/context/{id}-context.md (решения архитектора)
                     │
              ┌──── 3. Developer (Opus) → код в src/ + тесты
              │      │
              │     4. Reviewer (Sonnet) → docs/qa-reports/{id}-review.md
              │      │                      PASS? → продолжаем
              │      │                      NEEDS_CHANGES? → назад к Developer
              │      │
              │     5. QA (Sonnet) → docs/qa-reports/{id}-qa-report.md
              │      │                PASS? → Auto PR
              │      │                FAIL? → назад к Developer (max 3 итерации)
              └──────┘
                     │
              6. Auto PR → feature/{id} → main
                     │
              7. CI → lint + test + typecheck + build
                     │
              8. Human review (CODEOWNERS)
                     │
              9. Merge → Auto deploy → VPS
```

---

## Модели по стейджам

| Стейдж | Модель | Почему |
|--------|--------|--------|
| PO | Sonnet | Анализ, документация — Sonnet справляется отлично |
| Architect | **Opus** | Критичные архитектурные решения требуют лучшего reasoning |
| Developer | **Opus** | Качество генерируемого кода значительно выше на Opus |
| Reviewer | Sonnet | Чеклист-ориентированная проверка — Sonnet достаточно |
| QA | Sonnet | Тестирование и верификация — Sonnet достаточно |

Это оптимизирует баланс стоимости и качества: Opus там, где ошибки дороже всего (архитектура и код).

---

## Советы

- Начинай с PO, если задача новая и нет чётких требований.
- Используй Architect, если нужно принять техническое решение или изменить схему БД.
- Developer — основной исполнитель. Передавай ему готовые требования и архитектуру.
- Reviewer ловит scope creep и отклонения от PRD — самая частая проблема у AI-агентов.
- QA полезен после реализации, но можно запускать параллельно для написания тест-плана.
- Analyst подключается когда фича в продакшене или для обоснования приоритетов.
- `--no-pr` полезен когда хочешь вручную проверить результат перед созданием PR.
- `--max-iterations 1` — быстрый режим без повторных QA-проверок.

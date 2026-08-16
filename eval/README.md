# Agent Evals — Platform Delovoy

Регрессионные проверки артефактов агентов. Защищают от деградации качества при изменении промптов (`agents/*.md`).

## Что проверяется

Eval-фреймворк — это **структурные** проверки артефактов:

| Агент | Что чекаем |
|-------|-----------|
| PO (PRD) | Обязательные секции (Проблема, Решение, User Stories, AC, MoSCoW, Метрики, Вне скоупа). Каждая US имеет роль/действие/ценность. Каждый AC чек-бокс. |
| Architect (ADR) | Секции Статус, Контекст, Варианты (≥2), Решение, Последствия. Упоминание RBAC для новых endpoint'ов. |
| Reviewer (Review) | Явный вердикт PASS/NEEDS_CHANGES. Раздел Security. Таблица AC с статусами. |
| QA (QA-report) | Явный вердикт PASS/FAIL. Раздел про RBAC, rate limiting, edge cases. Привязка к AC. |

Эти проверки НЕ запускают модели — они парсят готовые артефакты. Дёшево, быстро, детерминированно. Полные end-to-end прогоны с моделью — отдельная задача (дорого, не для каждого PR).

### AC-трассируемость (issue #585)

Отдельный чекер, `eval/checks/traceability.ts` — не часть таблицы выше: он не проверяет
структуру одного артефакта, а сверяет **связь** «AC из PRD → тест». Конвенция: тест,
покрывающий конкретный AC, содержит маркер `// AC-N` в комментарии рядом или `AC-N` в
названии `it(...)`/`test(...)`.

Для PR, в описании которого есть ссылка на PRD (`docs/requirements/*-prd.md`),
`eval/traceability-report.ts` извлекает нумерованные AC из PRD, проверяет упоминание
каждого в изменённых тестовых файлах diff'а и пишет таблицу AC → тест в step summary
(job `ac-traceability` в `.github/workflows/ci.yml`). Пока это **режим отчёта**: не
блокирует мерж — решение сделать проверку блокирующей примут после 2-3 фич.

Один PRD может переиспользовать `AC-1`, `AC-2`, ... в каждой User Story (так уже
устроены реальные PRD в `docs/requirements/`) — идентификаторы не уникальны на уровне
файла. Чекер трассирует по строковому совпадению `AC-N`, не по паре (US, AC); при
повторе одного и того же `AC-N` в нескольких US отчёт добавляет информационную заметку,
не влияющую на pass/fail.

Известное ограничение: `eval/traceability-report.ts` берёт список изменённых тестовых
файлов через двухточечный `git diff --name-only origin/<base>` (сравнение деревьев, не
merge-base — тот же приём, что и в CHANGELOG-проверке `agents-eval.yml`, чтобы не тащить
полную историю при `fetch-depth: 1`). Если `main` уехал вперёд после форка ветки, в diff
могут попасть файлы, которых сам PR не касался. Пока проверка в режиме отчёта — это
не блокирует мерж; но при переводе в блокирующий режим сначала стоит пересмотреть на
merge-base (`git merge-base` + трёхточечный diff, либо `fetch-depth: 0`).

## Структура

```
eval/
├── README.md              # этот файл
├── fixtures/              # золотой набор артефактов прошлых фич
│   ├── 2026-04-01-gazebo-payment/
│   │   ├── prd.md
│   │   ├── adr.md
│   │   ├── review.md
│   │   └── qa-report.md
│   ├── sample-ac-traceability/   # фикстура для eval/checks/traceability.ts (issue #585)
│   │   ├── sample-prd.md
│   │   └── sample-booking-tests.ts
│   └── ...
├── checks/                # функции-чекеры
│   ├── prd.ts
│   ├── adr.ts
│   ├── review.ts
│   ├── qa-report.ts
│   └── traceability.ts    # AC из PRD → тест (issue #585)
├── runner.ts               # главный раннер (агенты po/architect/reviewer/qa)
├── traceability-report.ts  # CI-обвязка AC-трассируемости, отдельно от runner.ts
└── __tests__/              # vitest тесты на сами чекеры
    ├── checks.test.ts
    └── traceability.test.ts
```

## Запуск

```bash
# Весь eval
npm run agents:eval

# Только для одного агента
npm run agents:eval -- --agent po

# На конкретном fixture
npm run agents:eval -- --fixture 2026-04-01-gazebo-payment
```

## Добавление нового fixture

1. Возьми реальные артефакты хорошего pipeline run (status = success) из `docs/`.
2. Скопируй в `eval/fixtures/<RUN_ID>/{prd,adr,review,qa-report}.md`.
3. Прогони `npm run agents:eval -- --fixture <RUN_ID>` — должно быть зелёное.
4. Закоммить.

## CI

`.github/workflows/agents-eval.yml` запускает eval при изменении `agents/*.md` или `.claude/agents/*.md`. При регрессии — PR блокируется.

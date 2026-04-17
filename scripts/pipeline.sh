#!/usr/bin/env bash
#
# pipeline.sh — Autonomous agent pipeline for Platform Delovoy
#
# ⚠️  CLAUDE DEPENDENCY — этот скрипт вызывает `claude` CLI напрямую (строка ~489).
#    Он НЕ является частью GitHub Actions CI и запускается ТОЛЬКО локально разработчиком.
#
#    Зависимости от AI в этом файле:
#      - строка ~476:  claude -p --model sonnet/opus  (вызов Claude Code CLI)
#      - строка ~294:  читает .claude/feedback/qa-patterns.md (self-improving loop)
#      - строки ~593:  Co-Authored-By: Claude Code в git commit
#
#    Альтернатива без AI — GitHub Actions:
#      - CI-проверки:         .github/workflows/ci.yml      (lint / test / typecheck / build)
#      - Мониторинг CI:       .github/workflows/ci-watchdog.yml  (Telegram + Issue + PR comment)
#      - Деплой:              .github/workflows/deploy.yml
#      - PRD / ADR / Review:  делается разработчиком вручную по шаблонам в docs/
#
# Usage:
#   ./scripts/pipeline.sh "Описание задачи"
#   ./scripts/pipeline.sh --stages po,architect,developer,qa "Описание задачи"
#   ./scripts/pipeline.sh --from architect "Описание задачи"  # skip PO, start from architect
#   ./scripts/pipeline.sh --dry-run "Описание задачи"         # show what would run
#
# Stages: po → architect → developer → reviewer → qa
# Each stage produces artifacts that feed into the next.
# QA ↔ Developer feedback loop: if QA finds bugs, Developer fixes, QA re-checks (max 3 iterations).

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$ROOT_DIR/agents"
DOCS_DIR="$ROOT_DIR/docs"
TIMESTAMP=$(date +%Y-%m-%d)
MAX_BUDGET="${PIPELINE_BUDGET:-5.00}"
MAX_QA_ITERATIONS="${PIPELINE_MAX_QA_ITERATIONS:-3}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Defaults ────────────────────────────────────────────────────────
ALL_STAGES=("po" "architect" "developer" "reviewer" "qa")
STAGES=("${ALL_STAGES[@]}")
DRY_RUN=false
TASK=""
CUSTOM_RUN_ID=""
AUTO_PR=true
BASE_BRANCH=""
RESUME_RUN_ID=""
WITH_ANALYTICS=false

# ── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stages)
      IFS=',' read -ra STAGES <<< "$2"
      shift 2
      ;;
    --from)
      FROM_STAGE="$2"
      FOUND=false
      STAGES=()
      for s in "${ALL_STAGES[@]}"; do
        if [[ "$s" == "$FROM_STAGE" ]]; then FOUND=true; fi
        if $FOUND; then STAGES+=("$s"); fi
      done
      if ! $FOUND; then
        echo -e "${RED}Error: unknown stage '$FROM_STAGE'. Valid: ${ALL_STAGES[*]}${NC}"
        exit 1
      fi
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --budget)
      MAX_BUDGET="$2"
      shift 2
      ;;
    --run-id)
      CUSTOM_RUN_ID="$2"
      shift 2
      ;;
    --no-pr)
      AUTO_PR=false
      shift
      ;;
    --max-iterations)
      MAX_QA_ITERATIONS="$2"
      shift 2
      ;;
    --resume)
      RESUME_RUN_ID="$2"
      shift 2
      ;;
    --with-analytics)
      WITH_ANALYTICS=true
      shift
      ;;
    -h|--help)
      cat <<'HELPEOF'
Usage: ./scripts/pipeline.sh [options] "Описание задачи"

Stages: po → architect → developer → reviewer → qa

Options:
  --stages STAGES       Comma-separated stages (e.g. po,architect)
  --from STAGE          Start from stage (skip earlier ones)
  --dry-run             Show what would run without executing
  --budget USD          Max budget per stage (default: $5.00)
  --run-id ID           Custom run ID (default: auto-generated)
  --no-pr               Don't create PR at the end
  --max-iterations N    Max QA↔Developer iterations (default: 3)
  --resume RUN_ID       Resume a previously interrupted pipeline run.
                        Reads docs/pipeline-runs/RUN_ID.state.json and
                        skips already-completed stages.
  --with-analytics      Run post-release analytics stage after QA (reads
                        artefacts, proposes metrics to track).
  -h, --help            Show this help

Environment variables:
  PIPELINE_BUDGET            Max budget per stage in USD (default: 5.00)
  PIPELINE_MAX_QA_ITERATIONS Max QA feedback iterations (default: 3)

Models per stage (hardcoded for optimal cost/quality):
  PO:        sonnet  (analysis, documentation)
  Architect: opus    (critical design decisions)
  Developer: opus    (code generation)
  Reviewer:  sonnet  (code review, checklist)
  QA:        sonnet  (testing, verification)
HELPEOF
      exit 0
      ;;
    *)
      TASK="$1"
      shift
      ;;
  esac
done

# ── Resume from saved state ─────────────────────────────────────────
#
# --resume <RUN_ID> reads docs/pipeline-runs/<RUN_ID>.state.json, restores TASK
# and prunes STAGES to skip already-completed ones. Requires `jq` (standard
# on most systems) or falls back to bash grep.
if [[ -n "$RESUME_RUN_ID" ]]; then
  RESUME_STATE="$DOCS_DIR/pipeline-runs/${RESUME_RUN_ID}.state.json"
  if [[ ! -f "$RESUME_STATE" ]]; then
    echo -e "${RED}Error: state file not found: $RESUME_STATE${NC}"
    exit 1
  fi

  if command -v jq >/dev/null 2>&1; then
    RESUMED_TASK=$(jq -r '.task' "$RESUME_STATE")
    COMPLETED=$(jq -r '.completed_stages[]' "$RESUME_STATE" | tr '\n' ' ')
  else
    # Fallback: extract task and completed stages without jq
    RESUMED_TASK=$(sed -n 's/.*"task":[[:space:]]*"\([^"]*\)".*/\1/p' "$RESUME_STATE" | head -1)
    COMPLETED=$(sed -n '/"completed_stages"/,/\]/p' "$RESUME_STATE" \
      | grep -oE '"[a-z]+"' | tr -d '"' | tr '\n' ' ')
  fi

  if [[ -z "$TASK" ]]; then
    TASK="$RESUMED_TASK"
  fi
  CUSTOM_RUN_ID="$RESUME_RUN_ID"

  # Build new STAGES list without completed ones, but only from ALL_STAGES
  NEW_STAGES=()
  for s in "${STAGES[@]}"; do
    skip=false
    for c in $COMPLETED; do
      [[ "$s" == "$c" ]] && skip=true
    done
    if ! $skip; then
      NEW_STAGES+=("$s")
    fi
  done
  STAGES=("${NEW_STAGES[@]}")

  echo -e "${CYAN}Resuming run $RESUME_RUN_ID${NC}"
  echo -e "${CYAN}  Completed: ${COMPLETED:-none}${NC}"
  echo -e "${CYAN}  Remaining: ${STAGES[*]:-none}${NC}"

  if [[ ${#STAGES[@]} -eq 0 ]]; then
    echo -e "${YELLOW}Nothing to resume — all requested stages already completed.${NC}"
    exit 0
  fi
fi

if [[ -z "$TASK" ]]; then
  echo -e "${RED}Error: task description required${NC}"
  echo "Usage: ./scripts/pipeline.sh \"Описание задачи\""
  exit 1
fi

# Append analytics stage if requested
if $WITH_ANALYTICS; then
  # Only append if not already present
  HAS_ANALYTICS=false
  for s in "${STAGES[@]}"; do
    [[ "$s" == "analytics" ]] && HAS_ANALYTICS=true
  done
  if ! $HAS_ANALYTICS; then
    STAGES+=("analytics")
  fi
fi

# ── Ensure docs directories exist ───────────────────────────────────
mkdir -p "$DOCS_DIR/requirements" "$DOCS_DIR/architecture" "$DOCS_DIR/qa-reports" "$DOCS_DIR/context" "$DOCS_DIR/analytics"

# ── Slug from task (for filenames) ──────────────────────────────────
if [[ -n "$CUSTOM_RUN_ID" ]]; then
  RUN_ID="$CUSTOM_RUN_ID"
else
  TASK_SLUG=$(echo "$TASK" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-zа-яё0-9]/-/g' | sed 's/--*/-/g' | cut -c1-50)
  RUN_ID="${TIMESTAMP}-${TASK_SLUG}"
fi

# ── Log file ────────────────────────────────────────────────────────
LOG_DIR="$DOCS_DIR/pipeline-runs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${RUN_ID}.log"
METRICS_FILE="$LOG_DIR/${RUN_ID}.metrics.jsonl"
STATE_FILE="$LOG_DIR/${RUN_ID}.state.json"

log() {
  local msg="[$(date '+%H:%M:%S')] $1"
  echo -e "$msg" | tee -a "$LOG_FILE"
}

# ── JSON metrics (one JSONL event per stage) ────────────────────────
#
# Каждая стадия пишет одну строку JSON в $METRICS_FILE:
#   {"ts":"2026-04-16T14:23:01Z","run_id":"...","stage":"po",
#    "iteration":0,"model":"sonnet","status":"completed",
#    "duration_sec":87,"verdict":"PASS","exit_code":0}
#
# Используется для:
#   - /admin/monitoring/pipelines — дашборд метрик
#   - scripts/agents-eval.ts — регрессионные прогоны
#   - CI watchdog — алерты при падении pipeline
metric() {
  local stage="$1" iteration="$2" model="$3" status="$4" duration="$5" verdict="$6" exit_code="$7"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Экранируем task (могут быть кавычки)
  local task_esc="${TASK//\"/\\\"}"
  printf '{"ts":"%s","run_id":"%s","task":"%s","stage":"%s","iteration":%s,"model":"%s","status":"%s","duration_sec":%s,"verdict":"%s","exit_code":%s}\n' \
    "$ts" "$RUN_ID" "$task_esc" "$stage" "$iteration" "$model" "$status" "$duration" "$verdict" "$exit_code" \
    >> "$METRICS_FILE"
}

# ── State persistence (for --resume) ────────────────────────────────
#
# Сохраняем состояние после каждой успешной стадии чтобы можно было продолжить
# с места падения. Формат:
#   {"run_id":"...","task":"...","completed_stages":["po","architect"],
#    "last_stage":"architect","last_iteration":0,"started_at":"..."}
save_state() {
  local completed_stages="$1" last_stage="$2" last_iteration="$3"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local task_esc="${TASK//\"/\\\"}"
  cat > "$STATE_FILE" <<EOF
{
  "run_id": "$RUN_ID",
  "task": "$task_esc",
  "completed_stages": [$completed_stages],
  "last_stage": "$last_stage",
  "last_iteration": $last_iteration,
  "updated_at": "$ts"
}
EOF
}

# ── Model selection per stage ───────────────────────────────────────
get_stage_model() {
  local stage="$1"
  case "$stage" in
    po)        echo "sonnet" ;;     # Analysis, documentation — Sonnet is sufficient
    architect) echo "opus" ;;       # Critical design decisions — Opus quality matters
    developer) echo "opus" ;;       # Code generation — Opus writes better code
    reviewer)  echo "sonnet" ;;     # Checklist-based review — Sonnet is sufficient
    qa)        echo "sonnet" ;;     # Testing, verification — Sonnet is sufficient
    analytics) echo "sonnet" ;;     # Metrics / reports — Sonnet is sufficient
    *)         echo "sonnet" ;;
  esac
}

# ── Stage definitions ───────────────────────────────────────────────

get_agent_prompt() {
  local stage="$1"
  cat "$AGENTS_DIR/${stage}.md"
}

get_allowed_tools() {
  local stage="$1"
  case "$stage" in
    po)        echo "Read,Write,Glob,Grep,Agent" ;;
    architect) echo "Read,Write,Glob,Grep,Agent" ;;
    developer) echo "default" ;;
    reviewer)  echo "Read,Write,Glob,Grep,Bash,Agent" ;;
    qa)        echo "Read,Write,Glob,Grep,Bash,Agent" ;;
    analytics) echo "Read,Write,Glob,Grep,Bash,Agent" ;;
  esac
}

get_permission_mode() {
  local stage="$1"
  case "$stage" in
    po)        echo "acceptEdits" ;;
    architect) echo "acceptEdits" ;;
    developer) echo "acceptEdits" ;;
    reviewer)  echo "acceptEdits" ;;
    qa)        echo "acceptEdits" ;;
    analytics) echo "acceptEdits" ;;
  esac
}

get_stage_label() {
  local stage="$1"
  case "$stage" in
    po)        echo "📋 PO" ;;
    architect) echo "🏗️  ARCH" ;;
    developer) echo "💻 DEV" ;;
    reviewer)  echo "🔍 REVIEW" ;;
    qa)        echo "🧪 QA" ;;
    analytics) echo "📈 ANALYTICS" ;;
  esac
}

# ── Context artifact management ─────────────────────────────────────
CONTEXT_FILE="$DOCS_DIR/context/${RUN_ID}-context.md"

init_context() {
  cat > "$CONTEXT_FILE" <<EOF
# Context Log: ${TASK}

> Этот файл — shared memory между стейджами pipeline.
> Каждый стейдж добавляет свои ключевые решения и трейдоффы.
> Следующий стейдж читает этот файл для полного контекста.

**Run ID:** ${RUN_ID}
**Задача:** ${TASK}
**Дата:** ${TIMESTAMP}

---

EOF
}

# ── Build prompt for each stage ─────────────────────────────────────
build_prompt() {
  local stage="$1"
  local iteration="${2:-0}"
  local prompt=""

  # Read context file if it exists
  local context_content=""
  if [[ -f "$CONTEXT_FILE" ]]; then
    context_content="$(cat "$CONTEXT_FILE")"
  fi

  case "$stage" in
    po)
      prompt="## Задача

${TASK}

## Инструкции

1. Изучи текущее состояние проекта: прочитай CLAUDE.md, посмотри существующий код в src/
2. Напиши PRD с user stories и acceptance criteria для этой задачи
3. Сохрани PRD в файл: docs/requirements/${RUN_ID}-prd.md
4. Используй формат из своего шаблона (Проблема, Решение, User Stories, AC, MoSCoW, Метрики, Вне скоупа)
5. Будь конкретным — acceptance criteria должны быть проверяемыми

## Контекстный лог

После завершения работы, допиши в файл \`docs/context/${RUN_ID}-context.md\` секцию:

\`\`\`
## PO — Ключевые решения
- [Какие решения были приняты при составлении PRD]
- [Какие трейдоффы были сделаны]
- [Что осталось неоднозначным]
\`\`\`"
      ;;

    architect)
      prompt="## Задача

${TASK}

## Контекст — PRD от Product Owner

$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'PRD не найден — проектируй на основе задачи')

## Контекст — Решения предыдущих стейджей

${context_content}

## Инструкции

1. Прочитай PRD выше и текущий код проекта
2. Спроектируй техническое решение: какие файлы создать/изменить, структура компонентов, API если нужно
3. Сохрани ADR в файл: docs/architecture/${RUN_ID}-adr.md
4. Опиши конкретные файлы, компоненты, структуру данных
5. НЕ пиши код — только архитектурное решение

## Контекстный лог

После завершения работы, допиши в файл \`docs/context/${RUN_ID}-context.md\` секцию:

\`\`\`
## Architect — Ключевые решения
- [Какие архитектурные решения приняты и почему]
- [Какие альтернативы отвергнуты и почему]
- [Технические риски и ограничения]
\`\`\`"
      ;;

    developer)
      local prd_content adr_content qa_patterns
      prd_content="$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'Нет PRD')"
      adr_content="$(cat "$DOCS_DIR/architecture/${RUN_ID}-adr.md" 2>/dev/null || echo 'Нет ADR')"
      qa_patterns="$(cat "$ROOT_DIR/.claude/feedback/qa-patterns.md" 2>/dev/null || echo '')"

      prompt="## Задача

${TASK}

## PRD (от Product Owner)

${prd_content}

## ADR (от Architect)

${adr_content}

## Контекст — Решения предыдущих стейджей

${context_content}"

      # Include QA patterns from previous runs (self-improving)
      if [[ -n "$qa_patterns" ]]; then
        prompt+="

## ⚠️ Известные паттерны ошибок (из предыдущих QA-прогонов)

Изучи этот список частых ошибок и НЕ повторяй их:

${qa_patterns}"
      fi

      # If this is a fix iteration after QA, include QA report and review
      if [[ "$iteration" -gt 0 ]]; then
        local qa_report=""
        qa_report="$(cat "$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md" 2>/dev/null || echo 'Нет QA-отчёта')"
        prompt+="

## ⚠️ QA нашёл проблемы (итерация ${iteration})

Прочитай QA-отчёт ниже и исправь все найденные баги:

${qa_report}

## Инструкции (итерация исправления)

1. Прочитай QA-отчёт выше — каждый баг/проблема должна быть исправлена
2. Исправь все найденные проблемы
3. Запусти npm test и убедись что всё зелёное
4. Сделай коммит: \`fix: address QA feedback (iteration ${iteration})\`"
      else
        prompt+="

## Инструкции

1. Реализуй фичу согласно PRD и ADR
2. Следуй всем правилам из CLAUDE.md (структура модулей, API-стандарты, тесты)
3. Пиши тесты вместе с кодом
4. Запусти npm test и убедись что всё зелёное
5. Делай коммиты по ходу работы (conventional commits)"
      fi
      ;;

    reviewer)
      local prd_content adr_content
      prd_content="$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'Нет PRD')"
      adr_content="$(cat "$DOCS_DIR/architecture/${RUN_ID}-adr.md" 2>/dev/null || echo 'Нет ADR')"

      prompt="## Задача — Code Review

${TASK}

## PRD с acceptance criteria

${prd_content}

## ADR с архитектурным решением

${adr_content}

## Контекст — Решения предыдущих стейджей

${context_content}

## Инструкции

1. Прочитай PRD (acceptance criteria) и ADR (архитектура)
2. Посмотри git diff: выполни \`git diff main...HEAD\` чтобы увидеть все изменения
3. Проверь каждый AC — реализован ли он в коде?
4. Проверь scope creep — нет ли лишнего кода, не описанного в PRD?
5. Проверь качество: TypeScript strict, нет any, Zod, apiResponse/apiError
6. Проверь безопасность: RBAC, утечки данных, инъекции
7. Запусти \`npm test\` — тесты должны проходить
8. Сохрани вердикт в: docs/qa-reports/${RUN_ID}-review.md
9. Вердикт: PASS или NEEDS_CHANGES с конкретными указаниями"
      ;;

    qa)
      local prd_content
      prd_content="$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'Нет PRD')"

      prompt="## Задача — проверка реализации

${TASK}

## PRD с acceptance criteria

${prd_content}

## Контекст — Решения предыдущих стейджей

${context_content}"

      # Include review verdict if available
      if [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-review.md" ]]; then
        prompt+="

## Code Review вердикт

$(cat "$DOCS_DIR/qa-reports/${RUN_ID}-review.md")"
      fi

      prompt+="

## Инструкции

1. Прочитай PRD и acceptance criteria
2. Проверь что код реализует все AC — просмотри файлы, которые были изменены
3. Запусти npm test и проверь что тесты проходят
4. Проверь качество кода: TypeScript strict, нет any, Zod валидация, apiResponse/apiError
5. Сохрани отчёт в: docs/qa-reports/${RUN_ID}-qa-report.md
6. Если нашёл баги — опиши их в отчёте с шагами воспроизведения
7. В конце отчёта обязательно укажи итоговый вердикт: **PASS** или **FAIL**"
      ;;

    analytics)
      local prd_content
      prd_content="$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'Нет PRD')"

      prompt="## Задача — post-release аналитика

${TASK}

## PRD (включая метрики успеха)

${prd_content}

## Контекст — Решения предыдущих стейджей

${context_content}

## Инструкции

1. Прочитай раздел 'Метрики успеха' в PRD — baseline и target
2. Исследуй структуру БД (prisma/schema.prisma) — какие таблицы релевантны
3. Напиши аналитический отчёт: как именно будем измерять эффект этой фичи
4. Предложи SQL-запросы (read-only, без PII) для подсчёта метрик
5. Предложи Telegram-дайджест: что отправлять суперадмину еженедельно
6. Сохрани отчёт в: docs/analytics/${RUN_ID}-post-release-analytics.md
7. Формат — по шаблону из agents/analytics.md (Цель, Источники, Методология, SQL, Рекомендации)

НЕ меняй код. НЕ запускай реальные запросы к продакшен БД."
      ;;
  esac

  echo "$prompt"
}

# ── Run a single stage ──────────────────────────────────────────────

run_stage() {
  local stage="$1"
  local iteration="${2:-0}"
  local label
  label="$(get_stage_label "$stage")"
  local model
  model="$(get_stage_model "$stage")"
  local tools
  tools="$(get_allowed_tools "$stage")"
  local perm_mode
  perm_mode="$(get_permission_mode "$stage")"
  local system_prompt
  system_prompt="$(get_agent_prompt "$stage")"
  local user_prompt
  user_prompt="$(build_prompt "$stage" "$iteration")"

  log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  if [[ "$iteration" -gt 0 ]]; then
    log "${BLUE}${label} Stage: $stage (fix iteration $iteration)${NC}"
  else
    log "${BLUE}${label} Stage: $stage${NC}"
  fi
  log "${BLUE}   Model: $model | Budget: \$$MAX_BUDGET${NC}"
  log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if $DRY_RUN; then
    log "${YELLOW}[DRY RUN] Would run claude with:${NC}"
    log "  Model: $model"
    log "  Tools: $tools"
    log "  System prompt: ${#system_prompt} chars from agents/${stage}.md"
    log "  User prompt: ${#user_prompt} chars"
    log ""
    return 0
  fi

  local stage_log="$LOG_DIR/${RUN_ID}-${stage}.log"
  if [[ "$iteration" -gt 0 ]]; then
    stage_log="$LOG_DIR/${RUN_ID}-${stage}-fix-${iteration}.log"
  fi
  local exit_code=0
  local started_at
  started_at="$(date +%s)"

  # Build claude command
  local cmd=(
    claude
    -p
    --model "$model"
    --permission-mode "$perm_mode"
    --append-system-prompt "$system_prompt"
    --max-budget-usd "$MAX_BUDGET"
  )

  # Add tool restrictions (skip for developer who gets all tools)
  if [[ "$tools" != "default" ]]; then
    cmd+=(--allowedTools "$tools")
  fi

  # Run claude with the prompt piped in
  echo "$user_prompt" | "${cmd[@]}" 2>&1 | tee "$stage_log" || exit_code=$?

  local duration=$(( $(date +%s) - started_at ))

  # Read verdict from artifact if it's a judge stage
  local verdict="n/a"
  case "$stage" in
    reviewer)
      if [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-review.md" ]]; then
        if verdict_status "$DOCS_DIR/qa-reports/${RUN_ID}-review.md"; then
          verdict="PASS"
        else
          verdict="NEEDS_CHANGES"
        fi
      fi
      ;;
    qa)
      if [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md" ]]; then
        if verdict_status "$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md"; then
          verdict="PASS"
        else
          verdict="FAIL"
        fi
      fi
      ;;
  esac

  if [[ $exit_code -ne 0 ]]; then
    log "${RED}${label} Stage $stage FAILED (exit code: $exit_code)${NC}"
    log "${RED}See log: $stage_log${NC}"
    metric "$stage" "$iteration" "$model" "failed" "$duration" "$verdict" "$exit_code"
    return $exit_code
  fi

  metric "$stage" "$iteration" "$model" "completed" "$duration" "$verdict" 0
  log "${GREEN}${label} Stage $stage completed in ${duration}s (verdict: $verdict)${NC}"
  log ""
}

# ── Verdict parsing ─────────────────────────────────────────────────
#
# Каждый judge-агент (Reviewer, QA) выдаёт вердикт PASS или NEEDS_CHANGES/FAIL.
# Мы ищем одну из строк в отчёте — case-insensitive, захватывает typical phrasing:
#   "Вердикт: PASS" / "## Вердикт: PASS" / "Итог: PASS" / "# Verdict: PASS"
# Если нашли хотя бы один FAIL/NEEDS_CHANGES — считаем что не прошло.
#
# Возврат: 0 = PASS, 1 = FAIL/NEEDS_CHANGES, 2 = отчёт отсутствует
verdict_status() {
  local report="$1"
  [[ -f "$report" ]] || return 2

  if grep -qiE "(fail|needs[_ ]changes|требует.*правк|необходим.*исправ)" "$report"; then
    return 1
  fi
  if grep -qiE "(вердикт|итог|результат|verdict|outcome)\s*[:*]*\s*\**\s*pass" "$report" \
     || grep -qiE "^##?\s*.*pass\b" "$report"; then
    return 0
  fi
  # Нет явного PASS-маркера — считаем что не прошло, чтобы не пропустить ошибку
  return 1
}

# ── Reviewer ↔ Developer feedback loop ──────────────────────────────
#
# Reviewer — LLM-as-Judge, проверяет соответствие PRD/ADR. Запускается ПОСЛЕ Developer
# и ДО QA. Если NEEDS_CHANGES — Developer исправляет, Reviewer прогоняется повторно.
run_review_loop() {
  local review_report="$DOCS_DIR/qa-reports/${RUN_ID}-review.md"
  local iteration=0
  local vs=0

  run_stage "reviewer" 0

  # In dry-run mode reports don't exist yet — skip the loop
  if $DRY_RUN; then
    return 0
  fi

  while [[ $iteration -lt $MAX_QA_ITERATIONS ]]; do
    verdict_status "$review_report"
    vs=$?
    if [[ $vs -eq 0 ]]; then
      log "${GREEN}✅ Reviewer PASS — code matches PRD/ADR${NC}"
      return 0
    fi
    if [[ $vs -eq 2 ]]; then
      log "${YELLOW}⚠️  Review report not found, skipping review loop${NC}"
      return 0
    fi

    iteration=$((iteration + 1))

    if [[ $iteration -ge $MAX_QA_ITERATIONS ]]; then
      log "${RED}⚠️  Max Reviewer iterations ($MAX_QA_ITERATIONS) reached. Manual review needed.${NC}"
      return 1
    fi

    log "${YELLOW}🔄 Reviewer NEEDS_CHANGES — fix iteration $iteration/$MAX_QA_ITERATIONS${NC}"

    # Developer fixes based on Reviewer verdict
    run_stage "developer" "$iteration"

    # Re-run Reviewer
    run_stage "reviewer" "$iteration"
  done
}

# ── QA ↔ Developer feedback loop ────────────────────────────────────
#
# QA проверяет acceptance criteria. Запускается ПОСЛЕ успешного Review.
# Если FAIL — Developer исправляет, QA прогоняется повторно.
run_qa_loop() {
  local qa_report="$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md"
  local iteration=0
  local vs=0

  run_stage "qa" 0

  # In dry-run mode reports don't exist yet — skip the loop
  if $DRY_RUN; then
    return 0
  fi

  while [[ $iteration -lt $MAX_QA_ITERATIONS ]]; do
    verdict_status "$qa_report"
    vs=$?
    if [[ $vs -eq 0 ]]; then
      log "${GREEN}✅ QA PASSED — all acceptance criteria met${NC}"
      if [[ -f "$ROOT_DIR/scripts/collect-qa-feedback.sh" ]]; then
        log "${BLUE}📊 Collecting QA feedback patterns...${NC}"
        bash "$ROOT_DIR/scripts/collect-qa-feedback.sh" "$qa_report" 2>/dev/null || true
      fi
      return 0
    fi
    if [[ $vs -eq 2 ]]; then
      log "${YELLOW}⚠️  QA report not found, assuming pass${NC}"
      return 0
    fi

    iteration=$((iteration + 1))

    if [[ $iteration -ge $MAX_QA_ITERATIONS ]]; then
      log "${RED}⚠️  Max QA iterations ($MAX_QA_ITERATIONS) reached. Manual review needed.${NC}"
      if [[ -f "$ROOT_DIR/scripts/collect-qa-feedback.sh" ]]; then
        log "${BLUE}📊 Collecting QA feedback patterns from failed run...${NC}"
        bash "$ROOT_DIR/scripts/collect-qa-feedback.sh" "$qa_report" 2>/dev/null || true
      fi
      return 1
    fi

    log "${YELLOW}🔄 QA found issues — fix iteration $iteration/$MAX_QA_ITERATIONS${NC}"

    # Developer fixes based on QA report
    run_stage "developer" "$iteration"

    # Re-run QA
    run_stage "qa" 0
  done
}

# ── Combined dev+review+qa orchestration ─────────────────────────────
run_dev_qa_loop() {
  # 1. First development pass
  run_stage "developer" 0

  # 2. Reviewer loop (may bounce back to Developer)
  if ! run_review_loop; then
    return 1
  fi

  # 3. QA loop (may bounce back to Developer)
  if ! run_qa_loop; then
    return 1
  fi

  return 0
}

# ── Auto PR creation ────────────────────────────────────────────────
create_pr() {
  log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  log "${BLUE}📤 Creating branch and PR${NC}"
  log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  local branch="feature/${RUN_ID}"

  # Check if there are changes to commit
  if [[ -z "$(git status --porcelain)" ]]; then
    log "${YELLOW}No uncommitted changes to push${NC}"

    # Check if we have unpushed commits
    local unpushed
    unpushed=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$unpushed" -eq 0 ]]; then
      log "${YELLOW}No changes to create PR for${NC}"
      return 0
    fi
  fi

  # Save current branch
  local current_branch
  current_branch=$(git branch --show-current)

  # Create feature branch if not already on one
  if [[ "$current_branch" == "main" ]]; then
    git checkout -b "$branch"
  else
    branch="$current_branch"
  fi

  # Stage and commit any uncommitted changes
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "feat: ${TASK}

Pipeline run: ${RUN_ID}
Stages: ${STAGES[*]}

Co-Authored-By: Claude Code <noreply@anthropic.com>"
  fi

  # Push
  git push -u origin "$branch"

  # Build PR body with artifact links
  local body="## Summary

**Task:** ${TASK}
**Pipeline Run:** \`${RUN_ID}\`
**Stages:** ${STAGES[*]}

## Artifacts
"
  [[ -f "$DOCS_DIR/requirements/${RUN_ID}-prd.md" ]] && body+="- 📋 [PRD](docs/requirements/${RUN_ID}-prd.md)
"
  [[ -f "$DOCS_DIR/architecture/${RUN_ID}-adr.md" ]] && body+="- 🏗️ [ADR](docs/architecture/${RUN_ID}-adr.md)
"
  [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-review.md" ]] && body+="- 🔍 [Code Review](docs/qa-reports/${RUN_ID}-review.md)
"
  [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md" ]] && body+="- 🧪 [QA Report](docs/qa-reports/${RUN_ID}-qa-report.md)
"
  [[ -f "$CONTEXT_FILE" ]] && body+="- 📝 [Context Log](docs/context/${RUN_ID}-context.md)
"
  body+="- 📊 [Pipeline Log](docs/pipeline-runs/${RUN_ID}.log)

## Pipeline Flow

\`\`\`
$(printf '%s' "${STAGES[*]}" | sed 's/ / → /g')
\`\`\`

## QA Checklist

- [ ] \`npm test\` passes
- [ ] TypeScript no errors
- [ ] Lint passes
- [ ] All acceptance criteria verified
- [ ] No scope creep

🤖 Generated with [Claude Code Agent Pipeline](https://claude.ai/claude-code)"

  # Create PR
  local pr_url
  pr_url=$(gh pr create \
    --title "feat: ${TASK}" \
    --body "$body" \
    --base main 2>&1)

  if [[ $? -eq 0 ]]; then
    log "${GREEN}✅ PR created: ${pr_url}${NC}"
  else
    log "${YELLOW}⚠️  PR creation failed: ${pr_url}${NC}"
    log "${YELLOW}Branch pushed to: ${branch} — create PR manually${NC}"
  fi
}

# ── Main ────────────────────────────────────────────────────────────

echo -e "${CYAN}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║          Platform Delovoy — Agent Pipeline v2               ║
║                                                              ║
║   PO → Architect → Developer → Reviewer → QA                ║
║                     ↑                      │                 ║
║                     └──── feedback loop ───┘                 ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

log "Task: $TASK"
log "Stages: ${STAGES[*]}"
log "Models: $(for s in "${STAGES[@]}"; do echo -n "$s=$(get_stage_model "$s") "; done)"
log "Budget per stage: \$$MAX_BUDGET"
log "Max QA iterations: $MAX_QA_ITERATIONS"
log "Run ID: $RUN_ID"
log "Auto PR: $AUTO_PR"
log "Log: $LOG_FILE"
echo ""

# Save base branch for PR
BASE_BRANCH=$(git branch --show-current)

# Initialize context artifact
init_context

# Track completed stages for state persistence and --resume
COMPLETED_STAGES=()

# Helper: build JSON array from COMPLETED_STAGES
completed_stages_json() {
  local out=""
  for s in "${COMPLETED_STAGES[@]}"; do
    out+="\"$s\","
  done
  echo "${out%,}"
}

# Run stages
FAILED=false
for stage in "${STAGES[@]}"; do
  # Handle developer+reviewer+qa as a feedback loop
  if [[ "$stage" == "developer" ]]; then
    # Check if reviewer and qa are also in stages
    HAS_REVIEWER=false
    HAS_QA=false
    for s in "${STAGES[@]}"; do
      [[ "$s" == "reviewer" ]] && HAS_REVIEWER=true
      [[ "$s" == "qa" ]] && HAS_QA=true
    done

    if $HAS_QA; then
      # Run dev+reviewer+qa as feedback loop
      if ! run_dev_qa_loop; then
        FAILED=true
        save_state "$(completed_stages_json)" "$stage" 0
        log "${RED}Pipeline stopped: feedback loop did not converge${NC}"
        break
      fi
      COMPLETED_STAGES+=("developer" "reviewer" "qa")
      save_state "$(completed_stages_json)" "qa" 0
      # Skip reviewer and qa in main loop (already handled)
      continue
    else
      # Just run developer stage
      if ! run_stage "$stage"; then
        FAILED=true
        save_state "$(completed_stages_json)" "$stage" 0
        log "${RED}Pipeline stopped at stage: $stage${NC}"
        break
      fi
      COMPLETED_STAGES+=("$stage")
      save_state "$(completed_stages_json)" "$stage" 0
    fi
  elif [[ "$stage" == "reviewer" || "$stage" == "qa" ]]; then
    # Skip if already handled in feedback loop
    HAS_DEV=false
    for s in "${STAGES[@]}"; do
      [[ "$s" == "developer" ]] && HAS_DEV=true
    done
    if $HAS_DEV && [[ "$stage" == "qa" ]]; then
      continue
    fi
    if $HAS_DEV && [[ "$stage" == "reviewer" ]]; then
      continue
    fi
    # Run standalone
    if ! run_stage "$stage"; then
      FAILED=true
      save_state "$(completed_stages_json)" "$stage" 0
      log "${RED}Pipeline stopped at stage: $stage${NC}"
      break
    fi
    COMPLETED_STAGES+=("$stage")
    save_state "$(completed_stages_json)" "$stage" 0
  else
    if ! run_stage "$stage"; then
      FAILED=true
      save_state "$(completed_stages_json)" "$stage" 0
      log "${RED}Pipeline stopped at stage: $stage${NC}"
      break
    fi
    COMPLETED_STAGES+=("$stage")
    save_state "$(completed_stages_json)" "$stage" 0
  fi
done

# ── Summary ─────────────────────────────────────────────────────────
echo ""
log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if $FAILED; then
  log "${RED}❌ Pipeline FAILED${NC}"
  log "Check logs in: $LOG_DIR/"
  exit 1
else
  log "${GREEN}✅ Pipeline completed successfully${NC}"
  log ""
  log "Artifacts:"
  [[ -f "$DOCS_DIR/requirements/${RUN_ID}-prd.md" ]] && log "  📋 PRD:        docs/requirements/${RUN_ID}-prd.md"
  [[ -f "$DOCS_DIR/architecture/${RUN_ID}-adr.md" ]] && log "  🏗️  ADR:        docs/architecture/${RUN_ID}-adr.md"
  [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-review.md" ]] && log "  🔍 Review:     docs/qa-reports/${RUN_ID}-review.md"
  [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md" ]] && log "  🧪 QA Report:  docs/qa-reports/${RUN_ID}-qa-report.md"
  [[ -f "$CONTEXT_FILE" ]] && log "  📝 Context:    docs/context/${RUN_ID}-context.md"
  log "  📊 Full log:   $LOG_FILE"

  # Auto-create PR if enabled
  if $AUTO_PR && ! $DRY_RUN; then
    echo ""
    create_pr
  fi
fi

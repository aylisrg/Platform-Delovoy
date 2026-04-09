#!/usr/bin/env bash
#
# pipeline.sh — Autonomous agent pipeline for Platform Delovoy
#
# Usage:
#   ./scripts/pipeline.sh "Описание задачи"
#   ./scripts/pipeline.sh --stages po,architect,developer,qa "Описание задачи"
#   ./scripts/pipeline.sh --from architect "Описание задачи"  # skip PO, start from architect
#   ./scripts/pipeline.sh --dry-run "Описание задачи"         # show what would run
#
# Stages: po → architect → developer → qa
# Each stage produces artifacts that feed into the next.

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$ROOT_DIR/agents"
DOCS_DIR="$ROOT_DIR/docs"
TIMESTAMP=$(date +%Y-%m-%d)
MODEL="${PIPELINE_MODEL:-sonnet}"
MAX_BUDGET="${PIPELINE_BUDGET:-5.00}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Defaults ────────────────────────────────────────────────────────
ALL_STAGES=("po" "architect" "developer" "qa")
STAGES=("${ALL_STAGES[@]}")
DRY_RUN=false
TASK=""
CUSTOM_RUN_ID=""

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
    --model)
      MODEL="$2"
      shift 2
      ;;
    --budget)
      MAX_BUDGET="$2"
      shift 2
      ;;
    --run-id)
      CUSTOM_RUN_ID="$2"
      shift 2
      ;;
    -h|--help)
      head -12 "$0" | tail -10
      echo ""
      echo "Environment variables:"
      echo "  PIPELINE_MODEL   Model to use (default: sonnet)"
      echo "  PIPELINE_BUDGET  Max budget per stage in USD (default: 5.00)"
      exit 0
      ;;
    *)
      TASK="$1"
      shift
      ;;
  esac
done

if [[ -z "$TASK" ]]; then
  echo -e "${RED}Error: task description required${NC}"
  echo "Usage: ./scripts/pipeline.sh \"Описание задачи\""
  exit 1
fi

# ── Ensure docs directories exist ───────────────────────────────────
mkdir -p "$DOCS_DIR/requirements" "$DOCS_DIR/architecture" "$DOCS_DIR/qa-reports"

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

log() {
  local msg="[$(date '+%H:%M:%S')] $1"
  echo -e "$msg" | tee -a "$LOG_FILE"
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
    qa)        echo "Read,Write,Glob,Grep,Bash,Agent" ;;
  esac
}

get_permission_mode() {
  local stage="$1"
  case "$stage" in
    po)        echo "acceptEdits" ;;   # read code + write docs
    architect) echo "acceptEdits" ;;   # read code + write ADR
    developer) echo "acceptEdits" ;;   # full edits + bash
    qa)        echo "acceptEdits" ;;   # run tests + write report
  esac
}

get_stage_emoji() {
  local stage="$1"
  case "$stage" in
    po)        echo "PO" ;;
    architect) echo "ARCH" ;;
    developer) echo "DEV" ;;
    qa)        echo "QA" ;;
  esac
}

# Build the user prompt for each stage, injecting previous artifacts
build_prompt() {
  local stage="$1"
  local prompt=""

  case "$stage" in
    po)
      prompt="## Задача

${TASK}

## Инструкции

1. Изучи текущее состояние проекта: прочитай CLAUDE.md, посмотри существующий код лендинга в src/app/
2. Напиши PRD с user stories и acceptance criteria для этой задачи
3. Сохрани PRD в файл: docs/requirements/${RUN_ID}-prd.md
4. Используй формат из своего шаблона (Проблема, Решение, User Stories, AC, MoSCoW, Метрики, Вне скоупа)
5. Будь конкретным — acceptance criteria должны быть проверяемыми"
      ;;

    architect)
      prompt="## Задача

${TASK}

## Контекст — PRD от Product Owner

$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'PRD не найден — проектируй на основе задачи')

## Инструкции

1. Прочитай PRD выше и текущий код проекта
2. Спроектируй техническое решение: какие файлы создать/изменить, структура компонентов, API если нужно
3. Сохрани ADR в файл: docs/architecture/${RUN_ID}-adr.md
4. Опиши конкретные файлы, компоненты, структуру данных
5. НЕ пиши код — только архитектурное решение"
      ;;

    developer)
      local prd_content adr_content
      prd_content="$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'Нет PRD')"
      adr_content="$(cat "$DOCS_DIR/architecture/${RUN_ID}-adr.md" 2>/dev/null || echo 'Нет ADR')"

      prompt="## Задача

${TASK}

## PRD (от Product Owner)

${prd_content}

## ADR (от Architect)

${adr_content}

## Инструкции

1. Реализуй фичу согласно PRD и ADR
2. Следуй всем правилам из CLAUDE.md (структура модулей, API-стандарты, тесты)
3. Пиши тесты вместе с кодом
4. Запусти npm test и убедись что всё зелёное
5. Делай коммиты по ходу работы (conventional commits)"
      ;;

    qa)
      local prd_content
      prd_content="$(cat "$DOCS_DIR/requirements/${RUN_ID}-prd.md" 2>/dev/null || echo 'Нет PRD')"

      prompt="## Задача — проверка реализации

${TASK}

## PRD с acceptance criteria

${prd_content}

## Инструкции

1. Прочитай PRD и acceptance criteria
2. Проверь что код реализует все AC — просмотри файлы, которые были изменены
3. Запусти npm test и проверь что тесты проходят
4. Проверь качество кода: TypeScript strict, нет any, Zod валидация, apiResponse/apiError
5. Сохрани отчёт в: docs/qa-reports/${RUN_ID}-qa-report.md
6. Если нашёл баги — опиши их в отчёте с шагами воспроизведения"
      ;;
  esac

  echo "$prompt"
}

# ── Run a single stage ──────────────────────────────────────────────

run_stage() {
  local stage="$1"
  local label
  label="$(get_stage_emoji "$stage")"
  local tools
  tools="$(get_allowed_tools "$stage")"
  local perm_mode
  perm_mode="$(get_permission_mode "$stage")"
  local system_prompt
  system_prompt="$(get_agent_prompt "$stage")"
  local user_prompt
  user_prompt="$(build_prompt "$stage")"

  log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  log "${BLUE}[$label] Starting stage: $stage${NC}"
  log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if $DRY_RUN; then
    log "${YELLOW}[DRY RUN] Would run claude with:${NC}"
    log "  Model: $MODEL"
    log "  Tools: $tools"
    log "  System prompt: ${#system_prompt} chars from agents/${stage}.md"
    log "  User prompt: ${#user_prompt} chars"
    log ""
    return 0
  fi

  local stage_log="$LOG_DIR/${RUN_ID}-${stage}.log"
  local exit_code=0

  # Build claude command
  local cmd=(
    claude
    -p
    --model "$MODEL"
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

  if [[ $exit_code -ne 0 ]]; then
    log "${RED}[$label] Stage $stage FAILED (exit code: $exit_code)${NC}"
    log "${RED}See log: $stage_log${NC}"
    return $exit_code
  fi

  log "${GREEN}[$label] Stage $stage completed${NC}"
  log ""
}

# ── Main ────────────────────────────────────────────────────────────

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║        Platform Delovoy — Agent Pipeline             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

log "Task: $TASK"
log "Stages: ${STAGES[*]}"
log "Model: $MODEL"
log "Budget per stage: \$$MAX_BUDGET"
log "Run ID: $RUN_ID"
log "Log: $LOG_FILE"
echo ""

# Run stages sequentially
FAILED=false
for stage in "${STAGES[@]}"; do
  if ! run_stage "$stage"; then
    FAILED=true
    log "${RED}Pipeline stopped at stage: $stage${NC}"
    break
  fi
done

# ── Summary ─────────────────────────────────────────────────────────
echo ""
log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if $FAILED; then
  log "${RED}Pipeline FAILED${NC}"
  log "Check logs in: $LOG_DIR/"
  exit 1
else
  log "${GREEN}Pipeline completed successfully${NC}"
  log ""
  log "Artifacts:"
  [[ -f "$DOCS_DIR/requirements/${RUN_ID}-prd.md" ]] && log "  PRD:       docs/requirements/${RUN_ID}-prd.md"
  [[ -f "$DOCS_DIR/architecture/${RUN_ID}-adr.md" ]] && log "  ADR:       docs/architecture/${RUN_ID}-adr.md"
  [[ -f "$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md" ]] && log "  QA Report: docs/qa-reports/${RUN_ID}-qa-report.md"
  log "  Full log:  $LOG_FILE"
fi

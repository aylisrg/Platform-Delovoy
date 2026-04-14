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

if [[ -z "$TASK" ]]; then
  echo -e "${RED}Error: task description required${NC}"
  echo "Usage: ./scripts/pipeline.sh \"Описание задачи\""
  exit 1
fi

# ── Ensure docs directories exist ───────────────────────────────────
mkdir -p "$DOCS_DIR/requirements" "$DOCS_DIR/architecture" "$DOCS_DIR/qa-reports" "$DOCS_DIR/context"

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

# ── Model selection per stage ───────────────────────────────────────
get_stage_model() {
  local stage="$1"
  case "$stage" in
    po)        echo "sonnet" ;;     # Analysis, documentation — Sonnet is sufficient
    architect) echo "opus" ;;       # Critical design decisions — Opus quality matters
    developer) echo "opus" ;;       # Code generation — Opus writes better code
    reviewer)  echo "sonnet" ;;     # Checklist-based review — Sonnet is sufficient
    qa)        echo "sonnet" ;;     # Testing, verification — Sonnet is sufficient
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

  if [[ $exit_code -ne 0 ]]; then
    log "${RED}${label} Stage $stage FAILED (exit code: $exit_code)${NC}"
    log "${RED}See log: $stage_log${NC}"
    return $exit_code
  fi

  log "${GREEN}${label} Stage $stage completed${NC}"
  log ""
}

# ── QA ↔ Developer feedback loop ────────────────────────────────────
run_dev_qa_loop() {
  # First run: Developer + Reviewer + QA
  run_stage "developer" 0
  run_stage "reviewer" 0
  run_stage "qa" 0

  # Check QA report for failures
  local qa_report="$DOCS_DIR/qa-reports/${RUN_ID}-qa-report.md"
  local iteration=0

  while [[ $iteration -lt $MAX_QA_ITERATIONS ]]; do
    # Check if QA passed
    if [[ -f "$qa_report" ]]; then
      # Look for PASS verdict (case-insensitive)
      if grep -qi "вердикт.*PASS\|итог.*PASS\|результат.*PASS\|## .*PASS" "$qa_report" && \
         ! grep -qi "FAIL\|NEEDS_CHANGES" "$qa_report"; then
        log "${GREEN}✅ QA PASSED — no bugs found${NC}"
        # Collect feedback for self-improvement
        if [[ -f "$ROOT_DIR/scripts/collect-qa-feedback.sh" ]]; then
          log "${BLUE}📊 Collecting QA feedback patterns...${NC}"
          bash "$ROOT_DIR/scripts/collect-qa-feedback.sh" "$qa_report" 2>/dev/null || true
        fi
        return 0
      fi
    else
      log "${YELLOW}⚠️  QA report not found, assuming pass${NC}"
      return 0
    fi

    iteration=$((iteration + 1))

    if [[ $iteration -ge $MAX_QA_ITERATIONS ]]; then
      log "${RED}⚠️  Max QA iterations ($MAX_QA_ITERATIONS) reached. Manual review needed.${NC}"
      # Collect feedback even on failure — this is where we learn most
      if [[ -f "$ROOT_DIR/scripts/collect-qa-feedback.sh" ]]; then
        log "${BLUE}📊 Collecting QA feedback patterns from failed run...${NC}"
        bash "$ROOT_DIR/scripts/collect-qa-feedback.sh" "$qa_report" 2>/dev/null || true
      fi
      return 1
    fi

    log "${YELLOW}🔄 QA found issues — starting fix iteration $iteration/$MAX_QA_ITERATIONS${NC}"

    # Developer fixes based on QA report
    run_stage "developer" "$iteration"

    # Re-run QA
    run_stage "qa" 0
  done
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
        log "${RED}Pipeline stopped: QA feedback loop did not converge${NC}"
        break
      fi
      # Skip reviewer and qa in main loop (already handled)
      continue
    else
      # Just run developer stage
      if ! run_stage "$stage"; then
        FAILED=true
        log "${RED}Pipeline stopped at stage: $stage${NC}"
        break
      fi
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
      log "${RED}Pipeline stopped at stage: $stage${NC}"
      break
    fi
  else
    if ! run_stage "$stage"; then
      FAILED=true
      log "${RED}Pipeline stopped at stage: $stage${NC}"
      break
    fi
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
